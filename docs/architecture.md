# Architecture

## 세션을 여는 순서

터미널이 세션을 열면 renderer 가 `session:open` 을 보내고, main 은 `MessageChannelMain` 을 만들어 한쪽 포트는 곧바로 renderer 에(`session:port`), 다른 쪽은 `ready` 가 풀린 뒤(`ready.then`) session host 에 넘긴다(`app/src/main/index.ts`).

renderer 는 이 순서에 기댄다. host 가 죽으면 main 이 모든 창에 `session:lost` 를 보내는데, 포트보다 먼저 온 `session:lost` 는 이 open 을 받기 전에 죽은 host 의 것이고 이 open 은 새로 띄운 host 가 받는다. 그래서 연결은 포트를 받은 뒤에만 `session:lost` 를 듣는다(`app/src/renderer/src/session/connection.ts`). main 이 포트를 host 에 넘긴 뒤에 renderer 에 보내도록 바뀌면 이 판단이 틀어진다.
