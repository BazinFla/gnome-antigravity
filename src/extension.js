import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { QuotaEngine } from './lib/quotaEngine.js';
import { AntigravityPanelButton } from './ui/panelButton.js';

export default class AntigravityQuotaExtension extends Extension {
    enable() {
        console.log(`[Antigravity] Enabling extension ${this.uuid}`);

        this._settings = this.getSettings();
        this._engine = new QuotaEngine(this._settings);
        this._panelButton = new AntigravityPanelButton(this._engine, this, this._settings);

        Main.panel.addToStatusArea(this.uuid, this._panelButton);
        this._engine.start();

        // Listen for settings changes
        this._settingsChangedId = this._settings.connect('changed', () => {
            if (this._panelButton) {
                this._panelButton.updateUI();
            }
        });
    }

    disable() {
        console.log(`[Antigravity] Disabling extension ${this.uuid}`);

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }

        if (this._engine) {
            this._engine.stop();
            this._engine = null;
        }

        if (this._panelButton) {
            this._panelButton.destroy();
            this._panelButton = null;
        }

        this._settings = null;
    }
}
