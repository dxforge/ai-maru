# Architecture

## 화면의 층

창은 workspace 목록을 보인다. workspace 는 cell 을 묶는다. cell 은 헤더·pane 배치·글꼴 크기·columns 폭·job 을 갖고, 선택과 single 보기의 단위다. pane 은 터미널 하나다. cell 의 마지막 pane 이 닫히면 cell 이 닫히고, workspace 의 마지막 cell 이 닫히면 workspace 가 닫힌다.

## pty 를 여는 순서

터미널이 pty 를 열면 renderer 가 `pty:open` 을 보내고, main 은 `MessageChannelMain` 을 만들어 한쪽 포트는 곧바로 renderer 에(`pty:port`), 다른 쪽은 `ready` 가 풀린 뒤(`ready.then`) pty host 에 넘긴다(`app/src/main/index.ts`).

renderer 는 이 순서에 기댄다. host 가 죽으면 main 이 모든 창에 `pty:lost` 를 보내는데, 포트보다 먼저 온 `pty:lost` 는 이 open 을 받기 전에 죽은 host 의 것이고 이 open 은 새로 띄운 host 가 받는다. 그래서 연결은 포트를 받은 뒤에만 `pty:lost` 를 듣는다(`app/src/renderer/src/pty/connection.ts`). main 이 포트를 host 에 넘긴 뒤에 renderer 에 보내도록 바뀌면 이 판단이 틀어진다.

## 문서가 바뀌면 이전 문서의 pty 를 끈다

창이 새로 고쳐지면(dev 의 Vite 새로 고침 등) 새 문서는 pty 를 새로 연다. 새 문서는 이전 문서가 연 pty 를 모르므로 거기에 다시 붙지 않는다. 그래서 main 이 이전 문서의 pty 를 끈다(`app/src/main/index.ts`).

## kill 은 pty id 로 보낸다

main 은 kill 이 올 때까지 key 의 pty id 를 기억하고(`app/src/main/pty-cells.ts`), pty host 에 보내는 kill 에 그 pty id 를 싣는다. host 는 받은 id 로 pty 를 끄므로, host 가 죽어 새로 떴어도 이전 host 가 연 pty 를 끈다(`app/src/main/pty-host.ts`). host 가 자기가 연 pty 의 표에서 찾아 끄도록 바뀌면, host 가 새로 뜬 뒤에 닫은 pane 의 pty 가 남는다.

## 앱을 끄면 띄우던 pty 도 뜬 뒤에 끈다

main 은 `will-quit` 에서 pty host 에 `quit` 을 보내고, host 가 끝난 뒤에 pty 디렉토리의 레코드를 읽어 pty 를 끈다(`app/src/main/index.ts`). host 는 `quit` 을 받으면 새 open 을 받지 않고, 띄우던 pty 가 다 뜬 뒤에 끝난다. main 도 같은 때에 job 을 새로 띄우지 않고, 띄우던 job 이 다 뜨기를 기다린다. maru-pty 는 레코드를 쓴 뒤에 소켓을 연다(`core/crates/maru-pty/src/server.rs` 의 `publish`). host 와 main 은 소켓이 열린 것을 보고 pty 가 떴다고 보므로, host 가 끝난 뒤에 main 이 읽는 레코드에는 띄우던 pty 도 있다. `quit` 은 open 과 같은 `ready.then` 으로 보내므로 host 는 그 앞에 온 open 을 먼저 받는다. main 이 host 를 기다리지 않고 레코드를 읽도록 바뀌면, 앱이 끝난 뒤에 뜬 pty 가 남는다. host 가 `QUIT_TIMEOUT_MS` 안에 끝나지 않으면 main 은 host 를 SIGKILL 로 끄고 레코드를 읽는다. 그때 host 가 띄우던 pty 는 남을 수 있다. 그 가운데 소켓을 연 pty 는 다음 실행의 정리가 끈다. 이 상한은 spawn 시간 제한(`SPAWN_TIMEOUT_MS`)보다 길어서, 소켓을 열기 전에 멈춘 pty 에 host 가 SIGTERM 을 보낼 때까지 기다린다. main 은 띄우던 job 도 같은 상한까지만 기다린다.

## main 이 아는 pty 의 cell

