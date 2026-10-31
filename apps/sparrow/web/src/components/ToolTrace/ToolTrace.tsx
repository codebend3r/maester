import { TOOL_TRACE_COPY } from '@/components/ToolTrace/copy'
import styles from '@/components/ToolTrace/ToolTrace.module.scss'
import type { ToolCall } from '@/lib/events'

const pretty = (text: string): string => {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

/** A call's arguments as the chip shows them, their values in order: ("movie", 10). */
const shownArgument = (input: Record<string, unknown>): string =>
  Object.values(input)
    .map((value) => JSON.stringify(value))
    .join(', ')

type ToolTraceProps = { tools: ToolCall[] }

/** Each tool call a turn made as a chip, opening to its arguments and what it answered. */
export const ToolTrace = ({ tools }: ToolTraceProps) => (
  <ul className={styles.chips} aria-label={TOOL_TRACE_COPY.label}>
    {tools.map((tool, index) => (
      <li key={`${tool.name}-${index}`} className={styles.call}>
        <details className={styles.details}>
          <summary className={tool.ok ? styles.chip : styles.failedChip}>
            {TOOL_TRACE_COPY.chip({
              name: tool.name,
              argument: shownArgument(tool.input),
              isOk: tool.ok,
            })}
          </summary>
          <dl className={styles.trace}>
            <dt className={styles.term}>{TOOL_TRACE_COPY.input}</dt>
            <dd>
              <pre className={styles.code}>{JSON.stringify(tool.input, null, 2)}</pre>
            </dd>
            <dt className={styles.term}>{TOOL_TRACE_COPY.result}</dt>
            <dd>
              <pre className={styles.code}>{pretty(tool.result)}</pre>
            </dd>
          </dl>
        </details>
      </li>
    ))}
  </ul>
)
