# cell 과 창에 보내는 요청

workspace·cell·pane 은 renderer 만 가진다. main 은 pty 마다 그 cell 을 기억하고, CLI(`maru pane`·`maru cell`·`maru canvas`)의 요청을 창에 넘겨 renderer 의 답을 기다린다. 이 파일은 둘이 그 사이에서 기대는 것을 적는다. 주로 닿는 코드는 `app/src/main/pty-cells.ts`, `app/src/main/pane.ts`, `app/src/main/canvas.ts`, `app/src/main/window-ready.ts`, `app/src/main/index.ts`, `app/src/shared/pane.ts`, `app/src/renderer/src/App.vue`, `app/src/renderer/src/workspace/store.ts` 다.

renderer 는 cell 의 마지막 pane 이 닫히면 그 cell 을 닫는다(`store.ts` 의 `closePane`). keep 을 끈 workspace 는 마지막 cell 이 빠지면 닫는다. 아래 "kill 로 안다" 는 cell 을 닫는 쪽에 기댄다.

## pty 의 cell 은 `pty:open` 으로 받고 kill 로만 잊는다

renderer 는 `pty:open` 에 그 pane 의 cell id 를 싣는다. main 은 그 key 의 kill 이 올 때까지 pty 의 cell 을 기억한다. main 은 workspace·cell 목록의 주인이 아니다. main 은 renderer 가 보낸 화면 사본(`lastScreen`)과 이 표만 든다.

- 코드: `TerminalView.vue`(`cell: cellId`)·`shared/pty.ts` 의 `PtyOpen.cell` ↔ `index.ts` 의 `pty:open`(`ptyCells.open`) ↔ `pty-cells.ts`
- 바꾸면: main 이 다른 경로로 cell 을 잊거나 바꾸면, `maru cell new` 가 놓을 자리와 cell 의 job 을 끌 때를 잘못 안다.
- 테스트: `pty-cells.test.ts` › 「연 pty 마다 그 cell 을 돌려주고, 열지 않은 pty 는 모른다」, 「끈 pty 는 잊고, 다른 pty 는 그대로 둔다」

## pane·cell 이 닫힌 것은 kill 로 안다

renderer 는 pane 을 지울 때마다 kill 을 보낸다. pty 가 스스로 끝나 닫는 pane 도, background pane 도 같은 경로(`removePane`)로 지운다. kill 로 cell 의 마지막 pty 가 빠지면 main 은 그 cell 이 닫힌 것으로 보고 그 cell 의 job 을 끈다. 그래서 main 에는 background pane 표가 없다.

- 코드: `App.vue` 의 `removePane`(늘 `kill()`)·`store.ts` 의 `closePane` ↔ `pty-cells.ts` 의 `close`(`closed`) → `index.ts` 의 `sendKill` → `job.ts` 의 `closeCell`
- 바꾸면: kill 없이 pane 을 지우는 경로가 생기면 main 이 끝난 pty 의 cell 을 계속 기억하고 그 cell 의 job 을 끄지 않는다. pane 이 없는 cell 을 남기는 경로가 생기면 main 은 cell 이 닫혔다고 보고 job 을 끈다.
- 테스트: `pty-cells.test.ts` › 「끈 key 의 pty id 를 돌려주고, cell 의 마지막 pty 면 그 cell id 도 돌려준다」, `job.test.ts` › 「그 cell 의 job 만 끄고 알리지 않는다」, `app/e2e/job.spec.ts` › 「다른 cell 의 job 은 보이지 않고, 마지막 pane 을 닫은 cell 의 job 만 끝난다」, `app/e2e/pane-background.spec.ts` › 「background pty 가 끝나면 그 줄이 사라지고, cell 의 마지막 pane 이었으면 cell 이 닫힌다」. pty 가 스스로 끝난 pane 의 경로를 보는 테스트는 없다.

## 창이 준비되기 전에 온 요청은 쌓는다

CLI 서버는 앱이 뜨자마자 요청을 받는다. renderer 가 리스너(`onPaneNew`·`onCanvasPut` 등)를 달기 전에 보낸 IPC 는 버려지므로, main 은 renderer 가 `pane:ready` 를 보낼 때까지 pane 요청과 Canvas 문서를 쌓았다가 온 순서대로 넘긴다. 창이 새 문서로 바뀌거나(`did-navigate`) renderer 가 죽으면(`render-process-gone`) 다시 쌓는다.

- 코드: `window-ready.ts` 의 `createWindowReady`, `pane.ts` 의 `request`, `canvas.ts` 의 `putCanvas`, `index.ts` 의 `pane:ready`·`forgetDocument` ↔ `App.vue` 의 리스너 등록·`paneReady`
- 바꾸면: main 이 준비를 기다리지 않으면 재시작 직후 남은 pty 가 부른 `maru pane new` 가 사라진다.
- 테스트: `window-ready.test.ts` › 「준비되기 전에 온 것은 쌓았다가 준비되면 온 순서대로 한 번씩 부른다」, `pane.test.ts` › 「새 문서로 바뀌면 다시 준비될 때까지 쌓는다」, `app/e2e/restart.spec.ts` › 「재시작 직후 남은 pty 가 곧바로 부른 maru pane new 는 그 pane 을 나눈다」, `app/e2e/renderer-gone.spec.ts` › 「renderer 가 죽어 대화창을 기다리는 동안 온 maru canvas put 은 죽은 창에 넘기지 않고 실패로 답한다」