workspace·cell 목록은 renderer 만 가진다. renderer 는 pty 를 열 때 `pty:open` 에 그 pane 의 cell id 를 싣는다. main 은 그 key 의 kill 이 올 때까지 pty 의 cell 을 기억한다(`app/src/main/pty-cells.ts`). 그래서 renderer 는 pane 을 지울 때마다, pty 가 스스로 끝났어도 kill 을 보낸다(`App.vue` 의 `removePane`). kill 을 보내지 않고 pane 을 지우는 경로가 생기면 main 은 끝난 pty 의 cell 을 계속 기억한다.

## pane 요청은 창이 준비된 뒤에 넘긴다

CLI 서버는 앱이 뜨자마자 요청을 받으므로, 재시작에서 남은 pty 의 요청은 창이 문서를 로드하는 중에도 온다. renderer 가 리스너(`onPaneNew` 등)를 달기 전에 보낸 IPC 는 받는 쪽이 없어 버려진다. 그래서 main 은 renderer 가 `pane:ready` 를 보낼 때까지 요청을 쌓아 두고, 창이 새 문서로 바뀌면(`did-navigate`) 다시 쌓는다.

renderer 는 화면을 되살린 다음 tick 에 `pane:ready` 를 보낸다(`App.vue`). 다음 tick 에는 되살린 터미널이 mount 돼 `pty:open` 을 보낸 뒤다. 되살리기 전에 넘기면 renderer 는 부른 pane 을 찾지 못한다. 같은 renderer 의 IPC 는 보낸 순서대로 닿으므로, main 은 쌓아 둔 요청을 넘길 때 되살린 pty 의 cell 을 안다(위의 "main 이 아는 pty 의 cell"). 그래서 `cell.new` 는 부른 pty 의 cell 과 `after`·`before` 로 가리킨 pty 의 cell 을 요청을 받을 때가 아니라 창에 넘길 때 찾는다. 터미널이 mount 될 때 pty 를 열지 않도록 바뀌면, main 은 되살린 pty 의 cell 을 모른 채 넘겨 새 cell 이 새 workspace 로 목록 끝에 놓인다.

## pty 상태는 main 이 구독해 든다

셸 cwd(OSC 7)·제목(OSC 0/2)·foreground cwd·OSC 7501 레코드는 maru-pty 가 해석해 하나의 상태로 든다. main 은 pty 마다 maru-pty 에 `subscribe` 연결을 직접 열어 마지막 상태를 든다(`app/src/main/pty-state.ts`). 이 연결로는 화면 바이트가 오지 않는다. attach 스트림은 renderer 가 붙어 있을 때만 있으므로, 상태를 attach 스트림에서 읽으면 main 은 renderer 가 붙은 동안에만 상태를 갖는다.

구독을 여는 때는 셋이다. pane 의 pty 는 pty host 가 띄운 pty 에 붙은 뒤 main 에 `live` 를 보낼 때, job 의 pty 는 main 이 띄운 뒤, 재시작으로 남긴 pty 는 남은 pty 정리가 끝난 뒤다.

renderer 는 상태를 main 에서만 받는다. 문서를 로드하면 `pty:states` 로 전체를 묻고, 그 뒤로 main 이 `pty:state` 로 보낸다(`app/src/renderer/src/pty/states.ts`). 화면에 보일 cwd 는 `app/src/renderer/src/workspace/display.ts` 가, pane 이름은 `app/src/shared/pane-name.ts` 가 고른다. xterm.js 는 화면만 그리고 OSC 7·제목을 읽지 않는다.

`maru pane list` 는 main 이 renderer 에 묻지 않고 답한다. 레코드와 셸이 알린 명령은 main 의 상태에서, workspace 이름·cell id 와 pane 의 cwd·제목은 renderer 가 마지막으로 보낸 화면(`lastScreen`)에서 읽는다. 그래서 화면 snapshot 은 pane 의 `git` 을 싣는다. pane 이름은 사이드바와 같은 `paneName`(`app/src/shared/pane-name.ts`)으로 짓는다.

OSC 7501 레코드는 pane 마다 여럿일 수 있다(루트와 하위). 사이드바·pane 헤더·cell 헤더와 `maru pane list` 가 보일 레코드 하나는 `shownRecord`(`app/src/shared/program-status.ts`)가 고른다. renderer 와 main 이 같은 함수를 써서 화면과 `maru pane list` 가 같은 상태를 보인다.

