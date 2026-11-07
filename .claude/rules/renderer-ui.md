---
paths:
  - "app/src/renderer/**"
---

- UI 를 만들거나 고치기 전에 쓸 것을 먼저 찾는다.
- 간격(양수 margin·padding·gap)·radius·글자 크기·색은 토큰으로 쓴다. 맞는 토큰이 없으면 값을 직접 쓰지 않고 토큰을 더한다 — 색은 `uiColors`(`app/src/shared/theme.ts`)에, 나머지는 `app/src/renderer/src/style.css` 의 `:root` 에 더한다. 토큰으로 두지 않는 값은 `style.css` 의 `:root` 위 주석을 따른다.
- 비슷한 컴포넌트가 있으면 새로 만들지 않고 그것을 고치거나 넓혀 쓴다.
