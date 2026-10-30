# 앱 .zshenv 가 ZDOTDIR 을 앱 디렉토리로 둔 로그인 셸만 이 파일을 읽는다.
_maru_rc_user
[[ -f "${ZDOTDIR:-$HOME}/.zprofile" ]] && source "${ZDOTDIR:-$HOME}/.zprofile"
_maru_rc_app
