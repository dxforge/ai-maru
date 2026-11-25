# 버전과 저장

떠 있는 pty 는 앱을 다시 설치하고 재시작해도 옛 `maru-pty` 로 돌고, `state.json` 은 끄기 전의 빌드가 쓰고 다시 뜬 빌드가 읽는다. 그래서 서로 다른 빌드의 코드가 같은 pty·같은 파일에 기댄다. 이 파일은 그 약속을 적는다. 프로토콜 버전을 올리는 규칙은 `.claude/rules/pty-protocol.md` 에 있다. `maru room` 의 방 파일은 `state.json` 과 달리 옛 빌드와 새 빌드가 같은 시각에 만지므로 규칙이 따로 있다(`room.md` 의 「스키마는 더하기만 하고 버전은 `user_version` 이다」).

## 앱과 `maru-pty` 는 버전 범위를 함께 지킨다

`maru-pty` 는 `MIN_PROTOCOL_VERSION` 부터 `PROTOCOL_VERSION` 까지의 요청을 받고, 앱은 그 범위의 버전으로 떠 있는 pty 에 붙는다. 두 상수는 `app/src/shared/protocol.ts` 와 `core/crates/maru-pty/src/lib.rs` 에 따로 있다.

- 코드: `shared/protocol.ts` 의 `PROTOCOL_VERSION`·`MIN_PROTOCOL_VERSION` ↔ `lib.rs` 의 같은 이름의 상수, `server.rs` 의 범위 검사(`protocol_mismatch`)
- 바꾸면: 한쪽만 바꾸면 두 쪽이 받는 버전 범위가 달라진다. 예를 들어 하한은 두고 Rust 쪽 `PROTOCOL_VERSION` 만 올리면, 새로 띄운 pty 에는 붙지만 다음에 앱이 뜰 때 그 pty 들이 꺼진다. 앱은 레코드의 버전이 붙을 수 없는 버전이면 앱의 버전을 넣어 요청하고(`protocolOf`), `maru-pty` 는 범위 안의 그 버전을 받는다. 다음 실행은 레코드의 버전이 붙을 수 없는 pty 를 되살리지도 Recovered workspace 에 열지도 않고 끈다(`restorePlan`·`recoverPtys`·`keepAttachable`).
- 테스트: `app/src/shared/protocol.test.ts` › 「앱과 maru-pty 의 PROTOCOL_VERSION·MIN_PROTOCOL_VERSION 이 같다」(`lib.rs` 를 읽는다), `core/crates/maru-pty/tests/process.rs` › `every_request_at_the_lowest_version_gets_that_versions_answer`

## 앱은 pty 의 레코드 버전으로 요청한다

앱은 pty 에 보내는 요청에 그 pty 의 레코드(`<id>.json`)에 적힌 버전을 넣고(`protocolOf`), `maru-pty` 는 받은 버전의 모양으로 답한다. 예외는 `kill`·`version` 이다. `maru-pty` 는 이 두 요청을 `protocol_version` 과 상관없이 받고 모양을 바꾸지 않으므로, 앱은 `kill` 에 앱의 `PROTOCOL_VERSION` 을 넣는다(`requestKill`).

- 코드: `pty.ts` 의 `protocolOf`·`requestKill` ↔ `server.rs` 의 `handle`·`answer`, `lib.rs` 모듈 문서
- 바꾸면: 앱이 레코드를 읽지 않고 앱의 버전을 넣으면, 재시작 뒤 옛 `maru-pty` 로 도는 pty 가 `protocol_mismatch` 로 답한다.
- 테스트: `app/src/main/pty.test.ts` › 「레코드의 버전이 붙을 수 있는 버전이면 그 버전으로, 아니면 앱의 버전으로 보낸다」, `process.rs` › `version_and_kill_ignore_the_protocol_version_but_nothing_else_does`

## attach 요청의 버전은 pty host 가 넣는다

