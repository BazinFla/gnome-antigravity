#!/usr/bin/env bash
set -e

# Navigate to repository root
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

UUID="antigravity-quota@bazinfla.github.com"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"

echo "🛸 Compiling GSettings schemas..."
glib-compile-schemas src/schemas/

echo "📁 Installing extension to $EXT_DIR..."
mkdir -p "$EXT_DIR"
cp -r src/metadata.json src/extension.js src/prefs.js src/stylesheet.css src/schemas src/lib src/ui "$EXT_DIR/"

echo "⚙️ Compiling installed schemas..."
glib-compile-schemas "$EXT_DIR/schemas/"

echo "🔄 Reloading and enabling..."
gnome-extensions enable "$UUID" 2>/dev/null || true

echo "✅ Extension installed successfully!"
echo "👉 If you are on Wayland, log out and log back in for GNOME Shell to load new files."
echo "👉 If you are on X11, press Alt+F2, type 'r', and press Enter."
echo "👉 To test preferences: gnome-extensions prefs $UUID"
