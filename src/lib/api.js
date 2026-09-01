import Soup from 'gi://Soup?version=3.0';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { loadTextFileAsync, enumerateChildrenAsync } from './fileUtils.js';

const CLOUD_API_ENDPOINT = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary';

/**
 * Antigravity API client for retrieving model quotas using local Language Server RPC or Libsoup 3.0.
 */
export class AntigravityApi {
    constructor() {
        this._session = new Soup.Session({
            timeout: 4
        });
        this._cachedServers = [];
        this._lastLsCheck = 0;
    }

    /**
     * Fetches quota summary for a given account by matching its email with running Language Servers.
     * @param {Object} account
     * @returns {Promise<Object|null>}
     */
    async fetchUserQuotaSummary(account) {
        if (!account) return null;

        // 1. Discover all active Language Servers with user status
        try {
            const servers = await this.discoverAllLanguageServers();
            
            // Find server matching account email STRICTLY
            let matchedServer = null;
            if (account.email && !account.email.endsWith('@local')) {
                matchedServer = servers.find(s => s.email && s.email.toLowerCase() === account.email.toLowerCase());
            } else if (servers.length === 1 && (!account.email || account.email.endsWith('@local'))) {
                matchedServer = servers[0];
            }

            if (matchedServer) {
                const data = await this._postRpc(
                    `http://127.0.0.1:${matchedServer.port}/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary`,
                    matchedServer.csrfToken
                );
                if (data && (data.response || data.groups)) {
                    return this._parseQuotaResponse(data.response || data, account);
                }
            }
        } catch (e) {
            console.warn(`[Antigravity] Language server fetch failed for ${account.email}: ${e.message}`);
        }

        // 2. If token is provided, try cloud API
        if (account.token) {
            try {
                const cloudQuota = await this._fetchFromCloudEndpoint(account);
                if (cloudQuota) {
                    return this._parseQuotaResponse(cloudQuota, account);
                }
            } catch (e) {
                console.warn(`[Antigravity] Cloud API fetch failed: ${e.message}`);
            }
        }

        // 3. Return null if offline so existing real cache is preserved
        return null;
    }

    /**
     * Discovers all running Antigravity Language Servers and queries their user identities.
     * @returns {Promise<Array<Object>>}
     */
    async discoverAllLanguageServers() {
        const now = Date.now();
        if (this._cachedServers.length > 0 && (now - this._lastLsCheck < 10000)) {
            return this._cachedServers;
        }

        const rawProcesses = await this._findLanguageServerProcesses();
        const activeServers = [];

        for (const proc of rawProcesses) {
            for (const port of proc.ports) {
                try {
                    const statusData = await this._postRpc(
                        `http://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/GetUserStatus`,
                        proc.csrfToken
                    );
                    if (statusData && statusData.userStatus) {
                        const userStatus = statusData.userStatus;
                        const planInfo = userStatus.planStatus?.planInfo;
                        const userTier = userStatus.userTier;
                        const planName = planInfo?.planName || userTier?.name || '';
                        const teamsTier = planInfo?.teamsTier || '';
                        const tierId = (userTier?.id || '').toLowerCase();
                        const isFree = (tierId === 'free' || tierId.includes('free') || planName.toLowerCase().includes('free') ||
                                       (!teamsTier.includes('PRO') && !teamsTier.includes('TEAMS') && !teamsTier.includes('ENTERPRISE') && !tierId.includes('pro') && !tierId.includes('ultra')));

                        activeServers.push({
                            pid: proc.pid,
                            csrfToken: proc.csrfToken,
                            port: port,
                            email: userStatus.email || '',
                            name: userStatus.name || '',
                            planName: planName || (isFree ? 'Free' : 'Pro'),
                            tier: tierId,
                            isFree: isFree
                        });
                        break; // Found working HTTP port for this PID
                    }
                } catch (e) {
                    // Try next port for this PID
                }
            }
        }

        this._cachedServers = activeServers;
        this._lastLsCheck = now;
        return activeServers;
    }

    /**
     * Scans /proc asynchronously for all running language_server instances
     */
    async _findLanguageServerProcesses() {
        const processes = [];
        try {
            const files = await enumerateChildrenAsync('/proc', 'standard::name');

            for (const fileInfo of files) {
                const pidName = fileInfo.get_name();
                if (!/^\d+$/.test(pidName)) continue;

                try {
                    const text = await loadTextFileAsync(`/proc/${pidName}/cmdline`);
                    if (!text || !text.includes('language_server')) continue;

                    const parts = text.split('\0');
                    let csrfToken = null;
                    for (let i = 0; i < parts.length; i++) {
                        if (parts[i] === '--csrf_token' && i + 1 < parts.length) {
                            csrfToken = parts[i + 1];
                            break;
                        }
                    }

                    if (!csrfToken) continue;

                    const ports = await this._getListeningPortsForPid(pidName);
                    if (ports.length > 0) {
                        processes.push({ pid: pidName, csrfToken: csrfToken, ports: ports });
                    }
                } catch (e) {}
            }
        } catch (e) {
            console.error(`[Antigravity] Discovery error: ${e.message}`);
        }
        return processes;
    }

