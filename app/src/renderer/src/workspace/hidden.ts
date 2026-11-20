import {
  line,
  panes,
  withWeight,
  withoutCols,
  type Layout,
  type Split,
  type SplitDirection
} from './layout'

/**
 * 숨긴 pane 은 분할 트리에 남는다. 화면·이동·크기 조절은 숨긴 잎을 접은 트리(`visibleLayout`)로 하고, 거기서 바꾼 크기는
 * `mergeVisible` 이 원래 트리에 되쓴다. 꺼내면 원래 자리와 크기로 돌아오게 하기 위해서다.
 *
 * 줄의 항목인 나눔에서 한쪽이 모두 숨겨지면 남은 쪽이 그 항목의 몫(`weight`)을 잇는다. 남은 쪽이 바깥 줄과 같은 방향으로
 * 나뉘었으면 그 항목들이 바깥 줄에 들어가므로, 몫의 합이 사라진 항목의 몫이 되게 맞춘다.
 */
export function visibleLayout(layout: Layout, hidden: ReadonlySet<number>): Layout | null {
  return hidden.size ? visible(layout, hidden) : layout
}

function visible(node: Layout, hidden: ReadonlySet<number>, outer?: SplitDirection): Layout | null {
  if ('pane' in node) return hidden.has(node.pane) ? null : node
  const first = visible(node.first, hidden, node.split)
  const second = visible(node.second, hidden, node.split)
  if (first && second) {
    return first === node.first && second === node.second ? node : { ...node, first, second }
  }
  const rest = first ?? second
  if (!rest || node.split === outer || outer === undefined) return rest
  if ('split' in rest && rest.split === outer)
    return scaleLine(rest, (node.weight ?? 1) / total(rest))
  return withWeight(rest, node.weight)
}

function total(layout: Layout): number {
  if (!('split' in layout)) return layout.weight ?? 1
  return line(layout, layout.split).reduce((sum, item) => sum + (item.weight ?? 1), 0)
}

// 줄 `root` 의 항목마다 `f` 를 부른다. `i` 는 줄 안의 순서다.
function mapLine(root: Split, f: (item: Layout, i: number) => Layout): Layout {
  let i = 0
  const go = (node: Layout): Layout =>
    'split' in node && node.split === root.split
      ? { ...node, first: go(node.first), second: go(node.second) }
      : f(node, i++)
  return go(root)
}

function scaleLine(root: Split, by: number): Layout {
  return mapLine(root, (item) => withWeight(item, (item.weight ?? 1) * by))
}

/**
 * `shown` 은 `visibleLayout(full, hidden)` 과 모양이 같은 트리로, 그 크기를 바꾼 것이다. 보이는 pane 의 열 수와 보이는
 * 항목의 몫을 `full` 에 되쓴다. 줄에서 보이는 항목의 몫이 바뀌면 숨긴 항목의 몫도 같은 비율로 맞추고, 보이는 항목의
 * 몫이 모두 지워졌으면(같게 나누기) 숨긴 항목의 몫도 지운다. 좌우 줄에서 보이는 pane 의 열 수가 모두 지워졌으면 숨긴
 * pane 의 열 수도 지운다.
 */
export function mergeVisible(full: Layout, hidden: ReadonlySet<number>, shown: Layout): Layout {
  if (!hidden.size) return shown
  const merged = rescaleHidden(full, merge(full, hidden, shown), hidden)
  return clearHiddenCols(full, merged, hidden)
}

function clearHiddenCols(old: Layout, next: Layout, hidden: ReadonlySet<number>): Layout {
  const colsOf = (l: Layout): Map<number, number | undefined> => {
    const out = new Map<number, number | undefined>()
    const walk = (n: Layout): void => {
      if ('pane' in n) {
        out.set(n.pane, n.cols)
        return
      }
      walk(n.first)
      walk(n.second)
    }
    walk(l)
    return out
  }
  const before = colsOf(old)
  const clear = (n: Layout): Layout =>
    'pane' in n
      ? hidden.has(n.pane)
        ? withoutCols(n)
        : n
      : { ...n, first: clear(n.first), second: clear(n.second) }
  const walk = (n: Layout, outer?: SplitDirection): Layout => {
    if (!('split' in n)) return n
    if (n.split === 'right' && outer !== 'right') {
      const now = colsOf(n)
      const shown = panes(n).filter((k) => !hidden.has(k))
      const had = shown.some((k) => before.get(k) !== undefined)
      if (had && shown.every((k) => now.get(k) === undefined)) return clear(n)
    }
    return { ...n, first: walk(n.first, n.split), second: walk(n.second, n.split) }
  }
  return walk(next)
}

