# Architecture

## 세션을 여는 순서

터미널이 세션을 열면 renderer 가 `session:open` 을 보내고, main 은 `MessageChannelMain` 을 만들어 한쪽 포트는 곧바로 renderer 에(`session:port`), 다른 쪽은 `ready` 가 풀린 뒤(`ready.then`) session host 에 넘긴다(`app/src/main/index.ts`).

renderer 는 이 순서에 기댄다. host 가 죽으면 main 이 모든 창에 `session:lost` 를 보내는데, 포트보다 먼저 온 `session:lost` 는 이 open 을 받기 전에 죽은 host 의 것이고 이 open 은 새로 띄운 host 가 받는다. 그래서 연결은 포트를 받은 뒤에만 `session:lost` 를 듣는다(`app/src/renderer/src/session/connection.ts`). main 이 포트를 host 에 넘긴 뒤에 renderer 에 보내도록 바뀌면 이 판단이 틀어진다.

## 칸 경계와 셀 격자

나란히 놓인 칸끼리 터미널 행이, 위아래로 놓인 칸끼리 열이 이어지도록 칸 경계를 터미널 셀 크기의 배수에 둔다. 모든 터미널이 같은 글꼴을 쓰므로 `App.vue` 는 마지막으로 잰 값 하나를 `--row`·`--cell`·`--pad` 로 화면 전체에 둔다.

칸 머리는 터미널 한 행이다. 높이는 `--row` 이고 터미널과 같은 글꼴·크기로 쓰며, 터미널은 머리 바로 아래 행에서 시작한다. 칸 머리·workspace 머리처럼 격자 위에 놓이는 것은 터미널 글꼴을, 사이드바·팔레트·Canvas 처럼 격자 밖의 것은 system-ui 를 쓴다.

경계선은 자리를 차지하지 않는다. 1px 라도 자리를 차지하면 그 뒤 칸이 격자에서 밀리기 때문이다. 좌우 칸의 경계선은 오른쪽 칸의 터미널 왼쪽 여백 위에 겹쳐 그리고, 위아래 칸은 아래 칸의 머리가 경계가 된다.
