// pty 의 cell 은 그 key 의 kill 로만 지운다 — `docs/contracts/cell-and-window-requests.md` 의 "pty 의 cell 은 `pty:open` 으로 받고 kill 로만 잊는다".
// `close` 가 돌려주는 `closed` 는 그 cell 이 닫혔다는 뜻이다(`docs/contracts/cell-and-window-requests.md` 의 "pane·cell 이 닫힌 것은 kill 로 안다").
export function createPtyCells(): {
  open: (key: string, pty: string, cell: string) => void
  close: (key: string) => { pty: string; closed?: string } | undefined
  cellOf: (pty: string) => string | undefined
} {
  const opened = new Map<string, { pty: string; cell: string }>()
  return {
    open: (key, pty, cell) => void opened.set(key, { pty, cell }),
    close: (key) => {
      const o = opened.get(key)
      if (!o) return undefined
      opened.delete(key)
      for (const p of opened.values()) if (p.cell === o.cell) return { pty: o.pty }
      return { pty: o.pty, closed: o.cell }
    },
    cellOf: (pty) => {
      for (const o of opened.values()) if (o.pty === pty) return o.cell
      return undefined
    }
  }
}
