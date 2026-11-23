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
} from './screen'

/**
 * `state-format/` 의 파일은 한 빌드가 쓴 표와 그때의 화면이다. 다른 빌드가 같은 `state.json` 을 읽으므로 고치지 않는다.
 * 표 형식을 바꾸면 그 형식의 파일을 더한다. 이름을 두고 뜻만 바꾼 필드는 이 테스트가 잡지 못한다.
 */
type Fixture = {
  versions: typeof STATE_VERSIONS
  screen: ScreenState
  tables: Pick<SplitScreen, 'workspaces' | 'cells' | 'panes'>
}

const dir = join(__dirname, 'state-format')
const fixtures = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => [f, JSON.parse(readFileSync(join(dir, f), 'utf8')) as Fixture] as const)
const TABLES = ['workspaces', 'cells', 'panes'] as const

/** 버전이 지금과 같은 표만 읽는다. 버전이 다른 표는 지금 앱이 버린다. */
const sameVersion = (f: Fixture) => TABLES.filter((t) => f.versions[t] === STATE_VERSIONS[t])

describe('state.json 표 형식', () => {
  it('지금 버전의 표 형식 파일이 있다', () => {
    expect(fixtures.map(([, f]) => f.versions)).toContainEqual(STATE_VERSIONS)
  })

  it.each(fixtures)('%s 의 표를 지금 앱이 읽으면 그때의 화면이 돌아온다', (_, f) => {
    if (sameVersion(f).length < TABLES.length) return
    const t = f.tables
    const layout = joinTables(
      {
        workspaces: parseWorkspacesTable(t.workspaces),
        cells: parseCellsTable(t.cells),
        panes: parsePanesTable(t.panes)
      },
      f.screen.workspaces.flatMap((w) => w.cells).find((c) => c.key === f.screen.selected)?.id
    )
    // 화면의 key 는 `joinTables` 가 매기는 순서로 적었다.
    // pty 는 표가 아니라 `sessions` 에 적는다.
    const saved = JSON.parse(
      JSON.stringify(f.screen.workspaces, (k, v) => (k === 'ptyId' ? undefined : v))
    )
    expect(layout).toEqual({ workspaces: saved, selected: f.screen.selected })
  })

  it.each(fixtures)('%s 의 화면을 지금 앱이 나누면 그때의 표를 모두 담는다', (_, f) => {
    const split = splitScreen(f.screen)
    for (const name of sameVersion(f)) expect(split[name]).toMatchObject(f.tables[name])
  })
})
