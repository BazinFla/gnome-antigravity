import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { AccountsManager } from './lib/accounts.js';

export default class AntigravityPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const accountsManager = new AccountsManager();

        window.set_default_size(680, 720);

        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'preferences-system-symbolic'
        });
        window.add(page);

        // -------------------------------------------------------------
        // Group 1: Top Bar Display
        // -------------------------------------------------------------
        const displayGroup = new Adw.PreferencesGroup({
            title: 'Top Bar Display',
            description: 'Customize the information displayed in the top bar'
        });
        page.add(displayGroup);

        // Limit Display Type Combo (5h, weekly, both)
        const limitTypes = ['5h', 'weekly', 'both'];
        const limitTypeRow = new Adw.ComboRow({
            title: 'Limit displayed in top bar',
            subtitle: 'Choose which limit to display for each model',
            model: new Gtk.StringList({
                strings: ['5h (Default)', 'Weekly', 'Both']
            })
        });
        const currentLimitType = settings.get_string('limit-display-type');
        const selectedIdx = limitTypes.indexOf(currentLimitType);
        limitTypeRow.selected = selectedIdx >= 0 ? selectedIdx : 0;
        limitTypeRow.connect('notify::selected', () => {
            settings.set_string('limit-display-type', limitTypes[limitTypeRow.selected]);
        });
        displayGroup.add(limitTypeRow);

        // Critical threshold (0 to 100)
        const critRow = new Adw.SpinRow({
            title: 'Critical alert threshold (%)',
            subtitle: 'Triggers red highlight below this percentage (0 = disabled)',
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 100,
                step_increment: 5,
                value: settings.get_int('critical-threshold')
            })
        });
        critRow.connect('notify::value', () => {
            settings.set_int('critical-threshold', critRow.get_value());
        });
        displayGroup.add(critRow);

        // -------------------------------------------------------------
        // Group 2: Synchronization & Network
        // -------------------------------------------------------------
        const syncGroup = new Adw.PreferencesGroup({
            title: 'Synchronization & Network',
            description: 'Quota refresh frequency'
        });
        page.add(syncGroup);

        const refreshRow = new Adw.SpinRow({
            title: 'Refresh interval (seconds)',
            subtitle: 'Automatic check frequency (Default: 300s, 0 = disabled)',
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 3600,
                step_increment: 30,
                value: settings.get_int('refresh-interval')
            })
        });
        refreshRow.connect('notify::value', () => {
            settings.set_int('refresh-interval', refreshRow.get_value());
        });
        syncGroup.add(refreshRow);

        // -------------------------------------------------------------
        // Group 3: Team Accounts & Multi-session
        // -------------------------------------------------------------
        const accountsGroup = new Adw.PreferencesGroup({
            title: 'Team Accounts & Multi-session',
            description: 'Manage accounts and active sessions monitored by the extension'
        });
        page.add(accountsGroup);

        // Action Buttons Row
        const actionsRow = new Adw.ActionRow({
            title: 'Session Discovery',
            subtitle: 'Automatically detect and sync active local IDE sessions'
        });

        const captureBtn = new Gtk.Button({
            label: '🪄 Capture IDE Session',
            css_classes: ['suggested-action'],
            valign: Gtk.Align.CENTER
        });
        actionsRow.add_suffix(captureBtn);

        accountsGroup.add(actionsRow);

        // Accounts List container
        const accountsListGroup = new Adw.PreferencesGroup({
            title: 'Configured Accounts & Team Members'
        });
        page.add(accountsListGroup);

        let accountRows = [];

        const rebuildAccountsList = async () => {
            // Remove previous rows cleanly
            for (const row of accountRows) {
                accountsListGroup.remove(row);
            }
            accountRows = [];

            const accounts = await accountsManager.loadAccountsFromDisk();
            if (accounts.length === 0) {
                const emptyRow = new Adw.ActionRow({
                    title: 'No accounts configured',
                    subtitle: 'Click "Capture IDE Session" above to detect your running IDE session'
                });
                accountsListGroup.add(emptyRow);
                accountRows.push(emptyRow);
                return;
            }

            for (const acc of accounts) {
                const planTag = acc.isFree ? 'FREE' : 'PRO';
                const row = new Adw.ActionRow({
                    title: `${acc.name || 'Antigravity Account'} [${planTag}]`,
                    subtitle: `${acc.email || 'No email'}  •  Plan: ${acc.planName || planTag}${acc.isActive ? '  •  [ACTIVE IN TOP BAR]' : ''}`
                });

                // Star / Active button in prefix
                const starBtn = new Gtk.Button({
                    label: acc.isActive ? '⭐ Active' : '☆ Select',
                    css_classes: acc.isActive ? ['suggested-action'] : ['flat'],
                    valign: Gtk.Align.CENTER
                });
                starBtn.connect('clicked', async () => {
                    await accountsManager.setActiveAccount(acc.id);
                    await rebuildAccountsList();
                });
                row.add_prefix(starBtn);

                // Delete button in suffix (only if more than 1 account)
                if (accounts.length > 1) {
                    const deleteBtn = new Gtk.Button({
                        icon_name: 'user-trash-symbolic',
                        valign: Gtk.Align.CENTER,
                        css_classes: ['destructive-action']
                    });
                    deleteBtn.connect('clicked', async () => {
                        await accountsManager.removeAccount(acc.id);
                        await rebuildAccountsList();
                    });
                    row.add_suffix(deleteBtn);
                }

                accountsListGroup.add(row);
                accountRows.push(row);
            }
        };

        captureBtn.connect('clicked', async () => {
            captureBtn.sensitive = false;
            captureBtn.label = '⏳ Capturing active sessions...';
            try {
                await accountsManager.captureAndSyncAllSessions();
                await rebuildAccountsList();
            } finally {
                captureBtn.label = '🪄 Capture IDE Session';
                captureBtn.sensitive = true;
            }
        });

        // Initial asynchronous list build
        rebuildAccountsList();
    }
}
