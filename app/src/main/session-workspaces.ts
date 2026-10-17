// 세션의 workspace 는 그 key 의 kill 로만 지운다 — docs/architecture.md 의 "main 이 아는 세션의 workspace".
export function createSessionWorkspaces(): {
  open: (key: string, session: string, workspace: string) => void
  close: (key: string) => void
  workspaceOf: (session: string) => string | undefined
} {
  const opened = new Map<string, { session: string; workspace: string }>()
  return {
    open: (key, session, workspace) => void opened.set(key, { session, workspace }),
    close: (key) => void opened.delete(key),
    workspaceOf: (session) => {
      for (const o of opened.values()) if (o.session === session) return o.workspace
      return undefined
    }
  }
}
