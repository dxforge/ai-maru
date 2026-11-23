# pty 의 수명

pty 를 열고, pty host 가 바뀌고, pty 를 끄고, 앱이 끝나고 다시 뜰 때 renderer·main·pty host·`maru-pty` 가 서로에게 기대는 순서다. 주로 닿는 코드는 `app/src/main/index.ts`(`pty:open`·`sendKill`·`will-quit`), `app/src/main/pty-host.ts`, `app/src/main/pty.ts`, `app/src/main/pty-cells.ts`, `app/src/main/state.ts`, `app/src/renderer/src/pty/connection.ts`·`attach.ts`, `core/crates/maru-pty/src/server.rs` 다.

## 포트는 renderer 에 먼저 간다

renderer 가 `pty:open` 을 보내면 main 은 `MessageChannelMain` 을 만들어 한쪽 포트를 곧바로 renderer 에 `pty:port` 로 보내고, 다른 쪽은 `ready` 가 풀린 뒤 pty host 에 넘긴다. host 가 죽으면 main 은 모든 창에 `pty:lost` 를 보낸다. renderer 는 포트보다 먼저 온 `pty:lost` 를 이 open 을 받기 전에 죽은 host 의 것으로 보고 무시한다. 이 open 은 새로 띄운 host 가 받기 때문이다.

- 코드: `index.ts` 의 `pty:open`·`ptyHost` ↔ `connection.ts` 의 `onPort`
- 바꾸면: main 이 포트를 host 에 넘긴 뒤에 renderer 에 보내면, 새 host 가 받은 연결이 앞 host 의 `pty:lost` 로 닫힌다.
- 테스트: `connection.test.ts` › 「포트가 오기 전의 pty:lost 로는 닫히지 않고, 온 뒤의 것으로 닫힌다」(renderer 쪽만). main 이 보내는 순서를 지키는 테스트는 없다.

## 새로 고친 문서는 이전 문서의 pty 에 붙지 않는다

main 은 되살릴 화면(`screen:restore`)을 앱이 뜬 뒤 한 번만 준다. 그래서 창이 새로 고쳐지면(dev 의 Vite 새로 고침 등) 새 문서는 이전 문서가 연 pty 를 모르고 pty 를 새로 연다. main 은 이동이 시작될 때 그 창에 있던 key 를 기억했다가 `did-navigate` 에서 그 key 들의 kill 을 보낸다.

- 코드: `index.ts` 의 `screen:restore`·`web-contents-created`(`did-start-navigation`·`did-navigate`) ↔ `App.vue` 의 되살리기
- 바꾸면: main 이 이전 문서의 pty 를 끄지 않으면 붙을 pane 없는 pty 가 남아, 다음 실행이 Recovered workspace 에 연다.
- 테스트: `app/e2e/pty.spec.ts` › 「창이 새로 고쳐지면 이전 화면이 연 pty 는 끝나고, 새 화면의 셸만 남는다」

## kill 은 pty id 로 보낸다

main 은 key 의 kill 이 올 때까지 그 key 의 pty id 를 기억하고, pty host 에 보내는 kill 에 그 pty id 를 싣는다. host 는 자기가 띄운 pty 의 표에서 찾지 않고 받은 id 로 끈다. 그래서 host 가 죽어 새로 떴어도 이전 host 가 연 pty 를 끈다.

- 코드: `pty-cells.ts` 의 `open`·`close` ↔ `index.ts` 의 `sendKill` ↔ `pty-host.ts` 의 `kill`
- 바꾸면: host 가 자기 표에서 찾아 끄면, host 가 새로 뜬 뒤에 닫은 pane 의 pty 가 남는다.
- 테스트: `pty-host.test.ts` › 「host 가 띄우지 않은 pty 도 kill 로 끈다」, `app/e2e/lifecycle.spec.ts` › 「pty 를 잇는 utilityProcess 가 죽은 뒤에 닫은 pane 의 pty 도 끝난다」

