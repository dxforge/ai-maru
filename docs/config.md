# 설정 파일

AI Maru 는 `~/.ai-maru/config.toml` 을 읽는다. 앱은 이 파일을 만들지 않는다. 파일이 없으면 기본값을 쓴다. 필요한 키만 적으면 된다.

```toml
[terminal]
font-family = "JetBrains Mono"
font-size = 13
line-height = 1.3
theme = "Catppuccin Mocha"

[layout]
header = "top"
palette = "top"
column-cols = 110

[launcher]
commands = ["claude", "codex"]
```

`MARU_CONFIG_DIR` 환경 변수를 주면 `~/.ai-maru` 대신 그 폴더의 `config.toml` 을 읽는다.

앱은 터미널의 소켓과 레코드를 `~/.ai-maru/run/` 아래에 둔다. 이 폴더는 앱이 만든다(권한 0700). 유닉스 소켓 경로는 macOS 에서 103바이트까지만 되므로, 홈 경로가 길어 터미널이 뜨지 않으면 `MARU_RUN_DIR` 환경 변수로 `~/.ai-maru/run` 대신 쓸 짧은 폴더를 준다.

## 키

| 키 | 기본값 | 받는 값 |
| --- | --- | --- |
| `terminal.font-family` | `D2Coding, Menlo, 'Symbols Nerd Font Mono', monospace` | 글꼴 이름. 쉼표로 이어 여러 개를 적을 수 있다. |
| `terminal.font-size` | `14` | 8–32 의 숫자(px). 소수도 받는다. |
| `terminal.line-height` | `1.2` | 1–2 의 숫자. 글자 높이에 곱한 값이 행 높이다. 글자 높이는 글꼴이 정하고 글꼴 크기보다 조금 크다(기본 글꼴 14px 이면 15px). |
| `terminal.theme` | 없음(Ghostty 의 기본 색) | 테마 이름, 또는 라이트·다크 모드마다 다른 테마를 적는 `{ light = "…", dark = "…" }`. |
| `layout.header` | `"bottom"` | `"bottom"` 또는 `"top"`. pane 헤더와 cell 헤더를 pane·cell 의 아래에 둘지 위에 둘지. |
| `layout.palette` | `"bottom"` | `"bottom"` 또는 `"top"`. 명령 팔레트와 런처를 창의 아래에 띄울지 위에 띄울지. |
| `layout.column-cols` | `80` | 20–500 의 정수(열 수). columns 보기에서 pane 하나가 받는 터미널 열 수. |
| `layout.column-step` | `20` | 1–480 의 정수(열 수). Widen Cell · Narrow Cell 이 선택한 cell 의 pane 폭을 한 번에 바꾸는 열 수. |
| `launcher.commands` | `["claude", "codex"]` | 비지 않은 문자열 배열. 런처(⌘P)가 띄울 명령. |

pane 헤더와 cell 헤더도 터미널의 글꼴과 크기를 따른다.

### `header` 와 `palette`

Claude Code 의 입력창은 터미널 아래에 있어 시선이 아래에 머무르므로, 헤더와 명령 팔레트도 기본값으로 아래에 둔다.

팔레트가 아래면 입력줄이 팔레트 맨 아래에 있고, 후보는 그 위에 놓인다. 가장 잘 맞는 후보가 입력줄 바로 위이고, ↑ 가 다음 후보를 고른다. 위면 입력줄이 맨 위에 있고 ↓ 가 다음 후보를 고른다.

### `column-cols`

columns 보기에서 cell 은 pane 하나가 이 열 수를 받는 폭으로 그려진다. 좌우로 나눈 cell 은 pane 수만큼 넓어진다. 터미널 열 수라서 글꼴 크기를 바꾸면 픽셀 폭도 바뀐다.

Widen Cell · Narrow Cell 은 선택한 cell 의 pane 폭을 `column-step` 만큼 넓히거나 좁힌다. 두 명령으로 폭을 바꾼 cell 은 `column-cols` 가 바뀌어도 그 폭을 지킨다. 바꾸지 않은 cell 은 저장하면 바로 새 폭이 된다. 두 명령으로 `column-cols` 와 같은 폭에 돌아온 cell 은 다시 `column-cols` 를 따른다. 바꾼 폭은 `config.toml` 에 쓰지 않고, 다음 실행이 레이아웃을 되살릴 때 남는다(앱을 끌 때 End everything 을 고르지 않았을 때).

### `column-step`

Widen Cell · Narrow Cell 이 선택한 cell 의 pane 폭을 한 번에 바꾸는 열 수다. 정수이고 기본값은 20 이다. 기본 설정에서 Widen Cell 을 누르면 80 → 100 → 120 … 으로 넓어진다.

