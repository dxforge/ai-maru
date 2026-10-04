#!/bin/bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../ghostty-vt.env
source "$root/ghostty-vt.env"

if [ $# -lt 1 ]; then
  echo "usage: $0 <output dir> [zig target]" >&2
  exit 2
fi
if ! command -v zig >/dev/null; then
  echo "zig $ZIG_VERSION must be on PATH" >&2
  exit 1
fi
mkdir -p "$1"
out="$(cd "$1" && pwd)"
zig_target="${2:-}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
curl -fsSL "https://github.com/ghostty-org/ghostty/archive/$GHOSTTY_COMMIT.tar.gz" |
  tar -xz -C "$work" --strip-components=1

args=(-Demit-lib-vt=true -Demit-xcframework=false -Doptimize=ReleaseFast)
if [ -n "$zig_target" ]; then
  args+=("-Dtarget=$zig_target")
fi
(cd "$work" && zig build "${args[@]}")

mkdir -p "$out/lib" "$out/include"
cp "$work/zig-out/lib/libghostty-vt.a" "$out/lib/"
cp -R "$work/include/ghostty" "$out/include/"
echo "$GHOSTTY_COMMIT" >"$out/COMMIT"
