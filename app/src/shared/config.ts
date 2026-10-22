/** main 이 읽은 `config.toml` 의 원문이다. TOML 파싱과 검사는 renderer 가 한다. `text` 가 null 이고 `error` 가 없으면 파일이 없다. */
export type ConfigRead = { path: string; text: string | null; error?: string }