renderer 는 레코드를 모르므로, pty host 가 소켓에 붙기 전에 레코드의 버전을 읽고 port 에서 온 첫 text 메시지(attach 요청)에 그 버전을 넣는다.

- 코드: `renderer/src/pty/attach.ts`(attach 요청) ↔ `pty-host.ts` 의 `attachTo` → `bridge.ts` 의 `bridge`
- 바꾸면: renderer 가 버전을 넣게 하면 renderer 가 레코드를 읽어야 한다. host 가 붙은 뒤에 레코드를 읽으면 그동안 닫힌 소켓을 `bridge` 가 듣지 못한다.
- 테스트: `bridge.test.ts` › 「첫 문자열(attach 요청)에만 pty 의 프로토콜 버전을 넣는다」

## `state.json` 은 다섯 표로 나눠 쓴다

renderer 는 화면이 바뀔 때마다 snapshot 을 main 에 보내고(`screen:state`), main 은 그 화면과 job 표·창·테마를 `workspaces`·`cells`·`panes`·`sessions`·`view` 다섯 표로 나눠 쓴다. parse 함수는 아는 필드만 옮기므로, renderer 의 snapshot 에 필드를 더하면 parse 함수에서도 옮겨야 저장된다. 표마다 형식 버전을 따로 두고(`app/resources/state-versions.json`) 따로 읽는다. 한 표의 형식이 바뀌어도 그 표만 잃게 하기 위해서다. 표마다 무엇을 들고 잃으면 무엇이 남는지는 `state.ts` 의 `StateFile` 에 있다.

- 코드: `renderer/src/workspace/store.ts` 의 `snapshot` ↔ `index.ts` 의 `screen:state` → `state.ts` 의 `createStateStore`(`setScreen`)·`screenView` → `shared/screen.ts` 의 `parseScreen`·`splitScreen`, 다른 빌드의 `parseWorkspacesTable`·`parseCellsTable`·`parsePanesTable`·`parseSessionsPart`·`parseViewPart`
- 바꾸면: parse 함수에서 옮기지 않은 필드는 저장에서 빠진다.
- 테스트: `shared/screen.test.ts` › 「workspace·cell·pane 표와 pane id 마다의 pty 로 나누고, 표에는 key 와 pty 를 두지 않는다」, 「모르는 필드는 어느 단계에 있든 버린다 — 옛 빌드가 cell 에 쓴 openedBy 도」, `state.test.ts` › 「view 의 버전이 다르면 view 만 비운다」

## 표 형식은 다른 빌드가 읽을 수 있게 바꾼다

재시작하면 다른 빌드(앞뒤 어느 쪽이든)가 같은 `state.json` 을 읽는다. 그래서 표 형식은 이렇게 바꾼다.

- 있는 필드의 뜻을 바꾸지 않는다. 뜻이 바뀌면 새 이름의 필드를 더한다.
- 다른 표로 옮기는 정보는 옛 자리에도 계속 쓴다.
- 버전은 그 표를 다시 짤 때만 올린다. `workspaces`·`cells`·`panes`·`sessions` 의 버전을 올리면 재시작이 대화창을 띄우고, 재시작 전의 빌드가 그 표를 비워 쓴다(`finish` 의 `drop`). `view` 의 버전은 재시작이 견주지 않는다. 다시 뜬 빌드가 읽지 못한 `view` 를 비운다.

- 코드: `shared/screen.ts` 의 `STATE_VERSIONS`·`splitScreen`, `state.ts` ↔ 다른 빌드의 parse 함수, `restart.ts` 의 `checkRestart`
- 테스트: `app/src/main/state-format.test.ts` › 「지금 버전의 표 형식 파일이 있다」, 「%s 의 sessions·view 에 적힌 값을 지금 앱이 모두 읽는다」, 「%s 의 표를 지금 앱이 읽으면 그때의 화면이 돌아온다」, 「%s 의 화면을 지금 앱이 나누면 그때의 표를 모두 담는다」, `screen.test.ts` › 「모르는 필드는 어느 단계에 있든 버린다 — 옛 빌드가 cell 에 쓴 openedBy 도」. `state-format.test.ts` 는 버전마다 고정한 표 형식 파일(`app/src/main/state-format/*.json`)을 읽는다. 옛 자리에도 계속 쓰는 것은 「표를 모두 담는다」 가 잰다. 화면에서 오지 않는 값(`sessions` 의 `jobs`·`started`, `view` 의 `window`·`theme`)은 「모두 읽는다」 만 잰다. 이름은 두고 뜻만 바꾼 필드는 잡지 못한다.

