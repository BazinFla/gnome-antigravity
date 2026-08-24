#!/usr/bin/env bash
set -e

# Navigate to repository root
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

UUID="antigravity-quota@bazinfla.github.com"
ZIP_NAME="${UUID}.shell-extension.zip"
DIST_DIR="$ROOT_DIR/dist"

echo "🧹 Cleaning previous builds..."
mkdir -p "$DIST_DIR"
rm -f "$DIST_DIR/$ZIP_NAME" "$ZIP_NAME"

echo "⚙️ Compiling GSettings schemas..."
glib-compile-schemas src/schemas/

echo "📦 Packaging GNOME Shell extension from src/..."
gnome-extensions pack \
    --force \
    --extra-source=ui \
    --extra-source=lib \
    --extra-source=stylesheet.css \
    --out-dir="$DIST_DIR" \
    src

echo "✅ Archive created successfully: dist/$ZIP_NAME"
echo "👉 To install the generated archive:"
echo "   gnome-extensions install --force dist/$ZIP_NAME"
