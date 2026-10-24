// 세션의 cell 은 그 key 의 kill 로만 지운다 — docs/architecture.md 의 "main 이 아는 세션의 cell".
// `close` 가 돌려주는 `closed` 는 그 cell 이 닫혔다는 뜻이다(docs/architecture.md).
export function createSessionCells(): {
  open: (key: string, session: string, cell: string) => void
  close: (key: string) => { session: string; closed?: string } | undefined
  cellOf: (session: string) => string | undefined
} {
  const opened = new Map<string, { session: string; cell: string }>()
  return {
    open: (key, session, cell) => void opened.set(key, { session, cell }),
    close: (key) => {
      const o = opened.get(key)
      if (!o) return undefined
      opened.delete(key)
      for (const p of opened.values()) if (p.cell === o.cell) return { session: o.session }
      return { session: o.session, closed: o.cell }
    },
    cellOf: (session) => {
      for (const o of opened.values()) if (o.session === session) return o.cell
      return undefined
    }
  }
}
