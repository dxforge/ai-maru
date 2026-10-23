# 설정 파일

AI Maru 는 `~/.ai-maru/config.toml` 을 읽는다. 앱은 이 폴더와 파일을 만들지 않는다. 파일이 없으면 기본값을 쓴다. 필요한 키만 적으면 된다.

```toml
[terminal]
font-family = "JetBrains Mono"
font-size = 13
line-height = 1.3

[layout]
header = "top"
palette = "top"
```

`MARU_CONFIG_DIR` 환경 변수를 주면 `~/.ai-maru` 대신 그 폴더의 `config.toml` 을 읽는다.

## 키

| 키 | 기본값 | 받는 값 |
| --- | --- | --- |
| `terminal.font-family` | `D2Coding, Menlo, 'Symbols Nerd Font Mono', monospace` | 글꼴 이름. 쉼표로 이어 여러 개를 적을 수 있다. |
| `terminal.font-size` | `14` | 8–32 의 숫자(px). 소수도 받는다. |
| `terminal.line-height` | `1.2` | 1–2 의 숫자. 글자 높이에 곱한 값이 행 높이다. 글자 높이는 글꼴이 정하고 글꼴 크기보다 조금 크다(기본 글꼴 14px 이면 15px). |
| `layout.header` | `"bottom"` | `"bottom"` 또는 `"top"`. pane 헤더와 workspace 헤더를 pane·workspace 의 아래에 둘지 위에 둘지. |
| `layout.palette` | `"bottom"` | `"bottom"` 또는 `"top"`. 명령 팔레트를 창의 아래에 띄울지 위에 띄울지. |

pane 헤더와 workspace 헤더도 터미널의 글꼴과 크기를 따른다.

### `header` 와 `palette`

Claude Code 의 입력창은 터미널 아래에 있어 시선이 아래에 머무르므로, 헤더와 명령 팔레트도 기본값으로 아래에 둔다.

팔레트가 아래면 입력줄이 팔레트 맨 아래에 있고, 후보는 그 위에 놓인다. 가장 잘 맞는 후보가 입력줄 바로 위이고, ↑ 가 다음 후보를 고른다. 위면 입력줄이 맨 위에 있고 ↓ 가 다음 후보를 고른다.

### `font-family`

적은 글꼴은 기본 글꼴 목록 앞에 붙는다. 적은 글꼴에 없는 글자(한글, Nerd Font 아이콘 등)는 뒤의 기본 글꼴이 그린다. 이름은 따옴표로 감싸도 되고 감싸지 않아도 된다(`"'Sarasa Term K', Menlo"`). 이름 안에 `"` `'` `;` `\` 나 줄바꿈 같은 제어 문자가 있거나 빈 이름이 있으면 값 전체를 버리고 기본 글꼴을 쓴다.

`serif`·`sans-serif`·`monospace`·`cursive`·`fantasy`·`system-ui`·`ui-serif`·`ui-sans-serif`·`ui-monospace`·`ui-rounded`·`math`·`emoji`·`fangsong` 은 CSS generic family 키워드로 넣는다. 따옴표로 감싸 적어도 키워드로 다룬다. 앱의 Chromium 은 `ui-serif`·`ui-sans-serif`·`ui-monospace`·`ui-rounded` 를 지원하지 않아 그다음 글꼴로 그린다. 그래서 macOS 의 시스템 고정폭 글꼴(SF Mono)은 `ui-monospace` 로 고를 수 없다. 그 밖의 이름은 따옴표로 감싸 글꼴 이름으로 넣는다.

앱은 적은 이름마다 그린 글자 폭을 재서 쓸 수 없는 글꼴과 키워드를 토스트로 알린다. 위의 `ui-` 키워드 넷과 `math`·`emoji`·`fangsong` 도 토스트에 나온다. 이 셋을 앱의 Chromium 이 지원하는지는 확인하지 않았다.

### 범위를 벗어나거나 잘못 적은 값

- 범위를 벗어난 숫자는 가까운 끝값으로 맞춘다(`font-size = 40` 이면 32).
- 숫자 자리에 숫자가 아닌 값을 적거나 `font-family` 에 문자열이 아닌 값을 적으면 그 키는 기본값을 쓴다. `header`·`palette` 에 `"top"`·`"bottom"` 이 아닌 값을 적어도 기본값을 쓴다.
- 모르는 키는 무시한다.

## 고치면 바로 적용된다

앱은 `~/.ai-maru/` 폴더를 지켜보다가 `config.toml` 을 저장하면 다시 읽어 떠 있는 모든 터미널에 적용한다. 단, ⌘+ / ⌘- 로 글꼴 크기를 바꾼 workspace 는 `font-size` 가 바뀌어도 그 크기를 지킨다. 폴더가 없는 채로 앱을 띄웠어도 폴더와 파일을 만들면 적용한다. 파일을 지우면 기본값으로 돌아간다. 셀 크기가 바뀌므로 터미널 안의 프로그램은 창 크기가 바뀐 것처럼 다시 그린다.

`config.toml` 을 심볼릭 링크로 두면 링크 자체를 바꿀 때만 다시 읽는다. 링크가 가리키는 파일을 고친 것은 알아채지 못한다.

## 단축키로 글꼴 크기 바꾸기

⌘+ / ⌘- 는 선택한 workspace 의 모든 터미널 글꼴 크기를 1px 씩 바꾸고, ⌘0 은 `font-size` 로 되돌린다. ⌘= 도 글꼴을 키운다. ⌘+ 의 ⇧ 를 쥔 채 누른 ⇧⌘- / ⇧⌘0 은 ⌘- / ⌘0 과 같이 동작한다. 범위는 `font-size` 와 같은 8–32 다. 바꾼 크기는 `config.toml` 에 쓰지 않고, 앱 안의 Restart 로 다시 띄울 때만 남는다. 새로 연 workspace 는 `font-size` 로 시작한다.

## 문제가 있으면

창 왼쪽 아래에 토스트가 뜬다. 문제가 남아 있는 동안 떠 있고, 고쳐서 문제 없이 읽히면 닫힌다. 닫기 버튼으로 닫아도 다시 저장하면 다시 뜬다.

- TOML 문법 오류나 읽기 오류: 줄·열 번호나 오류 메시지를 보인다. 마지막으로 적용한 값을 그대로 쓴다. 앱을 띄울 때 오류가 있으면 기본값을 쓴다.
- 범위를 벗어나 맞춘 값, 기본값을 쓴 값, 모르는 키, 쓸 수 없는 글꼴과 키워드: 값을 적용한 뒤 무엇이 달랐는지 보인다.
