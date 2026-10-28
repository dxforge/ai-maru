export type LauncherConfig = { commands: readonly string[] }

export const DEFAULT_LAUNCHER: LauncherConfig = { commands: ['claude', 'codex'] }

export const LAUNCHER_KEYS: readonly string[] = ['commands']

/** 따옴표는 풀지 않는다. 공백으로만 나눈다. */
export function commandArgv(entry: string): string[] {
  return entry.split(/\s+/).filter(Boolean)
}

export function sameLauncher(a: LauncherConfig, b: LauncherConfig): boolean {
  return a.commands.length === b.commands.length && a.commands.every((c, i) => c === b.commands[i])
}

export function parseLauncher(
  launcher: Record<string, unknown>,
  warnings: string[]
): LauncherConfig {
  const { commands } = launcher
  if (commands === undefined) return DEFAULT_LAUNCHER
  if (
    Array.isArray(commands) &&
    commands.length > 0 &&
    commands.every((c) => typeof c === 'string' && commandArgv(c).length > 0)
  )
    return { commands: commands as string[] }
  warnings.push('launcher.commands must be a non-empty list of commands, using the default.')
  return DEFAULT_LAUNCHER
}