## 다시 띄우는 pane 은 새 pty 를 연 뒤에 옛 pty 를 끈다

renderer 의 `reopenPane` 은 새 pty id 로 터미널을 mount 해 `pty:open` 을 보낸 다음 tick 에 옛 연결의 kill 을 보낸다. main 은 kill 로 cell 의 마지막 pty 가 빠지면 cell 이 닫힌 것으로 보기 때문이다(`cell-and-window-requests.md` 의 "pane·cell 이 닫힌 것은 kill 로 안다").

- 코드: `App.vue` 의 `reopenPane` ↔ `pty-cells.ts` 의 `close`
- 바꾸면: pane 하나뿐인 cell 에서 옛 pty 의 kill 이 먼저 가면 main 이 그 cell 의 job 을 끈다.
- 테스트: 없다.

## 앱을 끄면 main 은 host 가 끝난 뒤에 레코드를 읽어 pty 를 끈다

main 은 `will-quit` 에서 pty host 에 `quit` 을 보낸다. host 는 `quit` 을 받으면 새 open 을 받지 않고, 띄우던 pty 가 다 뜨거나 멈추고 받은 kill 이 끝난 뒤에 끝난다. pty 를 끄고 끝낼 때 host 는 띄우던 pty 가 뜨기를 기다리지 않고 멈춘다. main 은 host 가 끝난 뒤에 pty 디렉토리의 레코드를 읽어 남은 pty 를 끈다.

- 코드: `index.ts` 의 `will-quit`·`stopHost` → `pty.ts` 의 `killPtys` ↔ `pty-host.ts` 의 `QuitRequest` 처리
- 바꾸면: main 이 host 를 기다리지 않고 레코드를 읽으면, 앱이 끝난 뒤에 뜬 pty 가 남는다.
- 테스트: `app/e2e/pty.spec.ts` › 「앱을 끄면 pty 도 끝나고, 다시 켜면 새 셸이 뜬다」, `app/e2e/lifecycle.spec.ts` › 「셸이 뜨기 전에 앱을 끄면 띄우던 pty 를 멈추고 남기지 않는다」

## `quit` 은 open 과 같은 `ready.then` 으로 보낸다

main 은 open·kill·`quit` 을 모두 `ready.then` 으로 host 에 보낸다. 그래서 host 는 `quit` 앞에 온 open·kill 을 먼저 받는다.

- 코드: `index.ts` 의 `stopHost`·`pty:open`·`sendKill` ↔ `pty-host.ts` 의 `quitting`
- 바꾸면: `quit` 이 앞서 보낸 open 을 앞지르면, host 가 그 open 을 거절해 renderer 가 기다리던 pty 가 뜨지 않는다.
- 테스트: 없다.

## pty 를 남기고 끝낼 때도 main 은 host 를 기다린다

재시작·Keep terminals 로 pty 를 남기고 끝낼 때도 main 은 host 가 끝나기를 기다린다. host 가 받은 kill 을 마치기 전에 끝나면 닫은 pane 의 pty 가 남고, 다음 실행이 그 pty 를 붙을 pane 없는 pty 로 보고 Recovered workspace 에 열기 때문이다. 기다림에는 상한(`QUIT_TIMEOUT_MS`)이 있다. 상한을 넘기면 main 은 host 를 SIGKILL 로 끄고 넘어가므로, 그때 host 가 띄우던 pty 는 남을 수 있다. 그 가운데 소켓을 연 pty 는 앱이 pty 를 끄고 끝나면 `killPtys` 가 끄고, pty 를 남기고 끝나면 다음 실행이 Recovered workspace 에 연다.