## `pane:ready` 는 되살린 터미널이 `pty:open` 을 보낸 뒤에 간다

renderer 는 화면을 되살린 다음 tick 에 `pane:ready` 를 보낸다. 그때는 되살린 터미널이 mount 돼 `pty:open` 을 보낸 뒤다. 같은 renderer 의 IPC 는 순서대로 닿으므로, main 이 쌓인 요청을 넘길 때는 그 pty 들의 cell 을 안다.

- 코드: `App.vue`(`nextTick(window.maru.paneReady)`) ↔ `TerminalView.vue` 의 `onMounted` → `pty/connection.ts` 의 `openPty` ↔ `index.ts` 의 `pty:open`
- 바꾸면: 되살리기 전에 `pane:ready` 를 보내면 renderer 가 부른 pane 을 찾지 못한다.
- 테스트: `app/e2e/restart.spec.ts` › 「재시작 직후 선택하지 않은 cell 의 남은 pty 가 곧바로 부른 maru cell new 는 그 cell 의 workspace 안, 그 cell 뒤에 띄운다」

## cell 은 요청을 받을 때가 아니라 창에 넘길 때 찾는다

`cell.new` 는 부른 pty 의 cell 과 `after`·`before` 의 cell 을, Canvas 문서는 보낸 pty 의 cell(`ownerOf`)을 창에 넘길 때 찾는다. 쌓인 동안에는 아직 `pty:open` 이 닿지 않았을 수 있기 때문이다.

- 코드: `pane.ts` 의 `request`(인자를 함수로 받아 넘길 때 부름)·`cell.new`, `canvas.ts` 의 `ownerOf`·`putCanvas` ↔ `pty-cells.ts` 의 `cellOf`
- 바꾸면: 받을 때 찾으면 main 이 cell 을 몰라, 새 cell 이 새 workspace 로 목록 끝에 놓인다(`store.ts` 의 `openCellFrom`). 터미널이 mount 때 pty 를 열지 않게 바뀌어도 같다.
- 테스트: `pane.test.ts` › 「cell 은 쌓을 때가 아니라 넘길 때 정한다」, 「가리킨 cell 도 쌓을 때가 아니라 넘길 때 정한다」, `canvas.test.ts` › 「보낸 pty 의 cell 은 창이 준비된 뒤에 찾는다」, `app/e2e/restart.spec.ts` › 「재시작 직후 남은 pty 가 곧바로 부른 maru cell new --before 는 가리킨 cell 앞에 띄운다」

## 창과 pty 를 기다리는 상한은 `maru` 의 상한보다 짧다

main 은 창에 넘길 pane 요청을 쌓인 시간까지 넣어 `WINDOW_WAIT_MS` 안에 답하지 못하면, Canvas 문서는 그 안에 넘기지 못하면 실패로 답한다. job 과 `maru pty read`·`maru pty send` 가 pty 를 기다리는 상한(`JOB_REPLY_MS`)도 같다. `maru` 가 `TIMEOUT` 이 지나면 시간 초과로 끝나므로, main 의 오류가 그 안에 닿아야 한다.

- 코드: `window-ready.ts` 의 `WINDOW_WAIT_MS`, `job.ts` 의 `JOB_REPLY_MS` ↔ `core/crates/maru/src/main.rs` 의 `TIMEOUT`
- 바꾸면: main 의 상한이 `TIMEOUT` 보다 길면, `maru` 는 이유 없는 시간 초과로 끝나고 main 은 그 뒤에 요청을 처리한다.
- 테스트: `pane.test.ts` › 「기다리는 시간도 시간 초과에 들고, 시간 초과한 요청은 준비돼도 넘기지 않으며 취소도 보내지 않는다」, `canvas.test.ts` › 「기다리는 시간을 넘기면 실패하고, 그 뒤 준비돼도 보내지 않는다」. 두 상한의 크기를 묶는 테스트는 없다.

## 시간 초과한 pane 요청은 창이 취소한다

창에 넘긴 요청이 시간 초과하면 main 은 `pane:cancel` 로 그 요청 id 를 보낸다. renderer 는 그 요청으로 열어 아직 pty 를 기다리는 pane 을 닫는다. 호출자가 다시 부르면 pane 이 둘 생기기 때문이다.

- 코드: `pane.ts` 의 `request` ↔ preload 의 `onPaneCancel` ↔ `App.vue` 의 `onPaneCancel`·`paneRequests`
- 바꾸면: renderer 가 취소를 듣지 않으면, 실패로 답한 요청의 pane 이 남는다.
- 테스트: `pane.test.ts` › 「창이 답하지 않으면 기다리기를 그만두고 창에 취소를 보내며, 늦게 온 답은 버린다」, 「창이 실패로 답하면 취소를 보내지 않는다」. renderer 가 pane 을 닫는 쪽의 테스트는 없다.