    /**
     * Finds listening ports for a PID by reading /proc/<pid>/fd and /proc/net/tcp asynchronously
     */
    async _getListeningPortsForPid(pid) {
        const socketInodes = new Set();

        try {
            const fdFiles = await enumerateChildrenAsync(`/proc/${pid}/fd`, 'standard::name,standard::symlink-target');
            for (const info of fdFiles) {
                const target = info.get_symlink_target();
                if (target && target.startsWith('socket:[')) {
                    const inode = target.substring(8, target.length - 1);
                    socketInodes.add(inode);
                }
            }
        } catch (e) {}

        const ports = [];
        for (const netPath of ['/proc/net/tcp', '/proc/net/tcp6']) {
            try {
                const text = await loadTextFileAsync(netPath);
                if (!text) continue;
                const lines = text.split('\n');
                for (let i = 1; i < lines.length; i++) {
                    const parts = lines[i].trim().split(/\s+/);
                    if (parts.length >= 10) {
                        const localAddr = parts[1];
                        const state = parts[3]; // '0A' = LISTEN
                        const inode = parts[9];
                        if (state === '0A' && socketInodes.has(inode)) {
                            const hexPort = localAddr.split(':')[1];
                            const port = parseInt(hexPort, 16);
                            if (port && !ports.includes(port)) {
                                ports.push(port);
                            }
                        }
                    }
                }
            } catch (e) {}
        }
        return ports;
    }

