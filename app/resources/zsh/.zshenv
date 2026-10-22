# 앱이 ZDOTDIR 로 이 파일을 읽힌다. 지워야 나머지 시작 파일이 사용자 자리에서 읽힌다.
typeset -g _maru_zdotdir=$ZDOTDIR
unset ZDOTDIR
# claude 함수가 claude 에만 붙인 FORCE_HYPERLINK 를, claude 의 Bash 도구가 띄우는 이 셸에서 지운다.
if [[ -n $MARU_CLAUDE_FORCED_HYPERLINK ]]; then
  unset FORCE_HYPERLINK MARU_CLAUDE_FORCED_HYPERLINK
fi
[[ -f $HOME/.zshenv ]] && source $HOME/.zshenv

_maru_osc7() {
  emulate -L zsh
  local LC_ALL=C c hex out=
  local -i i
  for (( i = 1; i <= ${#PWD}; i++ )); do
    c=${PWD[i]}
    if [[ $c == [A-Za-z0-9/._~-] ]]; then
      out+=$c
    else
      printf -v hex '%%%02X' "'$c"
      out+=$hex
    fi
  done
  # 호스트를 비워야 앱이 ssh 로 붙은 다른 머신의 OSC 7 과 가른다.
  printf '\e]7;file://%s\a' $out
}
autoload -Uz add-zsh-hook
add-zsh-hook precmd _maru_osc7

# 로그인 셸은 이 파일 뒤에 /etc/zprofile 을 읽는다. 거기서 path_helper 가 /etc/paths 의 디렉토리를 앞에 두므로,
# 앱이 PATH 맨 앞에 붙인 maru 디렉토리가 뒤로 밀린다.
# 시작 파일을 다 읽은 첫 프롬프트에서 한 번 다시 앞에 붙이고 빠진다 — 그 뒤 사용자가 바꾼 PATH 는 둔다.
_maru_path() {
  emulate -L zsh
  add-zsh-hook -d precmd _maru_path
  [[ -n $MARU_CLI ]] || return 0
  local dir=${MARU_CLI:h}
  path=($dir ${path:#$dir})
}
add-zsh-hook precmd _maru_path

# `name()` 꼴은 사용자 ~/.zshenv 의 claude alias 가 펼쳐져 parse error 가 난다.
(( $+functions[claude] )) || function claude {
  # claude 안(CLAUDECODE)에서 부른 claude 는 이 pane 의 claude 가 아니다. 앱 plugin 의 hook 과 끝의 `claude exit` 가
  # 바깥 claude 의 pane 상태를 덮거나 지우므로 그대로 넘긴다.
  if [[ -z $MARU_CLI || -z $MARU_CLAUDE_PLUGIN || -n $CLAUDECODE ]]; then
    command claude "$@"
    return
  fi
  # 이 앱의 터미널 env 에서는 claude 가 FORCE_HYPERLINK 가 있을 때만 OSC 8 링크를 찍는다. 값은 claude 프로세스에만 붙인다.
  # 자식에게 물려주면 Bash 도구가 돌리는 CLI 가 파이프에 OSC 8 을 섞기 때문이다. zsh 는 로그인 여부와 상관없이 `$ZDOTDIR/.zshenv` 를 읽으므로,
  # ZDOTDIR 을 앱 디렉토리로 되돌려 Bash 도구의 셸이 이 파일 맨 위에서 지우게 한다. 사용자가 정해 둔 값은 덮지 않는다.
  local -a forced=()
  if [[ -z ${FORCE_HYPERLINK+set} ]]; then
    forced=(FORCE_HYPERLINK=1 MARU_CLAUDE_FORCED_HYPERLINK=1 ZDOTDIR=$_maru_zdotdir)
  fi
  # claude 가 SessionEnd hook 없이 죽어도 앱이 표시를 지우게. Ctrl-C 로 셸도 SIGINT 를 받으면 함수의
  # 남은 명령을 건너뛰므로 always 로 둔다.
  {
    env "${forced[@]}" claude --plugin-dir "$MARU_CLAUDE_PLUGIN" "$@"
  } always {
    "$MARU_CLI" claude exit
  }
}