function merge(
  node: Layout,
  hidden: ReadonlySet<number>,
  shown: Layout,
  outer?: SplitDirection
): Layout {
  if ('pane' in node) {
    const cols = 'pane' in shown ? shown.cols : undefined
    return withWeight(cols === undefined ? withoutCols(node) : { ...node, cols }, shown.weight)
  }
  const first = visible(node.first, hidden, node.split)
  const second = visible(node.second, hidden, node.split)
  if (first && second && 'split' in shown) {
    return {
      ...withWeight(node, shown.weight),
      first: merge(node.first, hidden, shown.first, node.split),
      second: merge(node.second, hidden, shown.second, node.split)
    }
  }
  const side = first ? 'first' : 'second'
  const rest = node[side]
  const restShown = first ?? second!
  if (node.split === outer || outer === undefined) {
    return { ...node, [side]: merge(rest, hidden, shown, node.split) }
  }
  if ('split' in restShown && restShown.split === outer && 'split' in shown) {
    // 같게 나눈 줄이면 이 항목이 바깥 줄에서 들어간 항목 수만큼의 몫을 가져야 투영이 같게 나뉜다.
    const items = line(shown, outer)
    const cleared = items.every((item) => item.weight === undefined)
    const sum = cleared ? items.length : total(shown)
    const unscaled = cleared
      ? clearLine(shown)
      : keepEqual(restShown, scaleLine(shown, total(restShown) / (node.weight ?? 1)))
    const same = Math.abs(sum - (node.weight ?? 1)) < 1e-9
    return {
      ...withWeight(node, same ? node.weight : sum),
      [side]: merge(rest, hidden, withWeight(unscaled, restShown.weight), node.split)
    }
  }
  return {
    ...withWeight(node, shown.weight),
    [side]: merge(rest, hidden, withWeight(shown, restShown.weight), node.split)
  }
}

// 줄여 넣었다가 되돌린 몫은 소수 오차가 남는다. 원래 값과 같으면 원래 값(없음 포함)을 둔다.
function keepEqual(old: Layout, next: Layout): Layout {
  if (!('split' in old) || !('split' in next)) return next
  const items = line(old, old.split)
  return mapLine(next, (item, i) => {
    const was = items[i].weight
    return Math.abs((item.weight ?? 1) - (was ?? 1)) < 1e-9 ? withWeight(item, was) : item
  })
}

function clearLine(root: Split): Layout {
  return mapLine(root, (item) => withWeight(item, undefined))
}

function rescaleHidden(old: Layout, next: Layout, hidden: ReadonlySet<number>): Layout {
  const walk = (o: Layout, n: Layout, outer?: SplitDirection): Layout => {
    if (!('split' in o) || !('split' in n)) return n
    const children: Split = {
      ...n,
      first: walk(o.first, n.first, n.split),
      second: walk(o.second, n.second, n.split)
    }
    return n.split === outer ? children : rescaleLine(o as Split, children, hidden)
  }
  return walk(old, next)
}

function rescaleLine(old: Split, next: Split, hidden: ReadonlySet<number>): Layout {
  const before = line(old, old.split)
  const after = line(next, next.split)
  const shownAt = after.map((item) => visible(item, hidden, next.split) !== null)
  if (shownAt.every(Boolean)) return next
  const changed = after.some((item, i) => shownAt[i] && item.weight !== before[i].weight)
  if (!changed) return next
  const shownItems = after.filter((_, i) => shownAt[i])
  const cleared = shownItems.every((item) => item.weight === undefined)
  const sum = (items: Layout[]): number => items.reduce((s, item) => s + (item.weight ?? 1), 0)
  const ratio = sum(shownItems) / sum(before.filter((_, i) => shownAt[i]))
  return mapLine(next, (item, i) =>
    shownAt[i] ? item : withWeight(item, cleared ? undefined : (before[i].weight ?? 1) * ratio)
  )
}
