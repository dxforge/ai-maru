export type SplitDirection = 'right' | 'down'

export type Layout = { pane: number } | { split: SplitDirection; first: Layout; second: Layout }
