import { rename, writeFile } from 'node:fs/promises'

/** 제자리 truncate 로 쓰면 그 사이 앱이 죽을 때 깨진 파일이 남으므로, 옆의 `.tmp` 에 쓴 뒤 rename 한다. */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(value), { mode: 0o600 })
  await rename(tmp, path)
}
