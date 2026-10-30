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

type ToolTraceProps = { tools: ToolCall[] }

/** Each tool call a turn made, its arguments and what it answered, folded until opened. */
export const ToolTrace = ({ tools }: ToolTraceProps) => (
  <details className={styles.trace}>
    <summary className={styles.summary}>
      {TOOL_TRACE_COPY.calls(tools.length)} {tools.map((tool) => tool.name).join(', ')}
    </summary>
    <ol className={styles.calls}>
      {tools.map((tool, index) => (
        <li key={`${tool.name}-${index}`} className={styles.call}>
          <p className={styles.name}>
            {tool.name}{' '}
            <span className={tool.ok ? styles.ok : styles.failed}>
              {tool.ok ? TOOL_TRACE_COPY.ok : TOOL_TRACE_COPY.error}
            </span>
          </p>
          <pre className={styles.code}>{JSON.stringify(tool.input, null, 2)}</pre>
          <pre className={styles.code}>{pretty(tool.result)}</pre>
        </li>
      ))}
    </ol>
  </details>
)
