# pty 상태와 알림

pty 마다의 상태(명령·cwd·제목·프로그램 상태 레코드)와 알림을 `maru-pty` 가 만들고, main 이 구독해 들고, renderer·`maru` CLI·데스크톱 알림이 main 에서 읽는다. 이 파일은 그 사이의 약속을 적는다. 주로 닿는 코드는 `app/src/main/pty-state.ts`, `app/src/main/pty.ts`(`subscribeState`), `app/src/main/pty-cli.ts`, `app/src/main/seen.ts`, `app/src/main/claude-notification.ts`, `app/src/shared/pane-list.ts`·`pty-list.ts`·`program-status.ts`·`pty-state.ts`, `app/src/renderer/src/pty/states.ts`·`seen.ts`, `core/crates/maru-pty/src/state.rs`·`program_status.rs`, `core/crates/maru/src/main.rs` 다. `subscribe` 요청과 상태·알림 메시지의 모양은 `core/crates/maru-pty/src/lib.rs` 의 모듈 문서에 있다.

## main 이 pty 마다 상태를 구독해 든다

main 은 pane 과 job 의 pty 마다 `maru-pty` 에 `subscribe` 연결을 직접 열고 마지막 상태를 든다. renderer 가 붙어 있든 아니든 든다. 상태를 attach 스트림에서 읽지 않는 것은 attach 연결이 renderer 가 붙은 동안에만 있기 때문이다. `maru pane list`·`pty list`, 데스크톱 알림, idle 로 바꾸기는 renderer 없이 이 상태를 읽는다.

- 코드: `pty-state.ts` 의 `createPtyStates`, `pty.ts` 의 `subscribeState` ↔ `server.rs`(`subscribe`) → `state.rs` 의 `run`
- 바꾸면: 상태를 renderer 에서 받으면 창을 새로 고치는 동안이나 background pane 의 상태를 main 이 모른다.
- 테스트: `pty-state.test.ts` › 「구독해 받은 상태를 들고 알리며, 같은 pty 는 한 번만 구독한다」, 「상태를 받은 구독이 끊기고 pty 가 살아 있으면 마지막 상태를 둔 채 다시 구독한다」

## 구독을 여는 때는 셋이다

main 은 pane 의 pty 를 pty host 가 붙은 뒤 `live` 를 보낼 때, job 의 pty 를 main 이 띄운 뒤, 뜰 때 되살린 pty 를 남은 pty 정리 뒤에 구독한다. host 는 되살린 pty 에 붙을 때(`reattach`) `live` 를 보내지 않으므로, 되살린 pty 는 마지막 경로에 기댄다.

- 코드: `pty-host.ts` 의 `HostEvent`(`live`) ↔ `index.ts` 의 `createHostLink` 의 `onEvent`(`ptyStates.watch`)·job 의 `spawn`·`leftovers`
- 바꾸면: 세 경로 가운데 하나가 빠지면 그 pty 의 상태가 사이드바와 `maru pane list` 에서 빈다.
- 테스트: pane 의 pty 는 `pty-host.test.ts` › 「띄운 pty 에 붙으면 main 에 live 를 알리고, 붙지 못했거나 다시 붙은 pty 는 알리지 않는다」 와 `app/e2e/program-status.spec.ts` › 「OSC 7501 보고가 오면 사이드바의 pane 줄과 pane 헤더의 상태가 바뀌고, clear 로 사라진다」, job 의 pty 는 `app/e2e/pty-cli.spec.ts` › 「job 이 OSC 7501 로 알린 상태를 maru pty list 의 STATE 에 찍는다」, 되살린 pty 는 `app/e2e/restart.spec.ts` › 「재시작 뒤에도 pty 가 들고 있던 상태가 다시 붙을 때 돌아오고, 되살린 셸의 보고를 따른다」

## renderer 는 상태를 main 에서만 받는다

renderer 는 로드하면 `pty:states` 로 전체를 묻고, 그 뒤 `pty:state` push 를 받는다. 묻는 동안 온 push 가 더 새것이므로, 물은 답은 그 pty 를 덮지 않는다.

- 코드: `index.ts` 의 `pty:states`·`sendToWindows('pty:state')` ↔ preload 의 `onPtyState`·`ptyStates` ↔ `renderer/src/pty/states.ts` 의 `syncPtyStates`
- 바꾸면: 물은 답이 push 를 덮으면 로드 직후에 바뀐 상태가 옛것으로 돌아간다.
- 테스트: `states.test.ts` › 「main 에 물은 전체를 넣되, 묻는 동안 push 로 온 pty 는 덮지 않는다」

