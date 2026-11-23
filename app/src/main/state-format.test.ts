import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  joinTables,
  parseCellsTable,
  parsePanesTable,
  parseWorkspacesTable,
  splitScreen,
  STATE_VERSIONS,
  type ScreenState,
  type SplitScreen
} from '../shared/screen'
import {
  parseSessionsPart,
  parseViewPart,
  screenView,
  type SessionsPart,
  type ViewPart
} from './state'

/**
 * `state-format/` 의 파일은 한 빌드가 쓴 표와 그때의 화면이다. 다른 빌드가 같은 `state.json` 을 읽으므로 고치지 않는다.
 * 표 형식을 바꾸면 그 형식의 파일을 더한다. 이름을 두고 뜻만 바꾼 필드는 이 테스트가 잡지 못한다.
 * 지금 앱이 만든 값은 `toMatchObject` 로 파일과 견준다. 버전을 올리지 않고 필드만 더한 빌드에서도 옛 파일이 통과해야 하기 때문이다.
 */
type Fixture = {
  versions: typeof STATE_VERSIONS
  screen: ScreenState
  tables: Pick<SplitScreen, 'workspaces' | 'cells' | 'panes'> & {
    sessions: SessionsPart
    view: ViewPart
  }
}

const dir = join(__dirname, 'state-format')
const fixtures = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => [f, JSON.parse(readFileSync(join(dir, f), 'utf8')) as Fixture] as const)
const TABLES = ['workspaces', 'cells', 'panes', 'sessions', 'view'] as const

/** 버전이 지금과 같은 표만 읽는다. 버전이 다른 표는 지금 앱이 버린다. */
const sameVersion = (f: Fixture) => TABLES.filter((t) => f.versions[t] === STATE_VERSIONS[t])

describe('state.json 표 형식', () => {
  it('지금 버전의 표 형식 파일이 있다', () => {
    expect(fixtures.map(([, f]) => f.versions)).toContainEqual(STATE_VERSIONS)
  })

  it.each(fixtures)('%s 의 sessions·view 에 적힌 값을 지금 앱이 모두 읽는다', (_, f) => {
    const same = sameVersion(f)
    if (same.includes('sessions'))
      expect(parseSessionsPart(f.tables.sessions)).toMatchObject(f.tables.sessions)
    if (same.includes('view')) expect(parseViewPart(f.tables.view)).toMatchObject(f.tables.view)
  })

  it.each(fixtures)('%s 의 표를 지금 앱이 읽으면 그때의 화면이 돌아온다', (_, f) => {
    if (sameVersion(f).length < TABLES.length) return
    const t = f.tables
    const view = parseViewPart(t.view)
    const layout = joinTables(
      {
        workspaces: parseWorkspacesTable(t.workspaces),
        cells: parseCellsTable(t.cells),
        panes: parsePanesTable(t.panes)
      },
      view.selected
    )
    // 화면의 key 는 `joinTables` 가 매기는 순서로 적었다.
    // pty 는 표가 아니라 `sessions` 에 적는다.
    const saved = JSON.parse(
      JSON.stringify(f.screen.workspaces, (k, v) => (k === 'ptyId' ? undefined : v))
    )
    expect(layout).toMatchObject({ workspaces: saved, selected: f.screen.selected })

    const ptyOf = new Map(parseSessionsPart(t.sessions)?.ptys.map((p) => [p.pane, p.pty]))
    const panes = f.screen.workspaces.flatMap((w) => w.cells.flatMap((c) => c.panes))
    expect(panes.map((p) => ptyOf.get(p.id))).toEqual(panes.map((p) => p.ptyId))

    const { viewMode, sidebar, canvas } = f.screen
    expect(view).toMatchObject({
      viewMode,
      sidebar: { open: sidebar.open, width: sidebar.width },
      folded: sidebar.folded,
      ...(canvas && { canvas })
    })
  })

  it.each(fixtures)('%s 의 화면을 지금 앱이 나누면 그때의 표를 모두 담는다', (_, f) => {
    const split = splitScreen(f.screen)
    const same = sameVersion(f)
    for (const name of ['workspaces', 'cells', 'panes'] as const)
      if (same.includes(name)) expect(split[name]).toMatchObject(f.tables[name])
    if (same.includes('sessions')) expect(split.ptys).toMatchObject(f.tables.sessions.ptys)
    // 창·테마는 화면에서 오지 않으므로 표의 값을 넘긴다.
    const { version, window, theme } = f.tables.view
    if (same.includes('view'))
      expect(screenView({ version, window, theme }, f.screen, split.selected)).toMatchObject(
        f.tables.view
      )
  })
})
