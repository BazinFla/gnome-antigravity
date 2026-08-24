import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { QuotaCache } from '../lib/cache.js';

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
    const c5hPct = snapshot?.claude?.rolling5h?.pct ?? 100;
    const c5hFrac = snapshot?.claude?.rolling5h?.fraction ?? 1.0;
    const c5hTime = QuotaCache.formatCountdown(snapshot?.claude?.rolling5h?.resetTimestamp);

    const cWkPct = snapshot?.claude?.weekly?.pct ?? 100;
    const cWkFrac = snapshot?.claude?.weekly?.fraction ?? 1.0;
    const cWkTime = QuotaCache.formatCountdown(snapshot?.claude?.weekly?.resetTimestamp, true);

    const g5hPct = snapshot?.gemini?.rolling5h?.pct ?? 100;
    const g5hFrac = snapshot?.gemini?.rolling5h?.fraction ?? 1.0;
    const g5hTime = QuotaCache.formatCountdown(snapshot?.gemini?.rolling5h?.resetTimestamp);

    const gWkPct = snapshot?.gemini?.weekly?.pct ?? 100;
    const gWkFrac = snapshot?.gemini?.weekly?.fraction ?? 1.0;
    const gWkTime = QuotaCache.formatCountdown(snapshot?.gemini?.weekly?.resetTimestamp, true);

    // 3. Row Claude
    const claudeRow = new St.BoxLayout({
        vertical: false,
        style_class: 'antigravity-model-row'
    });

    const claudeTag = new St.Label({
        text: '⚡ Claude :',
        style_class: 'antigravity-model-tag'
    });
    claudeRow.add_child(claudeTag);

    const claude5hLabel = new St.Label({
        text: ` 5h [${renderBar(c5hFrac)}] ${c5hPct}% (⏳ ${c5hTime})`,
        style_class: `antigravity-gauge-text ${getStatusClass(c5hPct)}`
    });
    claudeRow.add_child(claude5hLabel);

    const claudeSep = new St.Label({ text: '  ·  ' });
    claudeRow.add_child(claudeSep);

    const claudeWkLabel = new St.Label({
        text: `Wk [${renderBar(cWkFrac)}] ${cWkPct}% (📅 ${cWkTime})`,
        style_class: `antigravity-gauge-text ${getStatusClass(cWkPct)}`
    });
    claudeRow.add_child(claudeWkLabel);

    card.add_child(claudeRow);

    // 4. Row Gemini
    const geminiRow = new St.BoxLayout({
        vertical: false,
        style_class: 'antigravity-model-row'
    });

    const geminiTag = new St.Label({
        text: '🔷 Gemini :',
        style_class: 'antigravity-model-tag'
    });
    geminiRow.add_child(geminiTag);

    const gemini5hLabel = new St.Label({
        text: ` 5h [${renderBar(g5hFrac)}] ${g5hPct}% (⏳ ${g5hTime})`,
        style_class: `antigravity-gauge-text ${getStatusClass(g5hPct)}`
    });
    geminiRow.add_child(gemini5hLabel);

    const geminiSep = new St.Label({ text: '  ·  ' });
    geminiRow.add_child(geminiSep);

    const geminiWkLabel = new St.Label({
        text: `Wk [${renderBar(gWkFrac)}] ${gWkPct}% (📅 ${gWkTime})`,
        style_class: `antigravity-gauge-text ${getStatusClass(gWkPct)}`
    });
    geminiRow.add_child(geminiWkLabel);

    card.add_child(geminiRow);

    return card;
}