`maru status` 는 앱 소켓을 쓰지 않고 터미널 장치(제어 터미널, 없으면 가장 가까운 조상 프로세스의 제어 터미널)에 OSC 7501 을 쓴다. 그래서 이 명령이 쓴 레코드도 터미널 안의 프로그램이 보낸 레코드처럼 maru-pty 가 해석하고 보관한다.

사용자가 입력 focus 를 가진 pane 에 1초(`SEEN_MS`, `app/src/renderer/src/pty/seen.ts`) 이상 머문 뒤 떠나면, 앱은 그 pane 의 done 레코드를 모두 idle 로 바꾼다. 떠나는 것은 다른 pane 으로 옮기거나, 런처처럼 터미널이 아닌 요소가 키보드 focus 를 가져가거나, 앱 창이 focus 를 잃는 것이다. renderer 가 머문 시간을 재 main 에 `pane:seen` 으로 알리고, main 은 든 레코드 가운데 done 인 것마다 `maru status put idle --pty <id>` 를 실행한다(`app/src/main/seen.ts`). `--pty` 는 그 pty 의 터미널 장치에 OSC 7501 을 쓴다. 앱 메모리에서만 덮지 않는 것은, pty 가 앱 재시작에도 살아 있어 다시 뜬 앱에 maru-pty 가 done 을 다시 보내기 때문이다. OSC 7501 보고는 레코드를 통째로 바꾸므로 main 이 done 을 본 뒤 프로그램이 보낸 새 상태를 idle 로 덮을 수 있다. Claude Code 2.1.312 에서 Enter 부터 working 이 main 에 닿기까지 61~79ms 였다. 사람이 Enter 뒤 pane 을 옮기는 시간보다 짧다.

`subscribe` 를 더하며 maru-pty 의 프로토콜 버전을 올리지 않았다. 올리면 앱을 다시 깔 때 남은 pty 가 모두 끝나기 때문이다. 그래서 `subscribe` 를 모르는 이전 maru-pty 의 pty 가 남을 수 있다. main 은 그 pty 를 `old` 로 renderer 에 알리고, renderer 는 그 pty 에 한해 attach 스트림의 `program_status` 를 레코드로 쓴다. 그 pty 의 cwd 는 되살린 값으로 보이고 제목은 비운다. main 은 그 pty 의 레코드를 모르므로 `maru pane list` 는 그 pty 의 STATE·APP·MESSAGE 를 비우고, 이름도 레코드가 없는 pane 처럼 짓는다. 이 경로는 이전 maru-pty 의 pty 가 모두 끝나면 지운다.

## 시간 초과한 pane 요청은 창이 취소한다

시간 초과를 받은 호출자가 같은 명령을 다시 부른 뒤 창이 늦게 첫 요청의 pane 도 열면 pane 이 둘 생긴다. 그래서 main 은 창에 보낸 요청이 시간 초과하면 `pane:cancel` 을 보내고, renderer 는 그 요청으로 열어 아직 pty 를 기다리는 pane 을 닫는다. renderer 가 답을 보낸 직후, 그 답이 main 에 닿기 전에 main 이 시간 초과하면 pane 은 남는다.

## job 은 main 이 가진다

`maru job` 의 job 은 pane 과 같은 pty 디렉토리에 `maru-pty --keep` 으로 뜨는 pty 다. main 의 jobs 표(`app/src/main/job.ts`)가 이름·cell·`job.new` 를 부른 pty·띄운 시각을 가진다. pty host 는 job 을 모른다. renderer 는 사이드바에 보이려고 표의 사본만 받는다. main 은 표가 바뀔 때마다 전체 목록(`JobView`, `app/src/shared/job.ts`)을 `jobs:changed` 로 보내고, renderer 는 처음에 `jobs:list` 로 한 번 받는다. 목록에는 job 과 그 자손이 LISTEN 중인 TCP 포트가 실린다. 포트가 바뀌어도 알려 주는 곳이 없어, main 은 도는 job 이 있는 동안 주기마다 `ps`·`lsof` 로 다시 잰다(`app/src/main/ports.ts`). renderer 가 job 을 끌 때는 `job:kill` 을 보낸다. main 은 `job:kill` 을 받으면 `job.kill` 과 달리 부른 cell 을 따지지 않는다. 도는 job 이면 main 이 확인 창을 띄운다. job 의 출력 바이트는 main 을 지나지 않는다. main 은 돌고 있는 job 마다 셸이 끝나기를 기다리는 `status` 연결 하나를 두고, 출력은 `job.read` 를 받을 때 `capture` 로 한 번 받는다.

