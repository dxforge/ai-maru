# 앱 .zshenv 가 ZDOTDIR 을 앱 디렉토리로 둔 로그인 셸만 이 파일을 읽는다.
_maru_rc_user
# 이 파일보다 먼저 읽는 /etc/zshrc(macOS)가 HISTFILE 을 ${ZDOTDIR:-$HOME}/.zsh_history 로 정한다. 그때 ZDOTDIR 은 앱 디렉토리라서 사용자의 기록 파일로 되돌린다.
[[ $HISTFILE == "$_maru_zdotdir/.zsh_history" ]] && HISTFILE=${ZDOTDIR:-$HOME}/.zsh_history
[[ -f "${ZDOTDIR:-$HOME}/.zshrc" ]] && source "${ZDOTDIR:-$HOME}/.zshrc"
_maru_rc_app
