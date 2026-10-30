# 앱이 ZDOTDIR 로 이 파일을 읽힌다. 지워야 나머지 시작 파일이 사용자 자리에서 읽힌다.
unset ZDOTDIR
# 앱의 claude shim 이 claude 에만 붙인 FORCE_HYPERLINK 를, claude 의 Bash 도구가 띄우는 이 셸에서 지운다.
if [[ -n $MARU_CLAUDE_FORCED_HYPERLINK ]]; then
  unset FORCE_HYPERLINK MARU_CLAUDE_FORCED_HYPERLINK
fi
[[ -f $HOME/.zshenv ]] && source $HOME/.zshenv

_maru_pct() {
  emulate -L zsh
  local LC_ALL=C c hex
  local -i i
  REPLY=
  for (( i = 1; i <= ${#1}; i++ )); do
    c=${1[i]}
    if [[ $c == [A-Za-z0-9/._~-] ]]; then
      REPLY+=$c
    else
      printf -v hex '%%%02X' "'$c"
      REPLY+=$hex
    fi
  done
}

_maru_osc7() {
  emulate -L zsh
  local REPLY
  _maru_pct $PWD
  # 호스트를 비워야 앱이 ssh 로 붙은 다른 머신의 OSC 7 과 가른다.
  printf '\e]7;file://%s\a' $REPLY
}
autoload -Uz add-zsh-hook
add-zsh-hook precmd _maru_osc7

# claude 의 Bash 도구가 띄운 셸(CLAUDECODE)은 바깥 pane 의 tty 를 물려받으므로 OSC 133 을 쓰지 않는다.
# stdout 은 리다이렉트될 수 있어 tty 에 쓴다. 자식에게 새지 않게 cloexec 로 연다.
if [[ -o interactive && -z $CLAUDECODE ]]; then
  typeset -gi _maru_tty=-1 _maru_ran=0
  { zmodload zsh/system && sysopen -o cloexec -wu _maru_tty /dev/tty } 2> /dev/null
  # 사용자 시작 파일이 preexec_functions 를 덮어도 걸리게 첫 프롬프트에서 건다. precmd_functions 까지 덮으면 걸리지 않는다.
  (( _maru_tty >= 0 )) && add-zsh-hook precmd _maru_osc133_init
fi

_maru_osc133_init() {
  emulate -L zsh
  add-zsh-hook -d precmd _maru_osc133_init
  add-zsh-hook preexec _maru_osc133_preexec
  add-zsh-hook precmd _maru_osc133_precmd
  _maru_osc133_precmd
}

# libghostty-vt 는 2048 바이트를 넘는 OSC 133 을 통째로 버린다. 한 글자는 %XX 로 인코딩하면 12 바이트까지 되므로 앞 169 글자만 싣는다.
_maru_osc133_preexec() {
  emulate -L zsh
  # exec 로 바뀐 프로그램은 이 훅이 없어 D·A 를 보내지 않으므로, C 를 보내면 pane 이 끝까지 도는 중으로 남는다.
  # `$1` 은 친 그대로라 alias 가 exec 로 확장되는 것을 놓치므로, alias 를 확장한 `$3` 으로 본다.
  _maru_osc133_execs ${(z)3} && return
  local REPLY cmd=$1
  _maru_osc133_job ${(z)1} && cmd=$REPLY
  _maru_pct ${cmd[1,169]}
  { print -nu $_maru_tty "\e]133;C;cmdline_url=$REPLY\a" } 2> /dev/null
  _maru_ran=1
}

# `${(z)}` 로 나눈 명령줄에서 명령 자리의 exec 가 리다이렉션 말고 명령을 받으면 참이다.
# 리다이렉션만 받은 exec(`exec 2>file`)는 셸을 바꾸지 않는다. 서브셸 `( … )` 안의 exec 는 서브셸만 바꾸고
# 함수 정의 `name () { … }` 의 몸통은 지금 돌지 않으므로, 둘 다 닫힐 때까지 건너뛴다.
# `$3` 은 `(`·`{` 뒤에 줄바꿈을 넣어 `;` 가 따로 한 토큰으로 나오므로, 건너뛰지 않으면 그 안의 exec 가 명령 자리로 잡힌다.
_maru_osc133_execs() {
  emulate -L zsh -o extended_glob
  local w open close
  local -i at=1 inexec=0 target=0 depth=0 body=0
  for w in "$@"; do
    if (( depth )); then
      [[ $w == "$open" ]] && (( depth++ ))
      [[ $w == "$close" ]] && (( --depth == 0 )) && at=1
      continue
    fi
    if (( body )) && [[ $w == \{ ]]; then
      body=0 open=\{ close=\} depth=1
      continue
    fi
    if (( target )); then
      target=0
      continue
    fi
    if [[ $w == (\;|\&\&|\|\||\||\|\&|\&|\&\||\&\!) ]]; then
      at=1 inexec=0
    elif (( inexec )); then
      # `2>`·`>&`·`&>`·`<<<` 같은 리다이렉션 연산자 다음 토큰은 그 대상이다. `${(z)}` 는 `{fd}>file` 의 `{fd}` 를 따로 나눈다.
      if [[ $w == (<->|)(\<|\>|\&\>)* ]]; then
        target=1
      elif [[ $w != \{[[:IDENT:]]##\} ]]; then
        return 0
      fi
    elif [[ $w == '()' ]]; then
      # 이름 없는 `() { … }` 는 몸통을 바로 돌린다.
      (( at )) || body=1
    elif (( at )); then
      case $w in
        (exec) inexec=1 ;;
        (\() open=\( close=\) depth=1 ;;
        # `builtin`·`noglob`·`-` 뒤의 exec 도 셸을 바꾼다. `command exec` 는 exec 라는 외부 명령을 찾는다.
        (\{|\!|if|then|else|elif|do|while|until|time|builtin|noglob|-|[[:IDENT:]]##=*) ;;
        (*) at=0 ;;
      esac
    fi
  done
  return 1
}

# `fg`·`fg %spec`·`%spec` 로 재개한 job 이면 그 job 의 명령을 REPLY 에 넣는다.
_maru_osc133_job() {
  emulate -L zsh
  local spec n m
  if [[ $1 == fg && $# -le 2 ]]; then
    spec=${2:-%+}
  elif [[ $1 == %* && $# -eq 1 ]]; then
    spec=$1
  else
    return 1
  fi
  case $spec in
    (%|%%|%+|%-)
      m=${spec[2]:-+}
      [[ $m == % ]] && m=+
      for n in ${(k)jobstates}; do
        [[ ${${(s.:.)jobstates[$n]}[2]} == $m ]] && break
        n=
      done ;;
    (%<->) n=${spec[2,-1]} ;;
    (%\?*)
      for n in ${(kon)jobtexts}; do
        [[ $jobtexts[$n] == *${spec[3,-1]}* ]] && break
        n=
      done ;;
    (%*)
      for n in ${(kon)jobtexts}; do
        [[ $jobtexts[$n] == ${spec[2,-1]}* ]] && break
        n=
      done ;;
    (*) return 1 ;;
  esac
  [[ -n $n && -n $jobtexts[$n] ]] || return 1
  REPLY=$jobtexts[$n]
}

_maru_osc133_precmd() {
  local -i code=$?
  emulate -L zsh
  # zle 위젯이 다시 부른 precmd 는 명령이 끝난 자리가 아니다.
  if (( _maru_ran )) && ! zle; then
    # Ctrl-Z 로 멈춘 명령은 끝나지 않았으므로 종료 코드 없이 D 를 보내 실패로 보이지 않게 한다. 멈춘 job 은 현재 job(+)이 된다.
    if (( code > 128 )) && [[ $signals[code-127] == (TSTP|STOP|TTIN|TTOU) && -n ${(M)${(v)jobstates}:#suspended:+:*} ]]; then
      { print -nu $_maru_tty '\e]133;D\a' } 2> /dev/null
    else
      { print -nu $_maru_tty "\e]133;D;$code\a" } 2> /dev/null
    fi
    _maru_ran=0
  fi
  { print -nu $_maru_tty '\e]133;A\a' } 2> /dev/null
}

# 로그인 셸은 이 파일 뒤에 /etc/zprofile 을 읽는다. 거기서 path_helper 가 /etc/paths 의 디렉토리를 앞에 두므로,
# 앱이 PATH 맨 앞에 붙인 maru 디렉토리와 claude shim 디렉토리(plugin 옆 `bin`)가 뒤로 밀린다.
# 시작 파일을 다 읽은 첫 프롬프트에서 한 번 다시 앞에 붙이고 빠진다 — 그 뒤 사용자가 바꾼 PATH 는 둔다.
_maru_path() {
  emulate -L zsh
  add-zsh-hook -d precmd _maru_path
  [[ -n $MARU_CLI ]] || return 0
  local -a dirs=(${MARU_CLI:h})
  [[ -n $MARU_CLAUDE_PLUGIN ]] && dirs+=(${MARU_CLAUDE_PLUGIN:h}/bin)
  local dir
  for dir in $dirs; do
    path=(${path:#$dir})
  done
  path=(${(u)dirs} $path)
}
add-zsh-hook precmd _maru_path