## background pane 의 잎은 배치 끝에 붙여 쓴다

`cells` 의 배치(분할 트리)는 cell 의 모든 pane 을 잎으로 가져야 한다. 그래서 renderer 는 background pane 의 잎을 트리 오른쪽 끝에 붙여 쓰고, 되살릴 때 뺀다. pane 의 `background` 는 `panes` 표의 버전을 올리지 않고 더한 필드다. 옛 빌드는 이 필드를 모르는 필드로 버리고, 잎이 다 있으므로 background pane 을 cell 끝의 보이는 pane 으로 연다.

- 코드: `renderer/src/workspace/store.ts` 의 `snapshot`(`appendLeaves`)·`restore`(`withoutLeaves`) ↔ `shared/screen.ts` 의 `joinTables`·`LayoutPane`
- 바꾸면: 잎을 붙이지 않으면 `joinTables` 가 배치의 잎에 해당하는 pane 행만 추리므로(`own`), cell 은 보이는 pane 들로 열리고 background pane 만 빠진다. 빠진 pane 의 pty 는 붙을 pane 이 없는 pty 가 되어 Recovered workspace 에 열린다. 배치의 잎 가운데 그 cell 의 pane 행이 없는 것이 있거나 같은 pane 을 두 번 가리킬 때만 cell 을 새 pane 하나로 연다.
- 테스트: `app/e2e/pane-background.spec.ts` › 「background 로 둔 채 다시 띄워도 background 로 뜨고, 꺼내면 같은 pty 다」, `app/src/renderer/src/workspace/store.test.ts` › 「background 를 모르는 빌드가 표를 읽어도 모든 pane 이 열리고, background pane 은 배치 오른쪽 끝에 보인다」. `store.test.ts` 는 표에서 `background`·`home` 을 지워 옛 빌드의 parse 를 흉내 내고, pane 이 모두 background 인 cell 도 잰다. 되살리기는 옛 빌드의 것 대신 지금의 `restore` 를 쓴다.

## `sessions.started` 는 버전을 올리지 않고 더한 필드다

`sessions` 의 `started` 는 pty id 마다 그 pty 를 띄운 앱의 main 프로세스가 뜬 시각이다. 그 앱이 끝난 뒤에 뜬 앱은 적힌 값을 그대로 이어 적는다. 다시 뜬 앱은 pty 가 뜬 시각과 이 값 가운데 이른 것을 지금 로그인 세션이 시작된 시각과 견줘, 끝난 로그인 세션에서 뜬 앱이 띄운 pty 를 가린다. `sessions` 의 버전을 올리지 않고 더했으므로, 이 필드를 모르는 빌드는 읽을 때 버리고 쓸 때 빼뜨린다. 그 뒤에 뜬 앱은 값이 없는 pty 를 pty 가 뜬 시각으로 판정한다.

- 코드: `state.ts` 의 `SessionsPart.started`·`parseStarted`·`stampStarted`·`startRestore`
- 바꾸면: 값의 뜻(그 pty 를 띄운 앱이 뜬 시각)을 바꾸면 옛 빌드가 쓴 값으로 잘못 판정한다.
- 테스트: `state.test.ts` 의 `startRestore` 묶음

## 재시작은 설치본에 묻고 견준다

재시작 전에 main 은 설치된 번들의 `maru-pty` 에 `--min-protocol-version`·`--protocol-version` 을 물어, 살아 있는 pty 마다 레코드 버전이 그 범위 안인지 본다. 설치본의 `state-versions.json` 도 지금 앱의 것과 견준다. `maru-pty` 의 이 두 옵션의 출력 모양(버전 하나와 줄바꿈)은 바꾸지 않는다.

