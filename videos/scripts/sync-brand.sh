#!/usr/bin/env bash
set -euo pipefail

# Sync brand assets from refactoringhq/brand (private repo)
# Uses existing GitHub auth from the environment

BRAND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/brand"
BRAND_REPO="https://github.com/refactoringhq/brand.git"
TEMP_CLONE="/tmp/refactoring-brand-$$"

# Use gh CLI for auth if available
if command -v gh &> /dev/null && gh auth status &> /dev/null; then
  GH_TOKEN=$(gh auth token 2>/dev/null)
  if [ -n "$GH_TOKEN" ]; then
    BRAND_REPO="https://x-access-token:${GH_TOKEN}@github.com/refactoringhq/brand.git"
  fi
fi

echo "🎨 Syncing Refactoring brand kit..."

# Clean up temp on exit
trap 'rm -rf "$TEMP_CLONE"' EXIT

# Sparse checkout: only grab the folders we need
mkdir -p "$TEMP_CLONE"
cd "$TEMP_CLONE"

git init --quiet
git remote add origin "$BRAND_REPO"

# Configure sparse checkout
git config core.sparseCheckout true
cat > .git/info/sparse-checkout <<EOF
tokens/
fonts/
assets/
README.md
EOF

echo "📥 Fetching brand assets (sparse checkout)..."
if ! git fetch --depth=1 origin main 2>&1; then
  echo "❌ Failed to fetch brand repo. Check GitHub auth (gh auth status)."
  exit 1
fi

git checkout main --quiet

# Copy to videos/brand/
echo "📦 Installing to videos/brand/..."
rm -rf "$BRAND_DIR"
mkdir -p "$BRAND_DIR"

cp -r tokens "$BRAND_DIR/"
cp -r fonts "$BRAND_DIR/"
cp -r assets "$BRAND_DIR/"
cp README.md "$BRAND_DIR/BRAND_README.md"

echo "✅ Brand kit synced to videos/brand/"
echo "   - tokens/colors.json, variables.css, theme.css"
echo "   - fonts/ (Refactoring Sans, Inter Tight, Refactoring Hand)"
echo "   - assets/ (154 SVG icons, arrows, emphasis shapes)"
echo ""
echo "Run 'pnpm --dir videos render' to render with the brand kit."
