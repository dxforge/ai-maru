# 앱이 ZDOTDIR 로 이 파일을 읽힌다. 지워야 나머지 시작 파일이 사용자 자리에서 읽힌다.
typeset -g _maru_zdotdir=$ZDOTDIR
unset ZDOTDIR
# claude 함수가 claude 에만 붙인 FORCE_HYPERLINK 를, claude 의 Bash 도구가 띄우는 이 셸에서 지운다. SessionStart hook 이
# claude 의 세션 env 파일(`CLAUDE_ENV_FILE`)에 쓰는 방법은 쓸 수 없다 — claude 는 그 파일을 hook 이 끝나기 전에 한 번
# 읽고 없음으로 캐시해 Bash 도구에 적용하지 않는다(2.1.308 실측).
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
  if [[ -z $MARU_CLI || -z $MARU_CLAUDE_PLUGIN ]]; then
    command claude "$@"
    return
  fi
  # 이 앱의 터미널 env 에서는 claude 가 FORCE_HYPERLINK 가 있을 때만 OSC 8 링크를 찍는다. 값은 claude 프로세스에만
  # 붙인다 — 자식에게 물려주면 Bash 도구가 돌리는 CLI 가 파이프에 OSC 8 을 섞는다. Bash 도구는 `$SHELL -l -c` 로 로그인
  # 셸을 띄우므로, ZDOTDIR 을 앱 디렉토리로 되돌려 그 셸이 이 파일 맨 위에서 지우게 한다. 사용자가 정해 둔 값은 덮지
  # 않고, claude 안(CLAUDECODE)에서 띄운 claude 는 출력이 파이프일 수 있어 붙이지 않는다.
  local -a forced=()
  if [[ -z $CLAUDECODE && -z ${FORCE_HYPERLINK+set} ]]; then
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