cell 이 닫힌 것은 kill 로 안다. renderer 는 cell 의 마지막 pane 을 지울 때 cell 도 지우므로, kill 로 그 cell 의 마지막 pty 가 빠지면 main 은 cell 이 닫힌 것으로 보고 그 cell 의 job 을 끈다(`sendKill`, `app/src/main/index.ts`). 문서가 바뀔 때 이전 문서의 pty 를 끄는 경로도 같은 `sendKill` 을 부른다. 그래서 창을 새로 고치면 그 창 cell 의 job 도 꺼진다. pane 이 없는 cell 을 남기는 경로가 생기면 이 판단이 틀어진다.

## 재시작은 pty 를 남긴다

종료는 pty 를 모두 끄고, 재시작은 끄지 않는다. renderer 는 화면(workspace·cell·pane 배치와 사이드바·보기 모드, `app/src/shared/screen.ts`)이 바뀔 때마다 main 에 보낸다. 재시작하면 main 이 마지막으로 받은 화면과 main 이 가진 job 표를 userData 의 `restart.json` 에 쓴 뒤 다시 뜬다(`app/src/main/restart.ts`). renderer 에게 그때 묻지 않으므로 renderer 가 멈춰 있어도 재시작한다.

다시 뜬 앱의 남은 pty 정리는 이 파일에 있는 pty 만 남기고, 그 가운데 프로토콜 버전이 다른 pty 는 끈다. 되살린 pane 은 `pty:open` 의 `attach` 로 pty 를 띄우지 않고 붙는다.

## 런처로 띄운 pane 은 명령이 실패하면 남는다

런처(⌘P)가 명령으로 띄운 pane 은 화면 snapshot 에 `keep` 이 붙고(`ScreenPane`), pty 를 `maru-pty --keep` 으로 띄운다. 명령이 0 이나 130 으로 끝나거나 셸이 SIGINT 로 끝나면 다른 명령 pane 처럼 pane 을 지운다. 130 과 SIGINT 는 사용자가 Ctrl-C 로 끈 것이기 때문이다. 그 밖의 코드나 시그널로 끝나면 renderer 는 pane 을 지우지 않고 종료 상태를 터미널 마지막 줄에 쓴다. 재시작 뒤 다시 붙은 pane 도 `exit` 를 다시 받아 종료 상태를 마지막 줄에 쓰고 남는다. maru-pty 가 화면과 종료 상태를 들고 있기 때문이다. maru-pty 는 명령이 끝나면 상태의 명령을 안 도는 중으로 바꾸고 종료 코드를 싣는다. 그래서 OSC 7501 레코드가 없는 남긴 pane 은 헤더와 사이드바에 종료 코드를 보인다. ⌘W 는 그 pane 을 실행 중으로 보지 않으므로 확인 창을 띄우지 않는다. 남긴 pane 을 닫으면 renderer 가 보내는 kill 로 maru-pty 도 끝난다.

## 닫기 전 확인 창은 main 이 띄운다

⌘W(pane)·⇧⌘W(workspace)·창 닫기·⌘Q 는 셸 말고 도는 프로그램이나 끝나지 않은 job 이 있으면 확인 창을 띄운다(`app/src/main/close-confirm.ts`). 실행 중인지는 maru-pty 의 `foreground` 응답과 main 의 job 표로 가리므로, ⌘W·⇧⌘W 도 renderer 가 아니라 main 이 묻고 renderer 는 답을 받은 뒤에 닫는다. 어느 경로든 main 은 renderer 가 마지막으로 보낸 화면(`lastScreen`)에서 pane 과 cell 을 찾는다. `maru pane close` 는 프로그램이 돌아도 묻지 않는다 — CLI 의 답 상한 안에 사용자의 답을 기다릴 수 없기 때문이다.

## pane 경계와 글자 칸 격자

