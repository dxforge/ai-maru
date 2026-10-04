#!/bin/bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
name="AI Maru"
dest="/Applications/$name.app"
exe="$dest/Contents/MacOS/$name"

# pgrep 은 자기 조상 프로세스를 돌려주지 않아, 이 앱의 터미널에서 돌리면 떠 있는 앱을 못 본다.
# grep -q 는 찾자마자 끝나 ps 가 SIGPIPE 로 죽고, pipefail 이 그것을 "없음" 으로 만든다.
running() {
  ps -axo comm= | grep -xF "$exe" >/dev/null
}

# 앱이 끝날 때 세션을 모두 끝내므로, 이 스크립트가 앱을 끄면 앱의 터미널에서 돌던 이 스크립트도 끝난다.
refuse_if_running() {
  if running; then
    echo "$name is running. Quit it and run this again." >&2
    exit 1
  fi
}

refuse_if_running
app="$("$root/scripts/package-app.sh")"
refuse_if_running

stage="/Applications/.$name.app.incoming"
old="/Applications/.$name.app.old"
rm -rf "$stage" "$old"
trap 'rm -rf "$stage"' EXIT
cp -c -R "$app" "$stage"
if [ -e "$dest" ]; then mv "$dest" "$old"; fi
mv "$stage" "$dest"
rm -rf "$old"
echo "Installed $dest"