- 코드: `index.ts` 의 `will-quit`·`stopHost` ↔ `pty-host.ts` 의 `quit` ↔ 다음 실행의 `state.ts` 복원
- 바꾸면: 남기고 끝낼 때 host 를 기다리지 않으면, 닫은 pane 이 다음 실행에 Recovered workspace 로 돌아온다.
- 테스트: `pty-host.test.ts` › 「quit 은 그 앞뒤로 받은 kill 과 …」(host 쪽만). Keep 으로 끌 때 닫은 pane 의 pty 가 남지 않는지 보는 e2e 는 없다.

## `maru-pty` 는 레코드를 쓴 뒤에 소켓을 연다

`maru-pty` 는 레코드 `<dir>/<id>.json` 을 쓴 뒤에 소켓을 연다. host 와 main 은 소켓이 connect 를 받는 것을 보고 pty 가 떴다고 본다. 그래서 host 가 끝난 뒤에 main 이 읽는 레코드에는 host 가 띄우던 pty 도 있다.

- 코드: `server.rs` 의 `publish` ↔ `pty.ts` 의 `spawnPty`·`killPtys`(`readRecords`)
- 바꾸면: 소켓을 먼저 열면, 떴다고 본 pty 의 레코드를 main 이 못 읽어 끄지 못한다.
- 테스트: `core/crates/maru-pty/tests/process.rs` › `the_record_is_readable_once_the_socket_accepts_and_the_dir_is_owner_only`

## job 은 host 를 거치지 않는다

`maru job` 의 job 은 pane 과 같은 pty 디렉토리에 `maru-pty --keep` 으로 뜨는 pty 이고, main 이 직접 띄운다. pty host 는 job 을 모른다. 그래서 main 은 `will-quit` 부터 job 을 새로 띄우지 않고, pty 를 끄고 끝낼 때는 띄우던 job 을 host 와 같은 상한까지 직접 기다린다. pty 를 남기고 끝낼 때는 job 을 기다리지 않는다.

- 코드: `index.ts` 의 `createJobs` 의 `spawn`(`quitting`)·`jobSpawns`·`will-quit` ↔ `pty-host.ts`(job 없음)
- 바꾸면: main 이 띄우던 job 을 기다리지 않으면, 앱이 끝난 뒤에 뜬 job 의 pty 가 남는다.
- 테스트: `app/e2e/job.spec.ts` › 「job 을 띄우는 중에 앱을 끄면 SIGTERM 으로 끝나지 않는 pty 도 끝난다」

## 전체 복원의 남길 pty 에는 job 의 pty 가 든다

job 의 pty 는 pane 의 pty 와 같은 디렉토리에 있다. 전체 복원이면 main 은 남길 pty(`keep`)에 되살린 pane 의 pty 와 `sessions` 의 job pty 를 넣는다. 남길 pty 에 들지 않은 pty 가운데 앱이 붙을 수 있는 버전의 pty 는 Recovered workspace 에 열고, 붙을 수 없는 pty 는 끈다. 전체 복원이 아니면 job 의 pty 도 붙을 pane 이 없는 pty 로 보고 Recovered workspace 에 연다.

- 코드: `state.ts` 의 `fullRestore`·`recoverPtys`·`startRestore` ↔ `index.ts` 의 `leftovers`(`killPtys(…, keepAttachable(keep))`)
- 바꾸면: `fullRestore` 가 job 의 pty 를 빼먹으면 전체 복원에서도 그 job 을 Recovered workspace 에 연다.
- 테스트: `state.test.ts` › 「전체 복원이면 job pty 는 남기고 Recovered 에 넣지 않으며, 붙을 pane 이 없는 pty 를 Recovered 로 옮긴 것은 알린다」

## 전체 복원은 같은 pty id 목록으로 다시 붙는다

전체 복원이면 main 은 되살린 pane 이 붙을 `sessions` 의 pty 와 Recovered workspace 의 pane 이 붙을 pty 를 renderer 에 `screen:restore` 로 준다. main 이 끄지 않고 남기는 pty 는 이 pty 들과 job 의 pty 다(`recoverPtys` 의 `keep`). 되살린 pane 은 `pty:open` 의 `attach` 로 pty 를 띄우지 않고 붙는다. main 의 정리, renderer 의 되살리기, host 의 `reattach` 가 같은 pty id 목록에 기댄다.

