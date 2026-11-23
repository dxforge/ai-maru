# Claude Code 연동

앱은 터미널에서 띄운 claude 에 앱의 plugin(`app/resources/claude-plugin`)을 싣고, 그 plugin 의 MCP 서버(`maru mcp`)가 도구 호출을 앱에 중계한다. 이 파일은 그 사이의 약속을 적는다. 주로 닿는 코드는 `app/resources/bin/claude`(shim), `app/resources/zsh/.zshenv`, `app/src/main/pty.ts`(`shellEnv`), `app/resources/claude-plugin/.mcp.json`, `core/crates/maru/src/main.rs`(`mcp`), `app/src/main/mcp.ts`·`canvas.ts` 다. Notification hook 으로 오는 알림은 `pty-state.md` 에 있다.

## 터미널 PATH 앞에 shim 디렉토리를 둔다

앱은 pty 의 PATH 앞에 `maru` 의 디렉토리와 plugin 옆의 `bin`(claude shim 이 든 디렉토리)을 두고, `MARU_CLI`·`MARU_CLAUDE_PLUGIN` 을 넣는다. 사용자 셸 설정이 PATH 를 다시 써도 shim 을 거치도록, zsh 에서는 앱의 `.zshenv` 의 `_maru_path` 가 사용자 시작 파일을 읽은 뒤에 같은 두 디렉토리를 PATH 앞으로 되살린다. 로그인 셸에서는 앱의 `.zlogin` 이 사용자 `.zlogin` 다음에 부르고, `.zlogin` 을 읽지 않는 셸(로그인 셸이 아니거나 `CLAUDECODE` 안)에서는 첫 프롬프트의 precmd 가 부른다. `shellEnv` 와 `_maru_path` 는 shim 디렉토리를 같은 규칙(`MARU_CLAUDE_PLUGIN` 의 부모 디렉토리의 `bin`)으로 찾는다. shim 은 PATH 의 실행 파일이라 스크립트·`exec`·`command claude`·새로 연 셸에서 띄운 claude 도 거친다.

- 코드: `pty.ts` 의 `shellEnv` ↔ `.zshenv` 의 `_maru_path`·`.zlogin` ↔ `app/electron-builder.yml`(번들의 `bin`·`claude-plugin` 자리)
- 바꾸면: plugin 이나 shim 의 자리를 옮기면 세 곳을 함께 바꾼다. 한쪽만 바꾸면 zsh 터미널의 claude 가 plugin 없이 뜬다.
- 테스트: `app/src/main/zshenv.test.ts` › 「claude shim 디렉토리(plugin 옆 bin)를 maru 디렉토리 바로 뒤에 둔다」, 「사용자 ~/.zshrc 가 PATH 를 통째로 다시 써도 되살린다」, `app/e2e/packaged.spec.ts` › 「설치본의 zsh 터미널에서 claude 는 번들 안의 실행할 수 있는 shim 이다」

## shim 은 진짜 claude 를 exec 한다

shim 은 PATH 에서 shim 이 아닌 첫 claude 를 찾아 `--plugin-dir "$MARU_CLAUDE_PLUGIN"` 을 붙여 exec 한다. shim 인지는 파일의 둘째 줄(`# ai-maru claude shim`)로 알아본다. 다른 앱의 shim 사본이 PATH 에 함께 있어도 서로를 exec 하지 않게 하기 위해서다. `MARU_CLI`·`MARU_CLAUDE_PLUGIN` 가운데 하나가 비었거나 `CLAUDECODE` 가 있으면(claude 안에서 부른 claude) plugin 없이 그대로 exec 한다. `FORCE_HYPERLINK` 가 없고 `MARU_ZDOTDIR` 이 있으며 `SHELL` 이 zsh 면, claude 프로세스에만 `FORCE_HYPERLINK=1`·`MARU_CLAUDE_FORCED_HYPERLINK=1` 과 앱의 `ZDOTDIR` 을 붙인다.

자식으로 띄우지 않고 exec 하는 것은 foreground 리더가 claude 여야 하기 때문이다. `maru-pty` 는 foreground 리더의 cwd 를 표시 cwd 로 쓴다.

