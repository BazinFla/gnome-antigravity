import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { AntigravityPopupMenuSection } from './popupMenu.js';

export const AntigravityPanelButton = GObject.registerClass(
{
    GTypeName: 'AntigravityQuotaPanelButton'
},
class AntigravityPanelButton extends PanelMenu.Button {
    _init(quotaEngine, extension, settings) {
        super._init(0.0, 'Antigravity Quota Monitor', false);

        this._engine = quotaEngine;
        this._extension = extension;
        this._settings = settings;

        this._box = new St.BoxLayout({
            style_class: 'antigravity-topbar-box',
            y_align: Clutter.ActorAlign.CENTER
        });

        this._label = new St.Label({
            text: '🛸 Quotas...',
            style_class: 'antigravity-topbar-label',
            y_align: Clutter.ActorAlign.CENTER
        });

        this._box.add_child(this._label);
        this.add_child(this._box);

        // Add Popup Menu Section
        this._menuSection = new AntigravityPopupMenuSection(this._engine, this._extension);
        this.menu.addMenuItem(this._menuSection);

        // Connect quota updates
        this._updateListener = () => {
            this.updateUI();
        };
        this._engine.addListener(this._updateListener);

        this.menu.connect('open-state-changed', (menu, isOpen) => {
            if (isOpen) {
                this.updateUI();
            }
        });

        if (this._settings) {
            this._settingsChangedId = this._settings.connect('changed', () => {
                this.updateUI();
            });
        }

        this.updateUI();
    }

    updateUI() {
        const active = this._engine.accountsManager.getActiveAccount();
        if (!active) {
            this._label.set_text('🛸 Antigravity');
            this._menuSection.rebuild();
            return;
        }

        const snapshot = this._engine.cache.getSnapshot(active.id, active.email);
        const c5h = snapshot?.claude?.rolling5h?.pct ?? 100;
        const cWk = snapshot?.claude?.weekly?.pct ?? 100;
        const g5h = snapshot?.gemini?.rolling5h?.pct ?? 100;
        const gWk = snapshot?.gemini?.weekly?.pct ?? 100;

        const limitType = this._settings ? this._settings.get_string('limit-display-type') : '5h';
        const critThreshold = this._settings ? this._settings.get_int('critical-threshold') : 15;

        // Build label text
        if (limitType === 'weekly') {
            this._label.set_text(`⚡ ${cWk}% · 🔷 ${gWk}%`);
        } else if (limitType === 'both') {
            this._label.set_text(`⚡ ${c5h}% [W:${cWk}%] · 🔷 ${g5h}% [W:${gWk}%]`);
        } else {
            // '5h' (default)
            this._label.set_text(`⚡ ${c5h}% · 🔷 ${g5h}%`);
        }

        // Apply color based on active display mode
        let minPct;
        if (limitType === 'weekly') {
            minPct = Math.min(cWk, gWk);
        } else if (limitType === 'both') {
            minPct = Math.min(c5h, cWk, g5h, gWk);
        } else {
            minPct = Math.min(c5h, g5h);
        }

        this._label.remove_style_class_name('antigravity-status-good');
        this._label.remove_style_class_name('antigravity-status-warning');
        this._label.remove_style_class_name('antigravity-status-critical');

        if (critThreshold > 0 && minPct <= critThreshold) {
            this._label.add_style_class_name('antigravity-status-critical');
        } else if (minPct <= 50) {
            this._label.add_style_class_name('antigravity-status-warning');
        } else {
            this._label.add_style_class_name('antigravity-status-good');
        }

        // Rebuild popup menu contents
        this._menuSection.rebuild();
    }

    destroy() {
        if (this._updateListener) {
            this._engine.removeListener(this._updateListener);
            this._updateListener = null;
        }
        if (this._settings && this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        super.destroy();
    }
});
