---
paths:
  - "app/package.json"
---

- renderer 에서만 쓰는 패키지는 `pnpm add -D` 로 devDependencies 에 넣는다. 이유는 `app/electron-builder.yml` 의 `files` 위 주석에 있다.