- 코드: `app/resources/bin/claude` ↔ `maru-pty` 의 `state.rs`(`same_dir_as`)·`procinfo.rs`, `.zshenv`(`MARU_CLAUDE_FORCED_HYPERLINK` 를 지운다)
- 바꾸면: 둘째 줄을 바꾸면 옛 앱이 남긴 shim 사본을 알아보지 못한다. 자식으로 띄우면 pane 의 cwd 가 claude 가 아니라 shim 의 bash 를 따른다.
- 테스트: `app/src/main/claude-shim.test.ts` › 「자식으로 띄우지 않고 claude 로 바뀐다」, 「다른 앱의 shim 사본이 PATH 에 함께 있어도 그것을 건너뛰고 진짜 claude 를 plugin 하나로 부른다」, 「claude 에만 FORCE_HYPERLINK=1 과 표식, 앱 ZDOTDIR 을 붙인다」

## plugin 의 MCP 서버는 `maru mcp` 다

plugin 의 `.mcp.json` 이 `${MARU_CLI} mcp` 를 MCP 서버로 띄운다.

- 코드: `app/resources/claude-plugin/.mcp.json` ↔ `main.rs` 의 `mcp` 하위 명령 ↔ `pty.ts` 의 `shellEnv`(`MARU_CLI`)
- 바꾸면: 하위 명령 이름이나 `MARU_CLI` 를 바꾸면 claude 가 MCP 서버를 띄우지 못한다.
- 테스트: `app/e2e/packaged.spec.ts` › 「설치본의 터미널에서 MARU_CLI·MARU_CLAUDE_PLUGIN 은 번들 안을 가리키고, plugin 에 MCP 서버 설정이 있다」

## `maru mcp` 는 메시지를 해석하지 않고 앱에 옮긴다

`maru mcp` 는 stdin 의 MCP 메시지를 줄 프로토콜의 `mcp.message` 요청으로 하나씩 앱에 보내고 답을 stdout 에 쓴다. 메시지가 JSON 객체인지와 답이 필요한 요청인지만 보고, 도구와 메서드는 앱의 main 만 안다. `mcp.message` 의 모양은 `main.rs` 의 모듈 문서에 있다.

- 코드: `main.rs` 의 `mcp_reply`·`relay` ↔ `mcp.ts` 의 `mcpHandlers`
- 바꾸면: `maru mcp` 가 도구를 알게 하면 도구를 더할 때 앱과 `maru` 를 함께 바꿔야 한다.
- 테스트: `core/crates/maru/tests/mcp.rs` › `relays_each_message_as_an_mcp_message_request_and_writes_the_reply`, `lines_that_are_not_messages_get_json_rpc_errors_without_reaching_the_app`, `mcp.test.ts` › 「tools/list 는 canvas_put 하나를 돌려준다」

## 예외: `canvas_put` 의 `file` 은 `maru mcp` 가 절대경로로 바꾼다

`maru mcp` 는 `canvas_put` 의 `file` 을 자기 cwd 기준의 절대경로로 바꿔 `path` 로 보낸다. 상대 경로의 기준인 claude 의 cwd 를 `maru mcp` 만 알기 때문이다. 파일은 앱이 읽는다. 앱은 `file` 이 온 호출을 거절하고 `path` 가 절대경로가 아니면 거절한다.

- 코드: `main.rs` 의 `read_file_argument`·`file_path` ↔ `mcp.ts` 의 `callTool` → `canvas.ts` 의 `canvasPut`
- 바꾸면: 앱이 `file` 을 받게 하면 앱의 cwd 기준으로 풀려 다른 파일을 연다.
- 테스트: `mcp.rs` › `sends_a_relative_file_as_its_absolute_path_without_reading_it`, `mcp.test.ts` › 「maru mcp 가 file 을 바꾼 path 를 canvas.put 처리로 넘긴다」

## 앱은 MCP 세션의 상태를 두지 않는다

claude 는 `maru mcp` 를 띄울 때 한 번만 `initialize` 를 보낸다. 앱은 MCP 세션의 상태를 두지 않고, `maru mcp` 는 메시지마다 앱에 새로 연결하며 소켓이 바뀌면 새 앱에 붙는다. 그래서 앱이 다시 떠도 claude 는 같은 `maru mcp` 로 도구를 부른다.

- 코드: `mcp.ts` 의 `mcpHandlers` ↔ `main.rs` 의 `relay`·`connect_waiting`
- 바꾸면: 앱이 `initialize` 를 받은 세션만 받게 하면 앱을 재시작한 뒤 claude 의 도구 호출이 모두 실패한다.
- 테스트: `mcp.rs` › `waits_for_a_stale_socket_to_be_replaced_by_a_new_app`, `mcp.test.ts` › 「initialize 를 받지 않은 앱도 tools/list·tools/call 에 답한다」
