import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { createAccountCard } from './accountCard.js';

/**
 * Builds the comprehensive popup menu contents for the Antigravity extension.
 */
export class AntigravityPopupMenuSection extends PopupMenu.PopupMenuSection {
    constructor(quotaEngine, extension) {
        super();
        this._engine = quotaEngine;
        this._extension = extension;

        this._mainBox = new St.BoxLayout({
            vertical: true,
            style_class: 'antigravity-popup-box'
        });

        const menuItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false
        });
        menuItem.add_child(this._mainBox);
        this.addMenuItem(menuItem);

        this.rebuild();
    }

    rebuild() {
        this._mainBox.destroy_all_children();

        // 1. Header (Title + Refresh Button)
        const headerBox = new St.BoxLayout({
            vertical: false,
            style_class: 'antigravity-header-box',
            x_expand: true
        });

        const titleLabel = new St.Label({
            text: '🛸 Antigravity Quota Monitor',
            style_class: 'antigravity-header-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER
        });
        headerBox.add_child(titleLabel);

        const prefsBtn = new St.Button({
            label: '⚙️',
            style_class: 'button antigravity-icon-btn',
            y_align: Clutter.ActorAlign.CENTER
        });
        prefsBtn.connect('clicked', () => {
            this._extension.openPreferences();
        });
        headerBox.add_child(prefsBtn);

        const refreshBtn = new St.Button({
            label: '🔄 Refresh',
            style_class: 'button antigravity-refresh-btn',
            y_align: Clutter.ActorAlign.CENTER
        });
        refreshBtn.connect('clicked', async () => {
            refreshBtn.label = '⏳ Refreshing...';
            refreshBtn.reactive = false;
            try {
                await this._engine.refreshAllAccounts();
            } finally {
                refreshBtn.label = '🔄 Refresh';
                refreshBtn.reactive = true;
            }
        });
        headerBox.add_child(refreshBtn);

        this._mainBox.add_child(headerBox);

        // 2. Active Account
        const accounts = this._engine.accountsManager.loadAccounts();
        const active = accounts.find(a => a.isActive) || accounts[0];
        const inactiveAccounts = accounts.filter(a => a !== active);

        if (active) {
            const activeSnapshot = this._engine.cache.getSnapshot(active.id, active.email);
            const activeCard = createAccountCard(active, activeSnapshot);
            this._mainBox.add_child(activeCard);
        }

        // 3. Team / Other Accounts Section
        if (inactiveAccounts.length > 0) {
            const teamTitle = new St.Label({
                text: `👥 OTHER TEAM ACCOUNTS (${inactiveAccounts.length})`,
                style_class: 'antigravity-section-title'
            });
            this._mainBox.add_child(teamTitle);

            for (const acc of inactiveAccounts) {
                const snap = this._engine.cache.getSnapshot(acc.id, acc.email);
                const card = createAccountCard(acc, snap, (id) => {
                    this._engine.switchActiveAccount(id);
                });
                this._mainBox.add_child(card);
            }
        }
    }
}
