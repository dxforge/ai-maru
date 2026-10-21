# Architecture

## 세션을 여는 순서

터미널이 세션을 열면 renderer 가 `session:open` 을 보내고, main 은 `MessageChannelMain` 을 만들어 한쪽 포트는 곧바로 renderer 에(`session:port`), 다른 쪽은 `ready` 가 풀린 뒤(`ready.then`) session host 에 넘긴다(`app/src/main/index.ts`).

renderer 는 이 순서에 기댄다. host 가 죽으면 main 이 모든 창에 `session:lost` 를 보내는데, 포트보다 먼저 온 `session:lost` 는 이 open 을 받기 전에 죽은 host 의 것이고 이 open 은 새로 띄운 host 가 받는다. 그래서 연결은 포트를 받은 뒤에만 `session:lost` 를 듣는다(`app/src/renderer/src/session/connection.ts`). main 이 포트를 host 에 넘긴 뒤에 renderer 에 보내도록 바뀌면 이 판단이 틀어진다.

## 문서가 바뀌면 이전 문서의 세션을 끈다

창이 새로 고쳐지면(dev 의 Vite 새로 고침 등) 새 문서는 세션을 새로 연다. 새 문서는 이전 문서가 연 세션을 모르므로 거기에 다시 붙지 않는다. 그래서 main 이 이전 문서의 세션을 끈다(`app/src/main/index.ts`).

이전 문서가 떠나 포트가 닫히면 `bridge` 가 세션 소켓을 닫지만 세션 프로세스는 살아 있다. session host 는 이때 key 를 지우지 않고 남겨, 뒤에 오는 kill 이 세션 id 를 찾게 한다(`app/src/main/session-host.ts`). host 가 소켓이 닫힐 때 key 를 지우도록 바뀌면 이전 세션이 남는다.

## main 이 아는 세션의 workspace

workspace 목록은 renderer 만 가진다. renderer 는 세션을 열 때 `session:open` 에 그 pane 의 workspace id 를 싣는다. main 은 그 key 의 kill 이 올 때까지 세션의 workspace 를 기억한다(`app/src/main/session-workspaces.ts`). 그래서 renderer 는 pane 을 지울 때마다, 세션이 스스로 끝났어도 kill 을 보낸다(`App.vue` 의 `removePane`). kill 을 보내지 않고 pane 을 지우는 경로가 생기면 main 은 끝난 세션의 workspace 를 계속 기억한다.

## pane 요청은 창이 준비된 뒤에 넘긴다

CLI 서버는 앱이 뜨자마자 요청을 받으므로, 재시작에서 남은 세션의 요청은 창이 문서를 로드하는 중에도 온다. renderer 가 리스너(`onPaneNew` 등)를 달기 전에 보낸 IPC 는 받는 쪽이 없어 버려진다. 그래서 main 은 renderer 가 `pane:ready` 를 보낼 때까지 요청을 쌓아 두고, 창이 새 문서로 바뀌면(`did-navigate`) 다시 쌓는다.

renderer 는 화면을 되살린 다음 tick 에 `pane:ready` 를 보낸다(`App.vue`). 다음 tick 에는 되살린 터미널이 mount 돼 `session:open` 을 보낸 뒤다. 되살리기 전에 넘기면 renderer 는 부른 pane 을 찾지 못한다. 같은 renderer 의 IPC 는 보낸 순서대로 닿으므로, main 은 쌓아 둔 요청을 넘길 때 되살린 세션의 workspace 를 안다(위의 "main 이 아는 세션의 workspace"). 그래서 `workspace.new` 는 부른 세션의 workspace 를 요청을 받을 때가 아니라 창에 넘길 때 찾는다. 터미널이 mount 될 때 세션을 열지 않도록 바뀌면, main 은 되살린 세션의 workspace 를 모른 채 넘겨 새 workspace 가 목록 끝에 놓인다.

## 시간 초과한 pane 요청은 창이 취소한다

시간 초과를 받은 호출자가 같은 명령을 다시 부른 뒤 창이 늦게 첫 요청의 pane 도 열면 pane 이 둘 생긴다. 그래서 main 은 창에 보낸 요청이 시간 초과하면 `pane:cancel` 을 보내고, renderer 는 그 요청으로 열어 아직 세션을 기다리는 pane 을 닫는다. renderer 가 답을 보낸 직후, 그 답이 main 에 닿기 전에 main 이 시간 초과하면 pane 은 남는다.

