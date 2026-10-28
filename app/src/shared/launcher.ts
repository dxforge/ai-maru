/**
 * `userData/launcher.json` 의 내용이다. `recent` 는 런처로 연 디렉토리의 절대경로로, 최근에 연 것이 앞이다. `command` 는
 * 마지막으로 띄운 명령(`launcher.commands` 의 항목 문자열, 셸이면 `SHELL`)이고, 띄운 적이 없으면 null 이다.
 */
export type LauncherState = { recent: string[]; command: string | null }

/** 명령 없이 셸만 여는 항목. `launcher.commands` 는 빈 항목을 받지 않으므로 그 항목과 겹치지 않는다. */
export const SHELL = ''

export type LaunchResult = { ok: true } | { ok: false; reason: string }