- 코드: `restart.ts` 의 `ptyProtocolRange`·`installedVersions`·`checkRestart` ↔ `maru-pty` 의 옵션 처리(`lib.rs` 모듈 문서), `app/resources/state-versions.json`(`app/electron-builder.yml` 이 번들에 싣는다)
- 바꾸면: 출력 모양을 바꾸면 떠 있는 옛 앱이 재시작 전에 끌 터미널을 세지 못한다.
- 테스트: `restart.test.ts` › 「바이너리가 알려 준 두 버전을 읽고, 버전을 못 읽으면 null 이다」, `process.rs` › `protocol_version_prints_the_version_without_dir_or_id`, `min_protocol_version_prints_the_lowest_version_without_dir_or_id`, `app/e2e/packaged.spec.ts` › 「설치본에 상태 파일의 형식 버전이 실리고, 같은 빌드로의 재시작은 묻지 않는다」

## 재시작 대화창의 예고는 다음 빌드의 복원과 같아야 한다

재시작 전의 빌드는 범위 밖의 pty 만 끄고 대화창도 그 수만 센다. 범위 안의 pty 와, `cells`·`panes`·`sessions` 가운데 형식이 다른 표가 있을 때의 pty 는 남기고, 다시 뜬 빌드가 그 pty 를 Recovered workspace 에 연다. `workspaces` 의 형식만 다르면 전체 복원이라, 다시 뜬 빌드는 pty 를 원래 pane 에 붙인다. 대화창의 문구가 맞으려면 재시작 전 빌드의 예측(`restart.ts`)이 다시 뜬 빌드의 복원 판정(`state.ts`)과 같아야 한다.

- 코드: `restart.ts` 의 `checkRestart`·`restartResult`·`restartOutcome` → `index.ts` 의 `finishRestart` ↔ 다음 빌드의 `state.ts` 의 `restorePlan`·`recoverPtys`·`startRestore`
- 바꾸면: 한쪽 판정만 바꾸면 대화창이 끈다고 한 pty 가 남거나, 남긴다고 한 pty 가 꺼진다.
- 테스트: `restart.test.ts` › 「범위 밖 pty 만 끈다고 세고, 범위 안 pty 는 남겨 Recovered 로 옮긴다」, `app/e2e/restart.spec.ts` › 「설치본이 붙지 못하는 pty 만 끈다고 세어 묻고, 확인하면 그 pty 만 끄며 다시 뜬 앱은 남긴 pty 를 Recovered workspace 에 연다」

## 비운 표는 알리지 않는다

재시작 전의 빌드는 형식이 다른 표를 고른 결과와 상관없이 비워(`null`) 쓴다. 다시 뜬 빌드는 `null` 인 표를 읽지 못한 표와 구분해, 대화창에서 이미 알린 것으로 보고 toast 를 띄우지 않는다. 형식이 다른 표를 그대로 남기면 다시 뜬 빌드가 읽지 못한 표로 알리기 때문이다.

- 코드: `restart.ts` 의 `restartOutcome` → `state.ts` 의 `createStateStore` 의 `finish`(`drop`) ↔ 다음 빌드의 `state.ts` 의 `part`·`restorePlan`·`startRestore`
- 바꾸면: 비운 표를 빈 값이 아닌 다른 모양으로 쓰면 다시 뜬 앱이 이미 알린 것을 또 알린다.
- 테스트: `restart.test.ts` › 「프로토콜이 같으면 pty 를 남기고, 형식이 다른 표는 결과와 상관없이 비운다 — 다시 뜬 앱이 읽지 못한 표를 알리지 않게」, `state.test.ts` › 「고른 재시작으로 표를 비웠으면 pty 를 Recovered 에 열되 알리지 않는다」, 「drop 의 표는 결과와 상관없이 비워 쓴다」
