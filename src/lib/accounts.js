import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { loadTextFileAsync, replaceFileContentsAsync } from './fileUtils.js';
import { AntigravityApi } from './api.js';
import { QuotaCache } from './cache.js';

/**
 * Manages accounts configuration in ~/.config/gnome-antigravity/accounts.json
 */
export class AccountsManager {
    constructor() {
        this._configDir = GLib.build_filenamev([GLib.get_user_config_dir(), 'gnome-antigravity']);
        this._configFile = GLib.build_filenamev([this._configDir, 'accounts.json']);
        this._accounts = [];
        this._listeners = new Set();
        this._fileMonitor = null;
        this._fileMonitorId = null;

        this._ensureConfigDir();
        this._setupFileMonitor();
        this.loadAccountsFromDisk();
    }

    _ensureConfigDir() {
        const dir = Gio.File.new_for_path(this._configDir);
        if (!dir.query_exists(null)) {
            try {
                dir.make_directory_with_parents(null);
            } catch (e) {
                console.error(`[Antigravity] Failed to create config dir: ${e.message}`);
            }
        }
    }

    _setupFileMonitor() {
        try {
            const file = Gio.File.new_for_path(this._configFile);
            this._fileMonitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._fileMonitorId = this._fileMonitor.connect('changed', async (mon, f, other, eventType) => {
                if (
                    eventType === Gio.FileMonitorEvent.CHANGES_DONE_HINT ||
                    eventType === Gio.FileMonitorEvent.CREATED
                ) {
                    await this.loadAccountsFromDisk();
                    this._notifyChange();
                }
            });
        } catch (e) {
            console.warn(`[Antigravity] Accounts file monitor warning: ${e.message}`);
        }
    }

    /**
     * Registers a listener callback for account changes.
     * @param {Function} callback
     */
    addChangeListener(callback) {
        this._listeners.add(callback);
    }

    /**
     * Unregisters a change listener.
     * @param {Function} callback
     */
    removeChangeListener(callback) {
        this._listeners.delete(callback);
    }

    _notifyChange() {
        for (const cb of this._listeners) {
            try {
                cb(this._accounts);
            } catch (e) {
                console.error(`[Antigravity] Accounts change listener error: ${e.message}`);
            }
        }
    }

    /**
     * Asynchronously loads accounts list from disk into memory.
     * @returns {Promise<Array<Object>>}
     */
    async loadAccountsFromDisk() {
        try {
            const text = await loadTextFileAsync(this._configFile);
            if (text) {
                const data = JSON.parse(text);
                if (data && Array.isArray(data.accounts) && data.accounts.length > 0) {
                    this._accounts = data.accounts;
                }
            }

            if (this._accounts.length === 0) {
                this._accounts = this._createDefaultConfig();
                await this.saveAccounts(this._accounts);
            }

            if (this._accounts.length > 0 && !this._accounts.some(a => a.isActive)) {
                this._accounts[0].isActive = true;
                await this.saveAccounts(this._accounts);
            }
        } catch (e) {
            console.error(`[Antigravity] Error reading accounts.json: ${e.message}`);
        }
        return this._accounts;
    }

    _createDefaultConfig() {
        const username = GLib.get_user_name();
        return [
            {
                id: 'local_active',
                name: username || 'Main Session',
                email: `${username}@local`,
                token: '',
                isActive: true,
                isLocalSession: true
            }
        ];
    }

    /**
     * Loads the in-memory accounts list.
     * @returns {Array<Object>}
     */
    loadAccounts() {
        if (this._accounts.length === 0) {
            this._accounts = this._createDefaultConfig();
        }
        return this._accounts;
    }

    /**
     * Saves accounts list to accounts.json asynchronously and notifies listeners.
     * @param {Array<Object>} accounts
     * @returns {Promise<boolean>}
     */
    async saveAccounts(accounts) {
        this._accounts = accounts;
        this._ensureConfigDir();
        const data = {
            version: 1,
            updatedAt: new Date().toISOString(),
            accounts: accounts
        };
        const ok = await replaceFileContentsAsync(this._configFile, JSON.stringify(data, null, 2));
        this._notifyChange();
        return ok;
    }