## `pane list`·`pty list` 는 renderer 에 묻지 않고 답한다

main 은 `maru pane list`·`maru pty list` 에 renderer 를 거치지 않고 답한다. 프로그램 상태 레코드·명령은 main 이 구독한 상태에서, workspace 이름·cell id·pane 의 cwd·제목·git 은 renderer 가 보낸 화면 snapshot(`lastScreen`)에서 가져온다. `pty list` 의 EXIT 는 pane 이면 `maru-pty` 의 `status` 에서, job 이면 job 표에서 가져오고, job 의 DIR 은 main 이 구독한 상태의 cwd 다. 그래서 snapshot 은 pane 의 `git` 과 바꾼 workspace 이름 `name` 을 싣고, main 은 사이드바와 같은 규칙으로 이름을 짓는다. pane 이름은 양쪽이 `paneName` 을, job 이름은 양쪽이 `jobName` 을 함께 쓴다. workspace 이름은 main 이 `workspaceName` 을 부르고, 사이드바(`WorkspaceSidebar.vue`)는 같은 규칙(`w.name ?? autoWorkspaceName(w, home)`)을 직접 쓴다.

- 코드: `index.ts` 의 `currentPaneRows`, `pty-cli.ts` 의 `pty.list`, `shared/pane-list.ts` 의 `paneRows`, `shared/pty-list.ts` 의 `ptyRows` ↔ `shared/screen.ts` 의 snapshot 필드, `shared/names.ts` 의 `workspaceName`·`autoWorkspaceName`, `shared/pane-name.ts` 의 `paneName`, `shared/job.ts` 의 `jobName` ↔ renderer 의 `WorkspaceSidebar.vue`·`sidebarRows.ts`·`sidebarCard.ts`·`switcherRows.ts`·`PaneHeader.vue`
- 바꾸면: snapshot 에서 필드를 빼거나 이름 짓는 규칙을 한쪽만 바꾸면 `maru pane list`·`pty list` 의 이름이 사이드바와 달라진다. `workspaceName` 만 바꾸면 사이드바의 workspace 이름은 그대로다.
- 테스트: `pane-list.test.ts` › 「바꾼 이름이 있는 workspace 의 WORKSPACE 는 그 이름이다」, `pty-list.test.ts` › 「pane 의 pty 를 화면 순서로, 그 뒤에 job 을 표 순서로 싣고, 이름 없는 job 의 NAME 은 사이드바처럼 명령이다」, `app/e2e/pty-cli.spec.ts` › 「maru pty list 는 pane 의 pty 를 화면 순서대로, 그 뒤에 job 을 띄운 순서대로 찍고, 끝난 job 은 EXIT 에 종료 코드를, 이름 없는 job 은 NAME 에 명령을 찍는다」, `app/e2e/pane-list.spec.ts` › 「maru pane list 는 레코드가 있는 pane 과 없는 pane 을 화면 순서대로, 사이드바의 이름과 함께 TSV 로 찍는다」

## 보일 레코드는 `shownRecord` 하나가 고른다

pty 에 레코드가 여럿(루트·하위) 있을 때 보일 레코드는 `shownRecord` 가 고른다. renderer 의 사이드바·헤더, main 의 `pane list`·`pty list`·데스크톱 알림 본문이 같은 함수를 쓴다. 데스크톱 알림 본문은 `index.ts` 가 `statusText` 로 넘기고, `statusText` 가 `shownRecord` 를 부른다.

- 코드: `shared/program-status.ts` 의 `shownRecord`·`statusText` ↔ `renderer/src/pty/states.ts`, `pane-list.ts`·`pty-list.ts`, `index.ts`(`createDesktopNotifications` 의 `status`)
- 바꾸면: 한쪽이 다른 규칙으로 고르면 화면과 `pane list` 의 상태가 다르다.
- 테스트: `pane-list.test.ts` › 「claude 의 루트가 done 이고 하위가 blocked 면 하위의 상태·kind·메시지를 낸다」, `app/e2e/program-status.spec.ts` › 「maru status 로 쓴 하위 레코드가 루트보다 급하면 사이드바·pane 헤더가 그것을 보인다」

## 프로그램 상태 레코드의 주인은 `maru-pty` 다