두 명령은 지금 폭에서 이 열 수를 더하거나 뺀다. 지금 폭이 `column-cols` 에서 이 열 수의 배수만큼 떨어져 있지 않아도(95 등) 그 폭에서 바꾼다(95 → 115, 95 → 75). 바꾼 폭이 20–500 밖이면 폭을 그대로 둔다(기본 설정에서 30 을 좁혀도 30). 그래서 20–500 안의 폭에서 넓히기나 좁히기로 폭이 바뀌었다면 반대 명령 한 번으로 이전 폭에 돌아온다. 480 보다 큰 값은 20–500 의 어느 폭에서 더하거나 빼도 범위 밖으로 나가 폭이 바뀌지 않으므로, 480 으로 맞춘다.

### `launcher`

런처(⌘P, File 메뉴의 Open Launcher)는 디렉토리를 고른 뒤 명령을 골라 그 디렉토리에서 띄운다. 명령 목록은 `commands` 의 항목 뒤에 명령 없이 셸만 여는 `shell` 이 붙는다. `shell` 로 연 pane 은 ⌘N 으로 연 pane 과 같다. 명령 단계에서 Enter 는 새 workspace 에, ⌘Enter 는 지금 workspace 의 새 cell 에 띄운다. Esc 는 디렉토리 단계로 돌아간다. 명령 단계는 마지막으로 띄운 명령을 먼저 고른다.

디렉토리 단계에서 `~`·`/` 로 시작하는 경로를 치면 하위 디렉토리를 후보로 보인다. Tab 은 고른 후보를 입력에 채우고 `/` 를 붙인다. `/` 로 끝난 경로에서 Enter 는 후보가 아니라 친 디렉토리를 고른다.

항목 하나가 명령 하나다. 앱은 항목을 공백으로 나눠 인자로 넘기고 따옴표는 풀지 않는다(`"claude --model opus"` 는 `claude`·`--model`·`opus`). 로그인 셸이 sh·bash·zsh·ksh·dash 면 명령은 그 셸의 대화형 모드(`-i -c`)를 거쳐 뜨므로, 터미널에서 친 것과 같이 rc 가 정한 PATH·함수를 쓴다. 그 밖의 셸이면 `/bin/sh -c` 로 뜬다. 명령이 0 이나 130(Ctrl-C 의 SIGINT)으로 끝나면 pane 이 닫힌다. 그 밖의 코드나 SIGINT 가 아닌 시그널로 끝나면 pane 이 출력과 `[exited with code N]`(시그널이면 `[exited with signal N]`)을 남긴다. PATH 에 없는 명령은 셸이 127 로 끝나므로 pane 에 오류가 남는다.

런처의 최근 목록은 `config.toml` 이 아니라 앱 데이터 폴더의 `launcher.json` 에 앱이 쓴다. 런처로 연 디렉토리만 들어가고, 런처에서 ⇧⌘⌫ 나 행의 × 로 지운다.

### `font-family`

