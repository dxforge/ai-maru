// 세션의 workspace 는 그 key 의 kill 로만 지운다 — docs/architecture.md 의 "main 이 아는 세션의 workspace".
// `close` 가 돌려주는 `closed` 는 그 workspace 가 닫혔다는 뜻이다(docs/architecture.md).
export function createSessionWorkspaces(): {
  open: (key: string, session: string, workspace: string) => void
  close: (key: string) => { session: string; closed?: string } | undefined
  workspaceOf: (session: string) => string | undefined
} {
  const opened = new Map<string, { session: string; workspace: string }>()
  return {
    open: (key, session, workspace) => void opened.set(key, { session, workspace }),
    close: (key) => {
      const o = opened.get(key)
      if (!o) return undefined
      opened.delete(key)
      for (const p of opened.values())
        if (p.workspace === o.workspace) return { session: o.session }
      return { session: o.session, closed: o.workspace }
    },
    workspaceOf: (session) => {
      for (const o of opened.values()) if (o.session === session) return o.workspace
      return undefined
    }
  }
}