    /**
     * Returns the currently active account.
     * @returns {Object|null}
     */
    getActiveAccount() {
        const accounts = this.loadAccounts();
        const active = accounts.find(a => a.isActive);
        return active || accounts[0] || null;
    }

    /**
     * Sets an account as active by ID.
     * @param {string} id
     */
    async setActiveAccount(id) {
        const accounts = this.loadAccounts();
        for (const acc of accounts) {
            acc.isActive = (acc.id === id);
        }
        await this.saveAccounts(accounts);
    }

    /**
     * Adds or updates an account.
     * @param {Object} accountData
     */
    async upsertAccount(accountData) {
        const accounts = this.loadAccounts();
        const existingIdx = accounts.findIndex(a => 
            (accountData.id && a.id === accountData.id) || 
            (accountData.email && a.email && a.email.toLowerCase() === accountData.email.toLowerCase())
        );
        
        if (existingIdx >= 0) {
            accounts[existingIdx] = { ...accounts[existingIdx], ...accountData };
        } else {
            if (!accountData.id) {
                const seed = accountData.email || Date.now().toString(36);
                accountData.id = 'session_' + GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, seed, -1).substring(0, 10);
            }
            if (accounts.length === 0) {
                accountData.isActive = true;
            }
            accounts.push(accountData);
        }
        await this.saveAccounts(accounts);
    }

    /**
     * Removes an account by ID and clears its cache.
     * @param {string} id
     */
    async removeAccount(id) {
        let accounts = this.loadAccounts();
        accounts = accounts.filter(a => a.id !== id);
        if (accounts.length > 0 && !accounts.some(a => a.isActive)) {
            accounts[0].isActive = true;
        }
        await this.saveAccounts(accounts);

        try {
            const cache = new QuotaCache();
            cache.removeSnapshot(id);
        } catch (e) {}
    }

    /**
     * Captures and syncs all running IDE sessions into accounts.json asynchronously.
     * @returns {Promise<Array<Object>>}
     */
    async captureAndSyncAllSessions() {
        const capturedList = await this.captureAllActiveSessions();
        if (capturedList.length === 0) return this.loadAccounts();

        const accounts = this.loadAccounts();
        for (const captured of capturedList) {
            const existing = accounts.find(a => a.email && a.email.toLowerCase() === captured.email.toLowerCase());
            if (existing) {
                if (captured.name) existing.name = captured.name;
            } else {
                captured.isActive = (accounts.length === 0);
                accounts.push(captured);
            }
        }
        await this.saveAccounts(accounts);
        return accounts;
    }

    /**
     * Captures all active Antigravity sessions currently running in Language Servers.
     * @returns {Promise<Array<Object>>}
     */
    async captureAllActiveSessions() {
        const results = [];
        const seenEmails = new Set();

        try {
            const api = new AntigravityApi();
            const servers = await api.discoverAllLanguageServers();

            for (const server of servers) {
                if (server.email) {
                    const email = server.email.trim();
                    if (email && !seenEmails.has(email.toLowerCase())) {
                        seenEmails.add(email.toLowerCase());
                        const stableId = 'session_' + GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, email.toLowerCase().trim(), -1).substring(0, 10);
                        results.push({
                            id: stableId,
                            name: server.name || email.split('@')[0],
                            email: email,
                            token: '',
                            isActive: false,
                            isLocalSession: true,
                            capturedAt: new Date().toISOString()
                        });
                    }
                }
            }
        } catch (e) {
            console.warn(`[Antigravity] Multi-server capture warning: ${e.message}`);
        }

        return results;
    }

    /**
     * Captures the primary active session asynchronously.
     * @returns {Promise<Object|null>}
     */
    async captureActiveSession() {
        const list = await this.captureAllActiveSessions();
        return list.length > 0 ? list[0] : null;
    }

    destroy() {
        if (this._fileMonitorId && this._fileMonitor) {
            this._fileMonitor.disconnect(this._fileMonitorId);
            this._fileMonitorId = null;
        }
        if (this._fileMonitor) {
            this._fileMonitor.cancel();
            this._fileMonitor = null;
        }
        this._listeners.clear();
    }
}