적은 글꼴은 기본 글꼴 목록 앞에 붙는다. 적은 글꼴에 없는 글자(한글, Nerd Font 아이콘 등)는 뒤의 기본 글꼴이 그린다. 이름은 따옴표로 감싸도 되고 감싸지 않아도 된다(`"'Sarasa Term K', Menlo"`). 이름 안에 `"` `'` `;` `\` 나 줄바꿈 같은 제어 문자가 있거나 빈 이름이 있으면 값 전체를 버리고 기본 글꼴을 쓴다.

`serif`·`sans-serif`·`monospace`·`cursive`·`fantasy`·`system-ui`·`ui-serif`·`ui-sans-serif`·`ui-monospace`·`ui-rounded`·`math`·`emoji`·`fangsong` 은 CSS generic family 키워드로 넣는다. 따옴표로 감싸 적어도 키워드로 다룬다. 앱의 Chromium 은 `ui-serif`·`ui-sans-serif`·`ui-monospace`·`ui-rounded` 를 지원하지 않아 그다음 글꼴로 그린다. 그래서 macOS 의 시스템 고정폭 글꼴(SF Mono)은 `ui-monospace` 로 고를 수 없다. 그 밖의 이름은 따옴표로 감싸 글꼴 이름으로 넣는다.

앱은 적은 이름마다 그린 글자 폭을 재서 쓸 수 없는 글꼴과 키워드를 토스트로 알린다. 위의 `ui-` 키워드 넷과 `math`·`emoji`·`fangsong` 도 토스트에 나온다. 이 셋을 앱의 Chromium 이 지원하는지는 확인하지 않았다.

### `theme`

앱에 든 테마는 [iTerm2-Color-Schemes](https://github.com/mbadolato/iTerm2-Color-Schemes) 의 Ghostty export 전부다. 이름은 저장소의 `app/src/renderer/src/themes/ghostty/` 의 파일 이름이고, Ghostty 의 `ghostty +list-themes` 가 보이는 이름과 같다. 대소문자와 공백까지 그대로 적는다(`"Catppuccin Mocha"`, `"GitHub Light Default"`, `"Rose Pine"`).

```toml
[terminal]
theme = "Catppuccin Mocha"
```

테마는 터미널의 배경·글자·16색·커서·선택 색을 정한다. 앱은 사이드바·헤더 같은 앱 화면의 색과 창 틀(타이틀바)의 밝기도 터미널 테마에서 계산하므로, 테마를 바꾸면 함께 바뀐다. 적지 않으면 Ghostty 의 기본 색이다.

macOS 의 라이트·다크 모드마다 다른 테마를 쓰려면 둘을 함께 적는다. OS 모드가 바뀌면 테마도 바로 바뀐다. 테마 이름 하나만 적으면 모드와 상관없이 그 테마다.

```toml
[terminal]
theme = { light = "Catppuccin Latte", dark = "Catppuccin Mocha" }
```

모르는 이름을 적거나, `light`·`dark` 가운데 하나만 적거나, 이름도 `{ light, dark }` 표도 아닌 값을 적으면 기본 색을 쓰고 토스트로 알린다.

### 범위를 벗어나거나 잘못 적은 값

- 범위를 벗어난 숫자는 가까운 끝값으로 맞춘다(`font-size = 40` 이면 32, `column-cols = 10` 이면 20).
- 숫자 자리에 숫자가 아닌 값을 적거나 `font-family` 에 문자열이 아닌 값을 적으면 그 키는 기본값을 쓴다. `column-cols`·`column-step` 에 정수가 아닌 값(`100.5`)을 적어도 기본값을 쓴다. `header`·`palette` 에 `"top"`·`"bottom"` 이 아닌 값을 적거나 `theme` 에 모르는 이름을 적어도 기본값을 쓴다. `launcher.commands` 가 배열이 아니거나 비었거나, 문자열이 아닌 항목이나 빈(공백뿐인) 문자열이 있어도 기본값을 쓴다.
- 모르는 키는 무시한다.

## 고치면 바로 적용된다

앱은 `~/.ai-maru/` 폴더를 지켜보다가 `config.toml` 을 저장하면 다시 읽어 떠 있는 모든 터미널에 적용한다. 단, ⌘+ / ⌘- 로 글꼴 크기를 바꾼 cell 은 `font-size` 가 바뀌어도 그 크기를 지킨다. 폴더가 없는 채로 앱을 띄웠어도 폴더와 파일을 만들면 적용한다. 파일을 지우면 기본값으로 돌아간다.

`config.toml` 을 심볼릭 링크로 두면 링크 자체를 바꿀 때만 다시 읽는다. 링크가 가리키는 파일을 고친 것은 알아채지 못한다.

## 단축키로 글꼴 크기 바꾸기

⌘+ / ⌘- 는 선택한 cell 의 모든 터미널 글꼴 크기를 1px 씩 바꾸고, ⌘0 은 `font-size` 로 되돌린다. ⌘= 도 글꼴을 키운다. ⌘+ 의 ⇧ 를 쥔 채 누른 ⇧⌘- / ⇧⌘0 은 ⌘- / ⌘0 과 같이 동작한다. 범위는 `font-size` 와 같은 8–32 다. 바꾼 크기는 `config.toml` 에 쓰지 않고, 다음 실행이 레이아웃을 되살릴 때 남는다(앱을 끌 때 End everything 을 고르지 않았을 때). 새로 연 cell 은 `font-size` 로 시작한다.

## 문제가 있으면

창 왼쪽 아래에 토스트가 뜬다. 문제가 남아 있는 동안 떠 있고, 고쳐서 문제 없이 읽히면 닫힌다. 닫기 버튼으로 닫아도 다시 저장하면 다시 뜬다.

- TOML 문법 오류나 읽기 오류: 줄·열 번호나 오류 메시지를 보인다. 마지막으로 적용한 값을 그대로 쓴다. 앱을 띄울 때 오류가 있으면 기본값을 쓴다.
- 범위를 벗어나 맞춘 값, 기본값을 쓴 값, 모르는 키, 쓸 수 없는 글꼴과 키워드: 값을 적용한 뒤 무엇이 달랐는지 보인다.
