# 앱 .zshenv 가 ZDOTDIR 을 앱 디렉토리로 둔 로그인 셸만 이 파일을 읽는다. 마지막 시작 파일이라 ZDOTDIR 을 사용자 값으로 남긴다.
_maru_rc_user
[[ -f "${ZDOTDIR:-$HOME}/.zlogin" ]] && source "${ZDOTDIR:-$HOME}/.zlogin"
_maru_path