## pane 을 찾는 것은 renderer 다

pane 을 가리키는 요청(`pane.new`·`pane.close`·`pane.background`·`pty.kill`)은 `PaneTarget`(`{pane}` 또는 `{pty}`)으로 창에 넘기고, renderer 가 pane 을 찾는다. main 은 `lastScreen` 으로 둘을 서로 바꿔 찾지 않는다. pty 가 막 바뀐 틈에는 `lastScreen` 이 다른 pane 을 가리키기 때문이다. main 의 `paneOfPty` 는 오류 문구에만 쓴다.

- 코드: `pane.ts`(`closePty`), `shared/pane.ts` 의 `PaneTarget` ↔ `App.vue` 의 `onPaneNew`·`onPaneClose`·`onPaneBackground` → `store.ts` 의 `paneOf`
- 바꾸면: main 이 `lastScreen` 으로 찾아 넘기면, pty 가 막 바뀐 틈에 온 요청이 다른 pane 을 가리킨다.
- 테스트: `pane.test.ts` › 「target 을 pane 으로 창에 넘기고, 없는 pane 이면 invalid_params」, 「pty 로 창에 넘기고, 창이 그 pty 의 pane 을 못 찾으면 invalid_params」

## 나눌 자리가 없으면 `no_space` 로 답한다

renderer 는 pane 을 나눌 자리가 없으면 `no_space` 로 답하고, main 은 이것을 `maru` 에 `no_space` 오류로 돌려준다. 오류 코드는 `maru` 의 모듈 문서에 있다.

- 코드: `App.vue` 의 `paneReply` ↔ `shared/pane.ts` 의 `PaneReply` ↔ `pane.ts` ↔ `core/crates/maru/src/main.rs` 모듈 문서
- 바꾸면: 코드 이름을 한쪽만 바꾸면 `maru pane new` 가 이유 없는 실패로 끝난다.
- 테스트: `pane.test.ts` › 「나눌 자리가 없으면 no_space 로 실패한다」

## Canvas 문서에는 pty 와 cell 만 붙인다

main 은 Canvas 문서에 보낸 pty 와 그 cell id(`CanvasOwner`)만 붙이고, cell 을 못 찾으면 pty 만 붙인다. workspace 는 붙이지 않는다. renderer 가 cell 이 지금 속한 workspace 로 문서 이름을 짓기 때문이다.

- 코드: `canvas.ts` 의 `ownerOf` ↔ `shared/canvas.ts` 의 `CanvasOwner` ↔ `renderer/src/canvas/store.ts` 의 `CellName`
- 바꾸면: main 이 workspace 를 붙이면 cell 을 옮긴 뒤의 문서 이름이 옛 workspace 를 따른다.
- 테스트: `canvas.test.ts` › 「pty 의 cell 을 찾지 못하면 pty 만 붙인다」, `canvas/store.test.ts` › 「문서에 보낸 pty 와 cell 을 붙이고, 소속이 없으면 붙이지 않는다」

## job 표는 main 이 갖고 renderer 는 사본만 받는다

main 은 job 표가 바뀔 때마다 전체 `JobView` 를 `jobs:changed` 로 보내고, renderer 는 처음에 `jobs:list` 로 한 번 묻는다.

- 코드: `index.ts` 의 `sendJobs`·`jobs:list`, `shared/job.ts` 의 `JobView` ↔ preload 의 `onJobs`·`jobs` ↔ 사이드바
- 바꾸면: renderer 가 표를 따로 고치면 main 의 표와 어긋난다. preload 와 사이드바는 `JobView` 의 모양에 기댄다.
- 테스트: `app/e2e/sidebar.spec.ts` › 「maru job 으로 띄운 job 은 그 cell 의 pane 줄 아래에 이름·듣는 포트·돈 시간으로 보이고, kill 하거나 cell 을 닫으면 사라진다」

## 닫기 확인은 main 이 묻는다

pane 이나 workspace 를 닫을 때 renderer 는 main 에 묻고(`pane:confirm-close`·`workspace:confirm-close`) 답을 받은 뒤 닫는다. 실행 중인 프로그램은 셸 pane 이면 `maru-pty` 의 `foreground` 로, 명령을 띄운 pane 이면 상태의 `command.running` 으로 가린다. workspace 를 닫을 때(⇧⌘W)는 그 cell 들의 job 표도 센다. pane 을 닫을 때(⌘W)는 job 을 세지 않는다.

- 코드: `App.vue` 의 `closePane`·`closeWorkspace` ↔ preload ↔ `index.ts` 의 `checkClose`·`closePaneCheck`·`closeWorkspaceCheck` ↔ `close-confirm.ts` 의 `runningProgram` ↔ `pty.ts` 의 `foreground`
- 바꾸면: renderer 가 답을 기다리지 않고 닫으면 확인 창이 뜬 동안 pane 이 사라진다.
- 테스트: `app/e2e/close-confirm.spec.ts` › 「확인 창이 뜨면 그 사이에 누른 ⌘W 는 버린다」
