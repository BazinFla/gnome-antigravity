import GLib from 'gi://GLib';
import { AccountsManager } from './accounts.js';
import { AntigravityApi } from './api.js';
import { QuotaCache } from './cache.js';

/**
 * Coordinates quota fetching, local caching, and timer recalculations.
 */
export class QuotaEngine {
    constructor(settings) {
        this._settings = settings;
        this.accountsManager = new AccountsManager();
        this.api = new AntigravityApi();
        this.cache = new QuotaCache();

        this._listeners = new Set();
        this._pollSourceId = null;
        this._localTimerSourceId = null;
        this._isRefreshing = false;

        // Auto-refresh when accounts list is updated (e.g. from Preferences or Session Capture)
        this._accountsChangedListener = async () => {
            await this.refreshAllAccounts();
        };
        this.accountsManager.addChangeListener(this._accountsChangedListener);
    }

    /**
     * Registers a listener callback for quota updates.
     * @param {Function} callback
     */
    addListener(callback) {
        this._listeners.add(callback);
    }

    /**
     * Unregisters a listener.
     * @param {Function} callback
     */
    removeListener(callback) {
        this._listeners.delete(callback);
    }

    _notifyListeners() {
        for (const cb of this._listeners) {
            try {
                cb();
            } catch (e) {
                console.error(`[Antigravity] Listener callback error: ${e.message}`);
            }
        }
    }

    /**
     * Starts polling loop and local countdown timer.
     */
    async start() {
        await this.accountsManager.loadAccountsFromDisk();
        await this.cache.loadDiskCache();

        const accounts = this.accountsManager.loadAccounts();
        this.cache.prune(accounts);

        this.refreshAllAccounts();
        this._setupPolling();

        if (this._settings) {
            this._settingsChangedId = this._settings.connect('changed::refresh-interval', () => {
                this._setupPolling();
            });
        }

        // Local countdown ticker every 15s to update remaining minutes locally without network
        this._localTimerSourceId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 15, () => {
            this._notifyListeners();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _setupPolling() {
        if (this._pollSourceId) {
            GLib.Source.remove(this._pollSourceId);
            this._pollSourceId = null;
        }

        const interval = this._settings ? this._settings.get_int('refresh-interval') : 300;
        if (interval > 0) {
            this._pollSourceId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
                this.refreshActiveAccount();
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    /**
     * Stops all timers and unbinds listeners.
     */
    stop() {
        if (this._pollSourceId) {
            GLib.Source.remove(this._pollSourceId);
            this._pollSourceId = null;
        }
        if (this._localTimerSourceId) {
            GLib.Source.remove(this._localTimerSourceId);
            this._localTimerSourceId = null;
        }
        if (this._settings && this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        if (this._accountsChangedListener) {
            this.accountsManager.removeChangeListener(this._accountsChangedListener);
            this._accountsChangedListener = null;
        }
        this.accountsManager.destroy();
    }

    /**
     * Fetches fresh quota data for the active account.
     */
    async refreshActiveAccount() {
        const active = this.accountsManager.getActiveAccount();
        if (!active) return;
        
        try {
            const snapshot = await this.api.fetchUserQuotaSummary(active);
            if (snapshot) {
                this.cache.setSnapshot(active.id, snapshot);
            }
            this._notifyListeners();
        } catch (e) {
            console.error(`[Antigravity] Failed to refresh active account: ${e.message}`);
        }
    }

    /**
     * Fetches fresh quota data for all configured accounts.
     */
    async refreshAllAccounts() {
        if (this._isRefreshing) return;
        this._isRefreshing = true;

        const accounts = this.accountsManager.loadAccounts();
        this.cache.prune(accounts);

        for (const acc of accounts) {
            try {
                const snapshot = await this.api.fetchUserQuotaSummary(acc);
                if (snapshot) {
                    this.cache.setSnapshot(acc.id, snapshot);
                }
            } catch (e) {
                console.error(`[Antigravity] Failed to refresh account ${acc.name}: ${e.message}`);
            }
        }

        this._isRefreshing = false;
        this._notifyListeners();
    }

    /**
     * Switches the active account and refreshes it.
     * @param {string} accountId
     */
    async switchActiveAccount(accountId) {
        await this.accountsManager.setActiveAccount(accountId);
        await this.refreshActiveAccount();
        this._notifyListeners();
    }
}
