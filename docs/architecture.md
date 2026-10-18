# Architecture

## 세션을 여는 순서

터미널이 세션을 열면 renderer 가 `session:open` 을 보내고, main 은 `MessageChannelMain` 을 만들어 한쪽 포트는 곧바로 renderer 에(`session:port`), 다른 쪽은 `ready` 가 풀린 뒤(`ready.then`) session host 에 넘긴다(`app/src/main/index.ts`).

renderer 는 이 순서에 기댄다. host 가 죽으면 main 이 모든 창에 `session:lost` 를 보내는데, 포트보다 먼저 온 `session:lost` 는 이 open 을 받기 전에 죽은 host 의 것이고 이 open 은 새로 띄운 host 가 받는다. 그래서 연결은 포트를 받은 뒤에만 `session:lost` 를 듣는다(`app/src/renderer/src/session/connection.ts`). main 이 포트를 host 에 넘긴 뒤에 renderer 에 보내도록 바뀌면 이 판단이 틀어진다.

## 문서가 바뀌면 이전 문서의 세션을 끈다

창이 새로 고쳐지면(dev 의 Vite 새로 고침 등) 새 문서는 세션을 새로 연다. 새 문서는 이전 문서가 연 세션을 모르므로 거기에 다시 붙지 않는다. 그래서 main 이 이전 문서의 세션을 끈다(`app/src/main/index.ts`).

이전 문서가 떠나 포트가 닫히면 `bridge` 가 세션 소켓을 닫지만 세션 프로세스는 살아 있다. session host 는 이때 key 를 지우지 않고 남겨, 뒤에 오는 kill 이 세션 id 를 찾게 한다(`app/src/main/session-host.ts`). host 가 소켓이 닫힐 때 key 를 지우도록 바뀌면 이전 세션이 남는다.

## main 이 아는 세션의 workspace

workspace 목록은 renderer 만 가진다. renderer 는 세션을 열 때 `session:open` 에 그 pane 의 workspace id 를 싣는다. main 은 그 key 의 kill 이 올 때까지 세션의 workspace 를 기억한다(`app/src/main/session-workspaces.ts`). 그래서 renderer 는 pane 을 지울 때마다, 세션이 스스로 끝났어도 kill 을 보낸다(`App.vue` 의 `removePane`). kill 을 보내지 않고 pane 을 지우는 경로가 생기면 main 은 끝난 세션의 workspace 를 계속 기억한다.

## 재시작은 세션을 남긴다

종료는 세션을 모두 끄고, 재시작은 끄지 않는다. renderer 는 화면(workspace·pane 배치와 사이드바·보기 모드, `app/src/shared/screen.ts`)이 바뀔 때마다 main 에 보낸다. 재시작하면 main 이 마지막으로 받은 화면을 userData 의 `restart.json` 에 쓴 뒤 다시 뜬다(`app/src/main/restart.ts`). renderer 에게 그때 묻지 않으므로 renderer 가 멈춰 있어도 재시작한다.

다시 뜬 앱의 남은 세션 정리는 이 파일에 있는 세션만 남기고, 그 가운데 프로토콜 버전이 다른 세션은 끈다. 되살린 pane 은 `session:open` 의 `attach` 로 세션을 띄우지 않고 붙는다.

## 칸 경계와 셀 격자

나란히 놓인 칸끼리 터미널 행이, 위아래로 놓인 칸끼리 열이 이어지도록 칸 경계를 터미널 셀 크기의 배수에 둔다. 모든 터미널이 같은 글꼴을 쓰므로 `App.vue` 는 마지막으로 잰 값 하나를 `--row`·`--cell`·`--pad` 로 화면 전체에 둔다.

칸 머리는 터미널 한 행이다. 높이는 `--row` 이고 터미널과 같은 글꼴·크기로 쓰며, 터미널은 머리 바로 아래 행에서 시작한다. 칸 머리·workspace 머리처럼 격자 위에 놓이는 것은 터미널 글꼴을, 사이드바·팔레트·Canvas 처럼 격자 밖의 것은 system-ui 를 쓴다.

경계선은 자리를 차지하지 않는다. 1px 라도 자리를 차지하면 그 뒤 칸이 격자에서 밀리기 때문이다. 좌우 칸의 경계선은 오른쪽 칸의 터미널 왼쪽 여백 위에 겹쳐 그리고, 위아래 칸은 아래 칸의 머리가 경계가 된다.
