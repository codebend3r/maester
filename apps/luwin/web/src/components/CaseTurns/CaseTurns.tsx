import { Button } from '@/components/Button/Button'
import { CASE_TURNS_COPY } from '@/components/CaseTurns/copy'
import styles from '@/components/CaseTurns/CaseTurns.module.scss'
import type { CaseTurn } from '@/lib/api'
import { useChat } from '@/stores/chat'

type ExpectationProps = { term: string; values: string[] }

const Expectation = ({ term, values }: ExpectationProps) =>
  values.length > 0 && (
    <>
      <dt className={styles.term}>{term}</dt>
      <dd className={styles.value}>{values.join(', ')}</dd>
    </>
  )

type CaseTurnsProps = { name: string; turns: CaseTurn[] }

/** The open case's own messages, each sent with what the case expects of the answer. */
export const CaseTurns = ({ name, turns }: CaseTurnsProps) => {
  const send = useChat((state) => state.send)
  const isBusy = useChat((state) => state.isBusy)
  return (
    <section className={styles.turns} aria-labelledby="case-turns-heading">
      <h2 id="case-turns-heading" className={styles.heading}>
        {name}
      </h2>
      <ol className={styles.list}>
        {turns.map((turn) => (
          <li key={turn.user} className={styles.turn}>
            <Button
              className={styles.send}
              disabled={isBusy}
              onClick={() => void send({ text: turn.user, expected: turn })}
            >
              {turn.user}
            </Button>
            <dl className={styles.expects}>
              <Expectation term={CASE_TURNS_COPY.calls} values={turn.expectTools} />
              <Expectation term={CASE_TURNS_COPY.neverCalls} values={turn.forbidTools} />
              <Expectation
                term={CASE_TURNS_COPY.says}
                values={turn.replyMatches ? [`/${turn.replyMatches}/`] : []}
              />
              <Expectation
                term={CASE_TURNS_COPY.neverSays}
                values={turn.replyNotMatches ? [`/${turn.replyNotMatches}/`] : []}
              />
            </dl>
          </li>
        ))}
      </ol>
    </section>
  )
}
