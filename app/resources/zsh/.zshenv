# 앱이 ZDOTDIR 로 이 파일을 읽힌다. 지워야 나머지 시작 파일이 사용자 자리에서 읽힌다.
unset ZDOTDIR
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
  if [[ -z $MARU_CLI || -z $MARU_CLAUDE_PLUGIN ]]; then
    command claude "$@"
    return
  fi
  # claude 가 SessionEnd hook 없이 죽어도 앱이 표시를 지우게. Ctrl-C 로 셸도 SIGINT 를 받으면 함수의
  # 남은 명령을 건너뛰므로 always 로 둔다.
  {
    command claude --plugin-dir "$MARU_CLAUDE_PLUGIN" "$@"
  } always {
    "$MARU_CLI" claude exit
  }
}