나란히 놓인 pane 끼리 터미널 행이, 위아래로 놓인 pane 끼리 열이 이어지도록 pane 경계를 터미널 글자 칸 크기의 배수에 둔다. columns 보기의 좌우 경계는 pane 하나의 폭의 배수에 둔다. pane 하나의 폭(`columnWidth`(`columns.ts`))은 글자 칸 폭의 배수라, columns 보기에서도 위아래 pane 끼리 열이 이어진다. ⌘+ / ⌘- 로 cell 마다 글꼴 크기가 다를 수 있으므로 `App.vue` 는 글꼴마다 마지막으로 잰 글자 칸 크기를 둔다. cell 마다 그 글꼴의 글자 칸 크기를 `--row`·`--cell` 로, 터미널 왼쪽 여백 4px 를 `--pad` 로 그 cell 의 `.panes` 요소에 둔다. 여백은 `.xterm` 의 `padding-left` 다.

`App.vue` 는 pane 배치(`snapRects`(`grid.ts`))와 함께 터미널의 열·행 수를 정해 `TerminalView` 에 `cols`·`rows` 로 넘긴다. `TerminalView` 는 처음 받은 열·행 수로 pty 에 붙고, 그 뒤에는 primary 일 때만 그 값으로 `term.resize` 를 부른다. pane 크기를 정하려고 화면에서 재는 것은 cell 마다 pane 이 놓일 영역(`.panes`)의 크기와 글자 칸 크기다. columns 보기는 영역 폭을 쓰지 않고, cell 의 pane 열 수(`layout.column-cols` 나 ⇧⌘. / ⇧⌘, 로 바꾼 값)로 pane 폭을 만든다.

pane 헤더는 터미널 한 행이다. 높이는 `--row` 이고 터미널과 같은 글꼴·크기로 쓴다. 헤더는 `config.toml` 의 `layout.header` 에 따라 pane 의 맨 아래(기본값)나 맨 위에 놓이고(`docs/config.md`), 터미널은 나머지 행을 쓴다. cell 헤더도 같은 쪽에 놓인다. pane 헤더·cell 헤더처럼 격자 위에 놓이는 것은 터미널 글꼴을, 사이드바·팔레트·Canvas 처럼 격자 밖의 것은 system-ui 를 쓴다.

경계선은 자리를 차지하지 않는다. 1px 라도 자리를 차지하면 그 뒤 pane 이 격자에서 밀리기 때문이다. 좌우 pane 의 경계선은 오른쪽 pane 의 터미널 왼쪽 여백 위에 겹쳐 그리고, 위아래 pane 은 헤더가 아래면 위 pane 의 헤더가, 위면 아래 pane 의 헤더가 경계가 된다.

pane 은 터미널 20열 × 5행(`PANE_MIN`(`app/src/shared/layout.ts`)) 아래로 내려가지 않는다. 열은 왼쪽 여백·스크롤바를 뺀 터미널 열, 행은 헤더를 뺀 터미널 행이다. `snapRects`(`grid.ts`)는 나눈 두 쪽에 각각 그 쪽 pane 들이 필요한 크기(`required`)를 준다. 창·사이드바·글꼴 크기가 바뀌어 cell 이 그 크기보다 작아지면 뒤쪽 pane 이 cell 끝 밖으로 나가 잘린다. cell 안에서 스크롤하지 않는다. 나눠서 밖으로 나가는 길이가 늘어나는 split 은 `canSplit` 이 거절한다. 단축키·메뉴는 토스트를 띄우고, `maru pane new` 는 `no_space` 오류를 받는다. columns 보기의 좌우 split 은 cell 이 그만큼 넓어지므로 거절하지 않는다.

## 글자 폭

renderer 의 xterm 과 `maru-pty` 의 VT 는 글자마다 차지하는 글자 칸 수를 같은 규칙으로 센다. 둘이 다르게 세면 재생한 화면에서 그 글자 뒤의 글자가 밀린다. 둘 다 grapheme cluster 를 한 글자로 센다. 피부색 수식자나 ZWJ 로 이은 emoji, VS16 이 붙은 글자는 폭이 2다. xterm 은 `@xterm/addon-unicode-graphemes`(`TerminalView.vue`)로, `maru-pty` 는 VT 를 만들 때 mode 2027 을 기본값으로 켜서 센다(`core/crates/maru-pty/src/vt/mod.rs`).

두 쪽이 다르게 세는 경우가 둘 남아 있다.

- 이 addon 의 emoji 폭 표에는 Unicode 14 이후에 추가된 emoji(🫠 등)가 없어 폭을 1로 센다. `maru-pty` 는 2로 센다.
- 프로그램이 `CSI ? 2027 l` 로 mode 2027 을 끄면 `maru-pty` 만 꺼진다. xterm 은 이 mode 를 처리하지 않는다.