`maru status` 는 앱 소켓을 쓰지 않고 제어 터미널(없으면 가장 가까운 조상의 터미널)에 OSC 7501 을 쓴다. 그래서 레코드는 `maru-pty` 가 해석하고 든다.

- 코드: `core/crates/maru/src/main.rs` 의 `open_terminal` ↔ `core/crates/maru-pty/src/program_status.rs`
- 바꾸면: `maru status` 가 앱 소켓으로 보내면 앱이 꺼진 동안 쓴 레코드가 사라진다.
- 테스트: `core/crates/maru/tests/cli.rs` › `status_without_a_controlling_terminal_writes_to_the_nearest_ancestors_terminal`, `status_put_without_an_id_writes_the_root_record`

## idle 로 바꾸는 것도 OSC 7501 이다

main 은 보고 있는 pty 의 done 레코드를 idle 로 바꿀 때, 레코드마다 `maru status put idle --pty <id>` 를 실행해 그 pty 의 터미널에 OSC 7501 을 쓴다. id·app·title·message 는 그대로 넘긴다. 앱 메모리에서만 덮으면 다시 뜬 앱에 `maru-pty` 가 done 을 다시 보내기 때문이다.

- 코드: `main/seen.ts` 의 `idleArgs`·`createSeen` ↔ `main.rs` 의 `status put`(`--pty` 는 `MARU_SOCKET` 디렉토리의 레코드에서 `tty` 를 읽는다) ↔ `maru-pty` 의 `record.rs`(`tty`)
- 바꾸면: `maru` 의 `--pty` 나 레코드의 `tty` 를 바꾸면 idle 로 바꾼 레코드가 재시작 뒤 done 으로 돌아온다.
- 테스트: `main/seen.test.ts` › 「루트 레코드는 --id 없이, app·title·message 를 그대로 넘긴다」, `cli.rs` › `status_with_pty_writes_to_that_ptys_terminal_only`, `app/e2e/program-status.spec.ts` › 「idle 로 바꾼 레코드는 재시작한 앱에도 idle 이다」

## 보고 있는 pty 는 renderer 가 알린다

renderer 는 입력 focus 를 가진 pane 의 pty 를 `pty:viewed` 로 알린다. 창에 focus 가 없거나, 터미널이 아닌 요소에 focus 가 있거나, `notification.seen-ms` 가 `false` 면 null 을 알린다. main 은 이 값으로 알림을 들지 않을지, done 을 바로 idle 로 바꿀지 정한다.

- 코드: `App.vue` 의 `viewedPty`·`renderer/src/pty/seen.ts` 의 `createSeenTracker`(`view`) ↔ `index.ts` 의 `pty:viewed` → `pty-state.ts` 의 `viewing`
- 바꾸면: renderer 가 null 을 알리지 않으면 앱 창 밖에서 일하는 동안 온 알림이 바로 지워진다.
- 테스트: `renderer/src/pty/seen.test.ts` › 「delay 가 null 이면 보고 있는 pane 이 없는 것으로 알리고 재지 않는다」, `app/e2e/notification.spec.ts` › 「notification.seen-ms = false 면 보고 있는 pane 에 온 알림도 남는다」

## OSC 9·777 알림도 `subscribe` 연결로 온다

`maru-pty` 는 OSC 9·777 알림을 들지 않고, 받을 때마다 같은 `subscribe` 연결로 보낸다. 구독하기 전에 온 알림은 보내지 않는다.

- 코드: `pty.ts` 의 `subscribeState`(`parsePtyNotification`) ↔ `state.rs` 의 `run`
- 바꾸면: main 은 받은 알림마다 새 알림으로 든다(`pty-state.ts` 의 `notify`). `maru-pty` 가 알림을 들었다가 구독마다 다시 보내면, main 이 다시 구독할 때 같은 알림이 되풀이된다.
- 테스트: `core/crates/maru-pty/tests/process.rs` › `osc_9_and_777_notifications_reach_every_subscriber_in_order`, `a_subscriber_gets_only_the_notifications_sent_after_it_subscribed`

## 알림 텍스트는 양쪽이 같은 규칙으로 한 줄로 다듬는다

`maru-pty` 는 OSC 알림의 텍스트를 `line_text` 로, main 은 Claude Code hook 의 텍스트를 `lineText` 로 다듬는다. 둘은 같은 규칙(제어 문자를 지우고 줄바꿈·탭을 공백으로 바꾸고 앞뒤 공백을 뗀다)이어야 한다. 두 경로의 알림이 같은 사이드바·헤더·데스크톱 알림에 쓰이기 때문이다.

