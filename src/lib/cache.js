import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { loadTextFileAsync, replaceFileContentsAsync } from './fileUtils.js';

/**
 * Manages in-memory and disk caching for account quota snapshots.
 */
export class QuotaCache {
    constructor() {
        this._cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'gnome-antigravity']);
        this._cacheFile = GLib.build_filenamev([this._cacheDir, 'cache.json']);
        this._memoryCache = new Map();
        this._ensureCacheDir();
        this.loadDiskCache();
    }

    _ensureCacheDir() {
        const dir = Gio.File.new_for_path(this._cacheDir);
        if (!dir.query_exists(null)) {
            try {
                dir.make_directory_with_parents(null);
            } catch (e) {
                console.error(`[Antigravity] Failed to create cache dir: ${e.message}`);
            }
        }
    }

    /**
     * Asynchronously loads cached snapshots from disk into memory.
     */
    async loadDiskCache() {
        try {
            const str = await loadTextFileAsync(this._cacheFile);
            if (str) {
                const data = JSON.parse(str);
                if (data && typeof data === 'object') {
                    this._memoryCache.clear();
                    for (const [id, snapshot] of Object.entries(data)) {
                        this._memoryCache.set(id, snapshot);
                    }
                    this._deduplicateMemoryCache();
                }
            }
        } catch (e) {
            console.warn(`[Antigravity] Cache read warning: ${e.message}`);
        }
    }

    _deduplicateMemoryCache() {
        const byEmail = new Map();
        let hasDuplicates = false;

        for (const [id, snap] of this._memoryCache.entries()) {
            if (snap && snap.accountEmail) {
                const email = snap.accountEmail.toLowerCase().trim();
                if (byEmail.has(email)) {
                    hasDuplicates = true;
                    const prev = byEmail.get(email);
                    const prevTime = prev.snap.fetchedAt ? new Date(prev.snap.fetchedAt).getTime() : 0;
                    const currTime = snap.fetchedAt ? new Date(snap.fetchedAt).getTime() : 0;
                    if (currTime >= prevTime) {
                        this._memoryCache.delete(prev.id);
                        byEmail.set(email, { id, snap });
                    } else {
                        this._memoryCache.delete(id);
                    }
                } else {
                    byEmail.set(email, { id, snap });
                }
            }
        }

        if (hasDuplicates) {
            this._persistDiskCache();
        }
    }

    _persistDiskCache() {
        this._ensureCacheDir();
        const obj = {};
        for (const [id, snap] of this._memoryCache.entries()) {
            obj[id] = snap;
        }
        replaceFileContentsAsync(this._cacheFile, JSON.stringify(obj, null, 2)).catch((e) => {
            console.error(`[Antigravity] Cache write error: ${e.message}`);
        });
    }

    /**
     * Retrieves quota snapshot for an account from memory cache.
     * @param {string} accountId
     * @param {string|null} email
     * @returns {Object|null}
     */
    getSnapshot(accountId, email = null) {
        if (!accountId) return null;
        let snap = this._memoryCache.get(accountId);
        if (!snap && email) {
            const targetEmail = email.toLowerCase().trim();
            for (const s of this._memoryCache.values()) {
                if (s && s.accountEmail && s.accountEmail.toLowerCase().trim() === targetEmail) {
                    snap = s;
                    break;
                }
            }
        }
        return snap || null;
    }

    /**
     * Stores a quota snapshot in cache and on disk.
     * @param {string} accountId
     * @param {Object} snapshot
     */
    setSnapshot(accountId, snapshot) {
        if (!accountId || !snapshot) return;

        // Purge any old entries sharing the same email under a different id
        if (snapshot.accountEmail) {
            const targetEmail = snapshot.accountEmail.toLowerCase().trim();
            for (const [id, s] of this._memoryCache.entries()) {
                if (id !== accountId && s && s.accountEmail && s.accountEmail.toLowerCase().trim() === targetEmail) {
                    this._memoryCache.delete(id);
                }
            }
        }

        this._memoryCache.set(accountId, snapshot);
        this._persistDiskCache();
    }

    /**
     * Prunes cached snapshots that no longer correspond to any configured account.
     * @param {Array<Object>} validAccounts
     */
    prune(validAccounts = []) {
        if (!Array.isArray(validAccounts)) return;
        const validIds = new Set(validAccounts.map(a => a.id));
        const validEmails = new Set(validAccounts.filter(a => a.email).map(a => a.email.toLowerCase().trim()));

        let changed = false;
        for (const [id, snapshot] of this._memoryCache.entries()) {
            const snapEmail = snapshot?.accountEmail ? snapshot.accountEmail.toLowerCase().trim() : '';
            if (!validIds.has(id) && (!snapEmail || !validEmails.has(snapEmail))) {
                this._memoryCache.delete(id);
                changed = true;
            }
        }
        if (changed) {
            this._persistDiskCache();
        }
    }

    /**
     * Removes a quota snapshot from cache and disk.
     * @param {string} accountId
     */
    removeSnapshot(accountId) {
        if (this._memoryCache.has(accountId)) {
            this._memoryCache.delete(accountId);
            this._persistDiskCache();
        }
    }

    /**
     * Calculates human readable countdown string from an ISO timestamp without any network request.
     * @param {string} isoTimestamp
     * @param {boolean} isWeekly
     * @returns {string}
     */
    static formatCountdown(isoTimestamp, isWeekly = false) {
        if (!isoTimestamp) return 'Ready';
        
        const target = new Date(isoTimestamp).getTime();
        const now = Date.now();
        const diffMs = target - now;

        if (diffMs <= 0) {
            return 'Ready';
        }

        if (isWeekly) {
            const diffDays = Math.floor(diffMs / (24 * 3600 * 1000));
            const diffHours = Math.floor((diffMs % (24 * 3600 * 1000)) / (3600 * 1000));
            if (diffDays > 0) {
                return `in ${diffDays}d ${diffHours}h`;
            }
            return `in ${diffHours}h`;
        }

        const diffMinutes = Math.floor(diffMs / (60 * 1000));
        const hours = Math.floor(diffMinutes / 60);
        const mins = diffMinutes % 60;

        if (hours > 0) {
            return `${hours}h ${mins.toString().padStart(2, '0')}m`;
        }
        return `${mins} min`;
    }
}
