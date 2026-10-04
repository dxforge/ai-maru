#!/bin/bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

# stdout 에는 .app 경로만 남긴다 — 부르는 쪽이 받는다.
{
  cargo build --release --manifest-path "$root/core/Cargo.toml"
  cd "$root/app"
  pnpm build
  # electron-builder 는 이번 아키텍처의 출력만 지워, 다른 아키텍처로 만든 옛 .app 이 남는다.
  rm -rf dist
  pnpm exec electron-builder
} >&2
find "$root/app/dist" -maxdepth 2 -name '*.app' -print -quit
