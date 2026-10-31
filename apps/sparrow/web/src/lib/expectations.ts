/**
 * An eval case's expectations checked against what sparrow did, the way
 * `sparrow/evals/__init__.py`'s `run_case` checks them: each expected tool was
 * called, no forbidden one was, and the reply matches (or doesn't match) a
 * pattern, case-insensitively, with `.` crossing lines.
 */
import type { CaseTurn } from '@/lib/api'

export type Verdict = { isPassed: boolean; failures: string[] }

/**
 * A case's Python pattern as a JavaScript one, or null when it can't be
 * compiled here. The flags already cover a leading `(?i)`, and `\A` (start of
 * input) is `^` without the `m` flag.
 */
const toPattern = (pattern: string): RegExp | null => {
  try {
    return new RegExp(pattern.replace(/^\(\?i\)/, '').replaceAll('\\A', '^'), 'is')
  } catch {
    return null
  }
}

const quoted = (names: string[]) => `[${names.map((name) => `'${name}'`).join(', ')}]`

type PatternFailuresProps = {
  pattern: string | null
  reply: string
  shouldMatch: boolean
}

const patternFailures = ({ pattern, reply, shouldMatch }: PatternFailuresProps): string[] => {
  if (pattern == null) return []
  const compiled = toPattern(pattern)
  if (!compiled) return [`can't check /${pattern}/ in the browser`]
  if (compiled.test(reply) === shouldMatch) return []
  return [shouldMatch ? `reply did not match /${pattern}/` : `reply matched forbidden /${pattern}/`]
}

type CheckTurnProps = {
  turn: CaseTurn
  tools: string[]
  reply: string
}

export const checkTurn = ({ turn, tools, reply }: CheckTurnProps): Verdict => {
  const failures = [
    ...turn.expectTools
      .filter((name) => !tools.includes(name))
      .map((name) => `expected tool '${name}', called ${quoted(tools)}`),
    ...turn.forbidTools
      .filter((name) => tools.includes(name))
      .map((name) => `forbidden tool '${name}' was called`),
    ...patternFailures({ pattern: turn.replyMatches, reply, shouldMatch: true }),
    ...patternFailures({ pattern: turn.replyNotMatches, reply, shouldMatch: false }),
  ]
  return { isPassed: failures.length === 0, failures }
}
