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
  printf '\e]7;file://%s%s\a' $HOST $out
}
autoload -Uz add-zsh-hook
add-zsh-hook precmd _maru_osc7
