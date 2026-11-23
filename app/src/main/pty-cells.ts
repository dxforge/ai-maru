// pty 의 cell 은 그 key 의 kill 로만 지운다 — `docs/contracts/cell-and-window-requests.md` 의 "pty 의 cell 은 `pty:open` 으로 받고 kill 로만 잊는다".
// `close` 가 돌려주는 `closed` 는 그 cell 이 닫혔다는 뜻이다(`docs/contracts/cell-and-window-requests.md` 의 "pane·cell 이 닫힌 것은 kill 로 안다").
export function createPtyCells(): {
  open: (key: string, pty: string, cell: string) => void
  close: (key: string) => { pty: string; closed?: string } | undefined
  cellOf: (pty: string) => string | undefined
  closes: (pty: string) => string | undefined
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
    },
    // `close` 와 같이 cell 에 남은 key 로 가르므로, background pane 이 남은 cell 은 닫히지 않는다고 본다.
    closes: (pty) => {
      const cell = [...opened.values()].find((o) => o.pty === pty)?.cell
      if (cell === undefined) return undefined
      const keys = [...opened.values()].filter((o) => o.cell === cell)
      return keys.length === 1 ? cell : undefined
    }
  }
}