- 코드: `state.ts` 의 `fullRestore`·`startRestore` ↔ `renderer/src/workspace/store.ts` 의 `restore`(`attach: true`) ↔ `pty-host.ts` 의 `reattach`
- 바꾸면: 셋 가운데 하나가 다른 목록을 쓰면 되살린 pane 이 남은 pty 대신 새 셸을 띄우거나, 붙을 pty 가 꺼진다.
- 테스트: `app/e2e/restart.spec.ts` › 「재시작 뒤에도 maru pane list 의 pane id 와 pty id 가 같다」

## 붙을 pty 가 끝났으면 host 가 `gone` 을 보내고 같은 id 로 셸을 띄운다

붙을 pty 가 이미 끝났으면 host 는 `gone` 을 보낸 뒤 같은 pty id 로 저장한 cwd 에서 명령 없이 새 셸을 띄운다. renderer 는 `gone` 을 받으면 그 이유를 터미널에 쓴다.

- 코드: `pty-host.ts` 의 `reattach` ↔ `renderer/src/pty/attach.ts`(`gone`)·`TerminalView.vue`
- 바꾸면: host 가 다른 id 로 띄우면 main·renderer 가 아는 pane 의 pty id 와 어긋난다.
- 테스트: `pty-host.test.ts` › 「붙을 pty 가 없으면 gone 을 알리고, 같은 id 로 cwd 에서 명령 없이 셸을 띄워 이어 준다」, `app/e2e/restart.spec.ts` › 「재시작 동안 끝난 pty 의 pane 은 이유를 보인 뒤 같은 pane 에 저장한 cwd 로 새 셸을 띄운다」

## 런처로 띄운 명령 pane 은 `--keep` 으로 뜬다

런처가 명령으로 띄운 pane 은 화면 snapshot 에 `keep` 이 붙고(`ScreenPane`), pty 를 `maru-pty --keep` 으로 띄운다. `--keep` 으로 뜬 `maru-pty` 는 셸이 끝나도 끝나지 않고 화면과 종료 상태를 든다. 그래서 재시작 뒤 다시 붙은 pane 도 `exit` 를 다시 받아 남는다. `maru-pty` 는 명령이 끝나면 상태의 명령을 도는 중이 아닌 것으로 바꾸고 종료 코드(시그널이면 128+n)를 싣는다. 헤더·사이드바와 닫기 확인은 이 상태를 읽는다.

- 코드: `App.vue`(런처의 `keep: true`) → `shared/screen.ts` 의 `ScreenPane.keep` → `TerminalView.vue` → `pty-host.ts` → `pty.ts`(`--keep`) ↔ `server.rs`(`keep`), `pty.rs` → `state.rs` 의 `command_exited` ↔ `shared/pane-name.ts` 의 `commandView`·`close-confirm.ts` 의 `runningProgram`
- 바꾸면: `keep` 이 snapshot 에서 빠져도 pty 는 `--keep` 으로 떠 있다. 전체 복원은 그 pty 에 붙기만 하기 때문이다. 대신 `keep` prop 없이 다시 붙은 `TerminalView` 가 다시 받은 `exit` 에 `emit('exit')` 해 pane 이 닫히고, 실패한 명령의 화면이 남지 않는다.
- 테스트: `process.rs` › `keep_leaves_the_files_and_answers_after_the_shell_exits`, `a_kept_command_pty_reports_the_exit_code_once_its_command_ends`, `app/e2e/launcher.spec.ts` › 「재시작 뒤에도 실패한 채 남긴 pane 은 화면과 종료 코드를 보이고, 런처의 목록이 남는다」