    _postRpc(url, csrfToken) {
        return new Promise((resolve, reject) => {
            try {
                const message = new Soup.Message({
                    method: 'POST',
                    uri: GLib.Uri.parse(url, GLib.UriFlags.NONE)
                });
                message.request_headers.append('Content-Type', 'application/json');
                message.request_headers.append('Connect-Protocol-Version', '1');
                if (csrfToken) {
                    message.request_headers.append('x-codeium-csrf-token', csrfToken);
                }

                const bytes = new GLib.Bytes(new TextEncoder().encode('{}'));
                message.set_request_body_from_bytes('application/json', bytes);

                this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (s, res) => {
                    try {
                        const responseBytes = s.send_and_read_finish(res);
                        const status = message.get_status();
                        if (status === 200 && responseBytes) {
                            const str = new TextDecoder('utf-8').decode(responseBytes.get_data());
                            resolve(JSON.parse(str));
                        } else {
                            reject(new Error(`HTTP ${status}`));
                        }
                    } catch (err) {
                        reject(err);
                    }
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    _fetchFromCloudEndpoint(account) {
        return new Promise((resolve, reject) => {
            try {
                const message = new Soup.Message({
                    method: 'POST',
                    uri: GLib.Uri.parse(CLOUD_API_ENDPOINT, GLib.UriFlags.NONE)
                });
                message.request_headers.append('Content-Type', 'application/json');
                message.request_headers.append('User-Agent', 'AntigravityGnomeExtension/1.0');
                if (account.token) {
                    message.request_headers.append('Authorization', `Bearer ${account.token}`);
                }

                const body = JSON.stringify({ includeUsageHistory: false });
                message.set_request_body_from_bytes('application/json', new GLib.Bytes(new TextEncoder().encode(body)));

                this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (s, res) => {
                    try {
                        const responseBytes = s.send_and_read_finish(res);
                        const status = message.get_status();
                        if (status >= 200 && status < 300 && responseBytes) {
                            const str = new TextDecoder('utf-8').decode(responseBytes.get_data());
                            resolve(JSON.parse(str));
                        } else {
                            reject(new Error(`Cloud HTTP ${status}`));
                        }
                    } catch (err) {
                        reject(err);
                    }
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Parses API response (Language Server or Cloud) into standardized Claude & Gemini quota structure.
     */
    _parseQuotaResponse(raw, account) {
        const groups = raw.groups || raw.quotaGroups || [];
        
        let claude5h = 1.0;
        let claudeWk = 1.0;
        let claudeReset5h = null;
        let claudeResetWk = null;
        let hasClaude5h = false;
        let hasClaudeWk = false;

        let gemini5h = 1.0;
        let geminiWk = 1.0;
        let geminiReset5h = null;
        let geminiResetWk = null;
        let hasGemini5h = false;
        let hasGeminiWk = false;

        for (const g of groups) {
            const name = (g.displayName || g.model || g.name || g.tagTitle || '').toLowerCase();
            const desc = (g.description || '').toLowerCase();
            const isGemini = name.includes('gemini') || desc.includes('gemini');
            const isClaude = name.includes('claude') || name.includes('sonnet') || name.includes('opus') || name.includes('3p') || name.includes('gpt') || desc.includes('claude');

            // 1. Language Server bucket structure
            if (Array.isArray(g.buckets)) {
                for (const b of g.buckets) {
                    const windowType = (b.window || b.bucketId || '').toLowerCase();
                    const frac = (typeof b.remainingFraction === 'number') ? b.remainingFraction : 1.0;
                    const reset = b.resetTime || b.quotaResetUTCTimestamp || null;

                    if (isGemini) {
                        if (windowType.includes('weekly') || windowType === 'weekly') {
                            geminiWk = frac;
                            geminiResetWk = reset;
                            hasGeminiWk = true;
                        } else {
                            gemini5h = frac;
                            geminiReset5h = reset;
                            hasGemini5h = true;
                        }
                    } else if (isClaude) {
                        if (windowType.includes('weekly') || windowType === 'weekly') {
                            claudeWk = frac;
                            claudeResetWk = reset;
                            hasClaudeWk = true;
                        } else {
                            claude5h = frac;
                            claudeReset5h = reset;
                            hasClaude5h = true;
                        }
                    }
                }
            } else {
                // 2. Flat group structure (legacy)
                const fraction = (typeof g.remainingFraction === 'number') ? g.remainingFraction : 1.0;
                const resetTime = g.quotaResetUTCTimestamp || g.resetTimestamp || null;

                if (isClaude) {
                    if (g.quotaBucketType === 1 || g.isWeekly) {
                        claudeWk = fraction;
                        claudeResetWk = resetTime;
                        hasClaudeWk = true;
                    } else {
                        claude5h = fraction;
                        claudeReset5h = resetTime;
                        hasClaude5h = true;
                    }
                } else if (isGemini) {
                    if (g.quotaBucketType === 1 || g.isWeekly) {
                        geminiWk = fraction;
                        geminiResetWk = resetTime;
                        hasGeminiWk = true;
                    } else {
                        gemini5h = fraction;
                        geminiReset5h = resetTime;
                        hasGemini5h = true;
                    }
                }
            }
        }

        const isFree = (account.isFree === true) || (!hasClaude5h && !hasGemini5h);
        const planName = account.planName || (isFree ? 'Free' : 'Pro');

        return {
            accountId: account.id,
            accountEmail: account.email,
            fetchedAt: new Date().toISOString(),
            isFree: isFree,
            planName: planName,
            claude: {
                has5h: hasClaude5h,
                rolling5h: hasClaude5h ? {
                    fraction: claude5h,
                    pct: Math.round(claude5h * 100),
                    resetTimestamp: claudeReset5h || (claude5h < 1.0 ? this._calcDefaultReset(5) : null)
                } : null,
                weekly: {
                    fraction: claudeWk,
                    pct: Math.round(claudeWk * 100),
                    resetTimestamp: claudeResetWk || (claudeWk < 1.0 ? this._calcDefaultWeeklyReset() : null)
                }
            },
            gemini: {
                has5h: hasGemini5h,
                rolling5h: hasGemini5h ? {
                    fraction: gemini5h,
                    pct: Math.round(gemini5h * 100),
                    resetTimestamp: geminiReset5h || (gemini5h < 1.0 ? this._calcDefaultReset(5) : null)
                } : null,
                weekly: {
                    fraction: geminiWk,
                    pct: Math.round(geminiWk * 100),
                    resetTimestamp: geminiResetWk || (geminiWk < 1.0 ? this._calcDefaultWeeklyReset() : null)
                }
            }
        };
    }

    /**
     * Computes default next 5-hour reset timestamp.
     */
    _calcDefaultReset(hoursAhead) {
        const d = new Date();
        d.setHours(d.getHours() + hoursAhead);
        return d.toISOString();
    }

    /**
     * Computes next Monday reset timestamp.
     */
    _calcDefaultWeeklyReset() {
        const d = new Date();
        const day = d.getDay();
        const diff = d.getDate() + (day === 0 ? 1 : 8 - day);
        d.setDate(diff);
        d.setHours(9, 0, 0, 0);
        return d.toISOString();
    }
}
