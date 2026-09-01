import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { QuotaCache } from '../lib/cache.js';
import { AntigravityPopupMenuSection } from './popupMenu.js';

const extDir = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
const claudeSvgFile = extDir.get_child('ressources').get_child('anthropic_claude.svg');
const geminiSvgFile = extDir.get_child('ressources').get_child('google_gemini.svg');

const claudeGIcon = Gio.FileIcon.new(claudeSvgFile);
const geminiGIcon = Gio.FileIcon.new(geminiSvgFile);

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

        // Claude Icon & Label
        this._claudeIcon = new St.Icon({
            gicon: claudeGIcon,
            icon_size: 14,
            style_class: 'antigravity-topbar-icon',
            y_align: Clutter.ActorAlign.CENTER
        });
        this._claudeLabel = new St.Label({
            text: '',
            style_class: 'antigravity-topbar-label',
            y_align: Clutter.ActorAlign.CENTER
        });

        // Separator
        this._sepLabel = new St.Label({
            text: ' · ',
            style_class: 'antigravity-topbar-sep',
            y_align: Clutter.ActorAlign.CENTER
        });

        // Gemini Icon & Label
        this._geminiIcon = new St.Icon({
            gicon: geminiGIcon,
            icon_size: 14,
            style_class: 'antigravity-topbar-icon',
            y_align: Clutter.ActorAlign.CENTER
        });
        this._geminiLabel = new St.Label({
            text: '',
            style_class: 'antigravity-topbar-label',
            y_align: Clutter.ActorAlign.CENTER
        });

        // Fallback label (when no account is configured)
        this._fallbackLabel = new St.Label({
            text: '🛸 Antigravity',
            style_class: 'antigravity-topbar-label',
            y_align: Clutter.ActorAlign.CENTER
        });

        this._box.add_child(this._claudeIcon);
        this._box.add_child(this._claudeLabel);
        this._box.add_child(this._sepLabel);
        this._box.add_child(this._geminiIcon);
        this._box.add_child(this._geminiLabel);
        this._box.add_child(this._fallbackLabel);

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

    _applyStatus(label, pct, critThreshold) {
        label.remove_style_class_name('antigravity-status-good');
        label.remove_style_class_name('antigravity-status-warning');
        label.remove_style_class_name('antigravity-status-critical');

        if (critThreshold > 0 && pct <= critThreshold) {
            label.add_style_class_name('antigravity-status-critical');
        } else if (pct <= 50) {
            label.add_style_class_name('antigravity-status-warning');
        } else {
            label.add_style_class_name('antigravity-status-good');
        }
    }

    updateUI() {
        const active = this._engine.accountsManager.getActiveAccount();
        if (!active) {
            this._claudeIcon.hide();
            this._claudeLabel.hide();
            this._sepLabel.hide();
            this._geminiIcon.hide();
            this._geminiLabel.hide();
            this._fallbackLabel.show();
            this._fallbackLabel.set_text('🛸 Antigravity');
            this._menuSection.rebuild();
            return;
        }

        this._fallbackLabel.hide();
        this._claudeIcon.show();
        this._claudeLabel.show();
        this._sepLabel.show();
        this._geminiIcon.show();
        this._geminiLabel.show();

        const snapshot = this._engine.cache.getSnapshot(active.id, active.email);
        const isFree = snapshot?.isFree || active.isFree || (snapshot && snapshot.claude?.has5h === false && snapshot.gemini?.has5h === false);

        const c5hRes = QuotaCache.getEffectiveWindowQuota(snapshot?.claude?.rolling5h, false);
        const cWkRes = QuotaCache.getEffectiveWindowQuota(snapshot?.claude?.weekly, true);
        const g5hRes = QuotaCache.getEffectiveWindowQuota(snapshot?.gemini?.rolling5h, false);
        const gWkRes = QuotaCache.getEffectiveWindowQuota(snapshot?.gemini?.weekly, true);

        const c5h = c5hRes.pct;
        const cWk = cWkRes.pct;
        const g5h = g5hRes.pct;
        const gWk = gWkRes.pct;

        const limitType = this._settings ? this._settings.get_string('limit-display-type') : '5h';
        const critThreshold = this._settings ? this._settings.get_int('critical-threshold') : 15;

        // Build labels
        let claudeMinPct;
        let geminiMinPct;

        if (isFree) {
            // Free accounts only have a weekly quota (no 5h)
            this._claudeLabel.set_text(`${cWk}%`);
            this._geminiLabel.set_text(`${gWk}%`);
            claudeMinPct = cWk;
            geminiMinPct = gWk;
        } else if (limitType === 'weekly') {
            this._claudeLabel.set_text(`${cWk}%`);
            this._geminiLabel.set_text(`${gWk}%`);
            claudeMinPct = cWk;
            geminiMinPct = gWk;
        } else if (limitType === 'both') {
            this._claudeLabel.set_text(`${c5h}% [W:${cWk}%]`);
            this._geminiLabel.set_text(`${g5h}% [W:${gWk}%]`);
            claudeMinPct = Math.min(c5h, cWk);
            geminiMinPct = Math.min(g5h, gWk);
        } else {
            // '5h' (default)
            this._claudeLabel.set_text(`${c5h}%`);
            this._geminiLabel.set_text(`${g5h}%`);
            claudeMinPct = c5h;
            geminiMinPct = g5h;
        }

        this._applyStatus(this._claudeLabel, claudeMinPct, critThreshold);
        this._applyStatus(this._geminiLabel, geminiMinPct, critThreshold);

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
