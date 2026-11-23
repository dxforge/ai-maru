// pty 의 cell 은 그 key 의 kill 로만 지운다 — `docs/contracts/cell-and-window-requests.md` 의 "pty 의 cell 은 `pty:open` 으로 받고 kill 로만 잊는다".
// `close` 가 돌려주는 `closed` 는 그 cell 이 닫혔다는 뜻이다(`docs/contracts/cell-and-window-requests.md` 의 "pane·cell 이 닫힌 것은 kill 로 안다").
export function createPtyCells(): {
  open: (key: string, pty: string, cell: string) => void
  close: (key: string) => { pty: string; closed?: string } | undefined
  cellOf: (pty: string) => string | undefined
  closes: (pty: string) => string | undefined
} {
  const opened = new Map<string, { pty: string; cell: string }>()
  // `close` 와 `closes` 는 이 함수 하나로 cell 이 닫히는지 가른다. ⌘W 확인 창이 묻는 조건(`closes`)과
  // `sendKill` 이 job 을 끄는 조건(`close`)이 어긋나지 않게 하기 위해서다.
  const othersIn = (cell: string, except: string): boolean => {
    for (const [k, o] of opened) if (k !== except && o.cell === cell) return true
    return false
  }
  return {
    open: (key, pty, cell) => void opened.set(key, { pty, cell }),
    close: (key) => {
      const o = opened.get(key)
      if (!o) return undefined
      const closed = !othersIn(o.cell, key)
      opened.delete(key)
      return closed ? { pty: o.pty, closed: o.cell } : { pty: o.pty }
    },
    cellOf: (pty) => {
      for (const o of opened.values()) if (o.pty === pty) return o.cell
      return undefined
    },
    closes: (pty) => {
      for (const [k, o] of opened)
        if (o.pty === pty) return othersIn(o.cell, k) ? undefined : o.cell
      return undefined
    }
  }
}
