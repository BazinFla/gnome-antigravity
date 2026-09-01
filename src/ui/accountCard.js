import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import { QuotaCache } from '../lib/cache.js';

const extDir = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
const claudeSvgFile = extDir.get_child('ressources').get_child('anthropic_claude.svg');
const geminiSvgFile = extDir.get_child('ressources').get_child('google_gemini.svg');

const claudeGIcon = Gio.FileIcon.new(claudeSvgFile);
const geminiGIcon = Gio.FileIcon.new(geminiSvgFile);

/**
 * Creates an ASCII progress bar string.
 */
function renderBar(fraction, length = 10) {
    const clamped = Math.max(0, Math.min(1, fraction));
    const filled = Math.round(clamped * length);
    const empty = length - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Gets CSS class based on percentage.
 */
function getStatusClass(pct, criticalThreshold = 15) {
    if (pct <= criticalThreshold) return 'antigravity-status-critical';
    if (pct <= 50) return 'antigravity-status-warning';
    return 'antigravity-status-good';
}

/**
 * Builds a unified account card for the popup menu.
 * @param {Object} account
 * @param {Object|null} snapshot
 * @param {Function|null} onSelectActive
 * @returns {St.BoxLayout}
 */
export function createAccountCard(account, snapshot, onSelectActive = null) {
    const card = new St.BoxLayout({
        vertical: true,
        style_class: `antigravity-account-card ${account.isActive ? 'active-account' : ''}`,
        x_expand: true
    });

    // 1. Header: Star Icon, Name, Email, Status Badge
    const headerBox = new St.BoxLayout({
        vertical: false,
        style_class: 'antigravity-account-header',
        x_expand: true
    });

    // Star icon button for selecting topbar account
    const starBtn = new St.Button({
        label: account.isActive ? '⭐' : '☆',
        style_class: `antigravity-star-btn ${account.isActive ? 'active' : 'inactive'}`,
        y_align: Clutter.ActorAlign.CENTER,
        can_focus: true
    });
    if (!account.isActive && onSelectActive) {
        starBtn.connect('clicked', () => {
            onSelectActive(account.id);
        });
    }
    headerBox.add_child(starBtn);

    const infoBox = new St.BoxLayout({
        vertical: true,
        x_expand: true
    });

    const nameLabel = new St.Label({
        text: account.name || 'Antigravity Account',
        style_class: 'antigravity-account-name'
    });
    infoBox.add_child(nameLabel);

    if (account.email) {
        const emailLabel = new St.Label({
            text: account.email,
            style_class: 'antigravity-account-email'
        });
        infoBox.add_child(emailLabel);
    }
    headerBox.add_child(infoBox);

    const isFree = snapshot?.isFree ?? account.isFree ?? (snapshot && snapshot.claude?.has5h === false && snapshot.gemini?.has5h === false);

    const tierBadge = new St.Label({
        text: isFree ? 'FREE' : 'PRO',
        style_class: `antigravity-tier-badge ${isFree ? 'free' : 'pro'}`,
        y_align: Clutter.ActorAlign.CENTER
    });
    headerBox.add_child(tierBadge);

    if (account.isActive) {
        const activeBadge = new St.Label({
            text: '● ACTIVE',
            style_class: 'antigravity-active-badge',
            y_align: Clutter.ActorAlign.CENTER
        });
        headerBox.add_child(activeBadge);
    }

    card.add_child(headerBox);

    // 2. Data Snapshot extraction
    const c5h = QuotaCache.getEffectiveWindowQuota(snapshot?.claude?.rolling5h, false);
    const cWk = QuotaCache.getEffectiveWindowQuota(snapshot?.claude?.weekly, true);
    const g5h = QuotaCache.getEffectiveWindowQuota(snapshot?.gemini?.rolling5h, false);
    const gWk = QuotaCache.getEffectiveWindowQuota(snapshot?.gemini?.weekly, true);

    // 3. Row Claude
    const claudeRow = new St.BoxLayout({
        vertical: false,
        style_class: 'antigravity-model-row',
        y_align: Clutter.ActorAlign.CENTER
    });

    const claudeIcon = new St.Icon({
        gicon: claudeGIcon,
        icon_size: 14,
        style_class: 'antigravity-model-icon',
        y_align: Clutter.ActorAlign.CENTER
    });
    claudeRow.add_child(claudeIcon);

    const claudeTag = new St.Label({
        text: 'Claude :',
        style_class: 'antigravity-model-tag',
        y_align: Clutter.ActorAlign.CENTER
    });
    claudeRow.add_child(claudeTag);

    if (isFree) {
        const claudeWkLabel = new St.Label({
            text: `Hebdo [${renderBar(cWk.fraction, 14)}] ${cWk.pct}% (📅 ${cWk.timeStr})`,
            style_class: `antigravity-gauge-text ${getStatusClass(cWk.pct)}`,
            y_align: Clutter.ActorAlign.CENTER
        });
        claudeRow.add_child(claudeWkLabel);
    } else {
        const claude5hLabel = new St.Label({
            text: ` 5h [${renderBar(c5h.fraction)}] ${c5h.pct}% (⏳ ${c5h.timeStr})`,
            style_class: `antigravity-gauge-text ${getStatusClass(c5h.pct)}`,
            y_align: Clutter.ActorAlign.CENTER
        });
        claudeRow.add_child(claude5hLabel);

        const claudeSep = new St.Label({
            text: '  ·  ',
            y_align: Clutter.ActorAlign.CENTER
        });
        claudeRow.add_child(claudeSep);

        const claudeWkLabel = new St.Label({
            text: `Wk [${renderBar(cWk.fraction)}] ${cWk.pct}% (📅 ${cWk.timeStr})`,
            style_class: `antigravity-gauge-text ${getStatusClass(cWk.pct)}`,
            y_align: Clutter.ActorAlign.CENTER
        });
        claudeRow.add_child(claudeWkLabel);
    }

    card.add_child(claudeRow);

    // 4. Row Gemini
    const geminiRow = new St.BoxLayout({
        vertical: false,
        style_class: 'antigravity-model-row',
        y_align: Clutter.ActorAlign.CENTER
    });

    const geminiIcon = new St.Icon({
        gicon: geminiGIcon,
        icon_size: 14,
        style_class: 'antigravity-model-icon',
        y_align: Clutter.ActorAlign.CENTER
    });
    geminiRow.add_child(geminiIcon);

    const geminiTag = new St.Label({
        text: 'Gemini :',
        style_class: 'antigravity-model-tag',
        y_align: Clutter.ActorAlign.CENTER
    });
    geminiRow.add_child(geminiTag);

    if (isFree) {
        const geminiWkLabel = new St.Label({
            text: `Hebdo [${renderBar(gWk.fraction, 14)}] ${gWk.pct}% (📅 ${gWk.timeStr})`,
            style_class: `antigravity-gauge-text ${getStatusClass(gWk.pct)}`,
            y_align: Clutter.ActorAlign.CENTER
        });
        geminiRow.add_child(geminiWkLabel);
    } else {
        const gemini5hLabel = new St.Label({
            text: ` 5h [${renderBar(g5h.fraction)}] ${g5h.pct}% (⏳ ${g5h.timeStr})`,
            style_class: `antigravity-gauge-text ${getStatusClass(g5h.pct)}`,
            y_align: Clutter.ActorAlign.CENTER
        });
        geminiRow.add_child(gemini5hLabel);

        const geminiSep = new St.Label({
            text: '  ·  ',
            y_align: Clutter.ActorAlign.CENTER
        });
        geminiRow.add_child(geminiSep);

        const geminiWkLabel = new St.Label({
            text: `Wk [${renderBar(gWk.fraction)}] ${gWk.pct}% (📅 ${gWk.timeStr})`,
            style_class: `antigravity-gauge-text ${getStatusClass(gWk.pct)}`,
            y_align: Clutter.ActorAlign.CENTER
        });
        geminiRow.add_child(geminiWkLabel);
    }

    card.add_child(geminiRow);

    return card;
}
