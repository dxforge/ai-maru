#!/bin/sh
# 원본은 Font Logos 같은 다른 아이콘 세트까지 담은 2MB 남짓한 글꼴이다.
set -eu

version=v3.5.1
root=$(cd "$(dirname "$0")/.." && pwd)
icons="$root/app/src/renderer/src/icons.ts"
out="$root/app/src/renderer/src/assets/symbols.woff2"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "https://github.com/ryanoasis/nerd-fonts/releases/download/$version/NerdFontsSymbolsOnly.tar.xz" |
  tar -xJ -C "$tmp"

unicodes=$(grep -o '\\u[0-9A-Fa-f]\{4\}' "$icons" | sed 's/\\u/U+/' | sort -u | paste -sd, -)
uvx --from 'fonttools[woff]' pyftsubset "$tmp/SymbolsNerdFont-Regular.ttf" \
  --unicodes="$unicodes" --flavor=woff2 --no-hinting --output-file="$out"