## job 은 main 이 가진다

`maru job` 의 job 은 pane 과 같은 세션 디렉토리에 `maru-session --keep` 으로 뜨는 세션이다. renderer 와 session host 는 job 을 모르고, main 의 jobs 표(`app/src/main/job.ts`)가 이름·workspace·`job.new` 를 부른 세션을 가진다. job 의 출력 바이트는 main 을 지나지 않는다. main 은 돌고 있는 job 마다 셸이 끝나기를 기다리는 `status` 연결 하나를 두고, 출력은 `job.read` 를 받을 때 `capture` 로 한 번 받는다.

workspace 가 닫힌 것은 kill 로 안다. renderer 는 workspace 의 마지막 pane 을 지울 때 workspace 도 지우므로, kill 로 그 workspace 의 마지막 세션이 빠지면 main 은 workspace 가 닫힌 것으로 보고 그 workspace 의 job 을 끈다(`sendKill`, `app/src/main/index.ts`). 문서가 바뀔 때 이전 문서의 세션을 끄는 경로도 같은 `sendKill` 을 부른다. 그래서 창을 새로 고치면 그 창 workspace 의 job 도 꺼진다. pane 이 없는 workspace 를 남기는 경로가 생기면 이 판단이 틀어진다.

## 재시작은 세션을 남긴다

종료는 세션을 모두 끄고, 재시작은 끄지 않는다. renderer 는 화면(workspace·pane 배치와 사이드바·보기 모드, `app/src/shared/screen.ts`)이 바뀔 때마다 main 에 보낸다. 재시작하면 main 이 마지막으로 받은 화면과 main 이 가진 job 표·Claude 상태를 userData 의 `restart.json` 에 쓴 뒤 다시 뜬다(`app/src/main/restart.ts`). renderer 에게 그때 묻지 않으므로 renderer 가 멈춰 있어도 재시작한다.

다시 뜬 앱의 남은 세션 정리는 이 파일에 있는 세션만 남기고, 그 가운데 프로토콜 버전이 다른 세션은 끈다. 되살린 pane 은 `session:open` 의 `attach` 로 세션을 띄우지 않고 붙는다.

## 칸 경계와 셀 격자

나란히 놓인 칸끼리 터미널 행이, 위아래로 놓인 칸끼리 열이 이어지도록 칸 경계를 터미널 셀 크기의 배수에 둔다. 모든 터미널이 같은 글꼴을 쓰므로 `App.vue` 는 마지막으로 잰 값 하나를 `--row`·`--cell`·`--pad` 로 화면 전체에 둔다.

칸 머리는 터미널 한 행이다. 높이는 `--row` 이고 터미널과 같은 글꼴·크기로 쓰며, 터미널은 머리 바로 아래 행에서 시작한다. 칸 머리·workspace 머리처럼 격자 위에 놓이는 것은 터미널 글꼴을, 사이드바·팔레트·Canvas 처럼 격자 밖의 것은 system-ui 를 쓴다.

경계선은 자리를 차지하지 않는다. 1px 라도 자리를 차지하면 그 뒤 칸이 격자에서 밀리기 때문이다. 좌우 칸의 경계선은 오른쪽 칸의 터미널 왼쪽 여백 위에 겹쳐 그리고, 위아래 칸은 아래 칸의 머리가 경계가 된다.

## 글자 폭

renderer 의 xterm 과 `maru-session` 의 VT 는 글자마다 차지하는 칸 수를 같은 규칙으로 센다. 둘이 다르게 세면 재생한 화면에서 그 글자 뒤의 글자가 밀린다. 둘 다 grapheme cluster 를 한 글자로 센다. 피부색 수식자나 ZWJ 로 이은 emoji, VS16 이 붙은 글자는 2칸이다. xterm 은 `@xterm/addon-unicode-graphemes`(`TerminalView.vue`)로, `maru-session` 은 VT 를 만들 때 mode 2027 을 기본값으로 켜서 센다(`core/crates/maru-session/src/vt/mod.rs`).

두 쪽이 다르게 세는 경우가 둘 남아 있다.

- 이 addon 의 emoji 폭 표에는 Unicode 14 이후에 추가된 emoji(🫠 등)가 없어 1칸으로 센다. `maru-session` 은 2칸으로 센다.
- 프로그램이 `CSI ? 2027 l` 로 mode 2027 을 끄면 `maru-session` 만 꺼진다. xterm 은 이 mode 를 처리하지 않는다.
