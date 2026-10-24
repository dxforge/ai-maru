#!/bin/bash
set -euo pipefail

commit=04a98db045eb5d71c2247ca6c050ab97290d081c
repo=https://github.com/mbadolato/iTerm2-Color-Schemes

root="$(cd "$(dirname "$0")/.." && pwd)"
dest="$root/app/src/renderer/src/themes"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -fsSL "$repo/archive/$commit.tar.gz" | tar -xzf - -C "$tmp"
src="$tmp/iTerm2-Color-Schemes-$commit"

rm -rf "$dest/ghostty"
cp -R "$src/ghostty" "$dest/ghostty"
cp "$src/LICENSE" "$dest/LICENSE"
printf '%s\n%s/tree/%s/ghostty\n' "$repo" "$repo" "$commit" > "$dest/SOURCE"
echo "$(ls "$dest/ghostty" | wc -l | tr -d ' ') themes from $commit" >&2
