#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <site-output-dir> [alpha-tag]" >&2
  exit 2
}

[[ $# -ge 1 && $# -le 2 ]] || usage

site_dir=${1%/}
alpha_tag=${2:-}
repository=${GITHUB_REPOSITORY:-}
[[ -n "$repository" ]] || { echo "GITHUB_REPOSITORY is required" >&2; exit 1; }

mkdir -p "$site_dir/alpha" "$site_dir/stable" "$site_dir/download" \
  "$site_dir/stable/download" "$site_dir/releases" "$site_dir/release-notes"

fetch_releases() {
  local attempt=1
  local releases_file="$site_dir/releases.json"
  local temporary_file="${releases_file}.tmp"

  while (( attempt <= 4 )); do
    if gh api "repos/$repository/releases?per_page=100" --paginate > "$temporary_file"; then
      mv "$temporary_file" "$releases_file"
      return 0
    fi
    if (( attempt == 4 )); then
      echo "::warning::GitHub releases API failed after 4 attempts; publishing pages without release history"
      echo '[]' > "$releases_file"
      rm -f "$temporary_file"
      return 0
    fi
    sleep $((attempt * 2))
    ((attempt += 1))
  done
}

fetch_releases

stable_tag=$(gh release list --repo "$repository" --exclude-drafts --exclude-pre-releases --limit 1 --json tagName --jq '.[0].tagName // ""')
if [[ -n "$stable_tag" ]]; then
  gh release download --repo "$repository" "$stable_tag" --pattern stable-latest.json --output "$site_dir/stable/latest.json" || echo '{}' > "$site_dir/stable/latest.json"
else
  echo '{}' > "$site_dir/stable/latest.json"
fi

if [[ -z "$alpha_tag" ]]; then
  alpha_tag=$(gh release list --repo "$repository" --limit 100 --json tagName,isDraft,isPrerelease --jq '[.[] | select(.isDraft == false and .isPrerelease == true)][0].tagName // ""')
fi
if [[ -n "$alpha_tag" ]]; then
  gh release download --repo "$repository" "$alpha_tag" --pattern alpha-latest.json --output "$site_dir/alpha/latest.json" || echo '{}' > "$site_dir/alpha/latest.json"
else
  echo '{}' > "$site_dir/alpha/latest.json"
fi

if [[ -d release-notes ]]; then
  for note in release-notes/*.md; do
    [[ -e "$note" ]] || continue
    awk 'NR==1&&/^---$/{f=1;next} f&&/^---$/{f=0;next} !f' "$note" > "$site_dir/$note"
  done
fi

bun scripts/build-release-download-page.ts \
  --latest-json "$site_dir/stable/latest.json" \
  --releases-json "$site_dir/releases.json" \
  --output-file "$site_dir/download/index.html"
cp "$site_dir/download/index.html" "$site_dir/stable/download/index.html"
bun scripts/build-release-history-page.ts \
  --releases-json "$site_dir/releases.json" \
  --output-file "$site_dir/releases/index.html"
cp "$site_dir/alpha/latest.json" "$site_dir/latest.json"
cp "$site_dir/alpha/latest.json" "$site_dir/latest-canary.json"