- 코드: `claude-notification.ts` 의 `lineText` ↔ `core/crates/maru-pty/src/vt/mod.rs` 의 `line_text`
- 바꾸면: 한쪽만 바꾸면 같은 글의 알림이 오는 경로에 따라 다르게 보인다.
- 테스트: `vt/mod.rs` › `line_text_trims_the_shared_samples_like_the_app`, `claude-notification.test.ts` › 「maru-pty 와 같은 fixture 를 같게 다듬는다」. 둘 다 `core/crates/maru-pty/tests/line-text.json` 을 읽는다.

## Claude Code 알림은 hook 으로 온다

Claude Code 의 알림은 앱 plugin 의 Notification hook 이 `maru claude hook` 을 불러 `claude.notification` 으로 앱에 보낸다. main 은 OSC 알림과 같이 그 pty 의 알림으로 든다.

- 코드: `app/resources/claude-plugin/hooks/hooks.json` ↔ `main.rs` 의 `claude_hook` ↔ `claude-notification.ts` 의 `claudeNotificationHandlers` → `pty-state.ts` 의 `notify`
- 바꾸면: hook 이 `message` 를 빼거나 다른 이름으로 넘기면 main 이 거절한다. `type`·`title` 은 없어도 거절하지 않는다. 그래서 `type` 을 다른 이름으로 넘기면 main 은 종류를 모른 채 글 있는 알림으로 받고, `idle_prompt` 같은 종류의 알림이 점 대신 글로 보인다.
- 테스트: `cli.rs` › `claude_hook_on_notification_passes_it_to_the_app`, `claude-notification.test.ts` › 「맞지 않는 params 는 거절한다」

## 글 없는 알림은 "점만 달고 본문은 상태" 다

상태 레코드가 같은 내용을 보이는 종류(`idle_prompt`·`permission_prompt`·`elicitation_dialog`)는 main 이 글 없는 알림(`title`·`body` 둘 다 빈 값)으로 든다. 사이드바·헤더는 이 알림에 점만 달고, 데스크톱 알림은 본문에 그 pane 의 상태를 쓴다.

- 코드: `claude-notification.ts`(`SHOWN_BY_STATUS`) ↔ `shared/pty-state.ts` 의 `isBodyless` ↔ `pty-state.ts` 의 `notify`, `desktop-notification.ts` ↔ renderer 의 `sidebarRows.ts`(`notice.body || notice.title`)·`display.ts` 의 `notificationText`
- 바꾸면: renderer 는 `isBodyless` 를 부르지 않고 빈 문자열이 거짓인 것에 기댄다. 빈 값 대신 다른 표시를 쓰면 main 의 `isBodyless` 와 함께 renderer 의 이 두 곳도 고쳐야 한다. 고치지 않으면 사이드바와 헤더에 그 표시가 알림 글로 보인다.
- 테스트: `claude-notification.test.ts` › 「상태 레코드가 같은 내용을 보이는 종류는 글 없는 알림으로 넣고 null 로 답한다」, `desktop-notification.test.ts` › 「글 없는 알림은 제목에 pane 이름을, 본문에 그 pane 의 상태를 쓰고…」

## `pty send`·`job send` 의 붙여넣기 감싸기는 `maru-pty` 가 정한다

main 은 글자를 감싸지 않고 `paste: true` 만 보낸다. bracketed paste(mode 2004)가 켜졌는지는 `maru-pty` 안의 libghostty-vt 만 알기 때문이다. `maru-pty` 가 mode·길이·줄바꿈을 보고 감쌀지 정한다.

- 코드: `pty.ts` 의 `writePtyInput`(`paste`)·`index.ts` 의 `pastePtyText` ↔ `core/crates/maru-pty/src/pty.rs` → `paste.rs` 의 `paste_bytes`
- 바꾸면: main 이 감싸면 bracketed paste 를 켜지 않은 프로그램에 감싸는 시퀀스가 글자로 간다.
- 테스트: `process.rs` › `paste_wraps_a_long_body_when_bracketed_paste_is_on_and_writes_it_whole`, `app/e2e/job.spec.ts` › 「bracketed paste 를 켠 job 에 maru job send 로 보낸 긴 글자는 붙여넣기로 감싸이고 Enter 가 뒤따른다」
