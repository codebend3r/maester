import { Button, BUTTON_TONES } from '@/components/Button/Button'
import { NoticeList } from '@/components/NoticeList/NoticeList'
import styles from '@/components/ReplyCard/ReplyCard.module.scss'
import { RichText } from '@/components/RichText/RichText'
import { TitleCards } from '@/components/TitleCards/TitleCards'
import { ToolTrace } from '@/components/ToolTrace/ToolTrace'
import { REPLY_CARD_COPY, VERDICT_COPY } from '@/components/ReplyCard/copy'
import type { CaseTurn } from '@/lib/api'
import { checkTurn } from '@/lib/expectations'
import { REPLY_STATES, type Reply } from '@/lib/entries'
import { useChat } from '@/stores/chat'

type VerdictProps = { reply: Reply; expected: CaseTurn }

/** How a finished reply measured up to its case message's expectations. */
const Verdict = ({ reply, expected }: VerdictProps) => {
  const verdict = checkTurn({
    turn: expected,
    tools: reply.tools.map((tool) => tool.name),
    reply: reply.chunks.join('\n'),
  })
  return (
    <section
      className={verdict.isPassed ? styles.passed : styles.failed}
      aria-label={VERDICT_COPY.label}
    >
      <p>{verdict.isPassed ? VERDICT_COPY.passed : VERDICT_COPY.missed}</p>
      {verdict.failures.length > 0 && (
        <ul className={styles.failures}>
          {verdict.failures.map((failure) => (
            <li key={failure}>{failure}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

type ReplyCardProps = { reply: Reply }

/** One of luwin's answers: its text, the work behind it, and whatever it asks of you. */
export const ReplyCard = ({ reply }: ReplyCardProps) => {
  const pick = useChat((state) => state.pick)
  const press = useChat((state) => state.press)
  const settled = useChat((state) => state.settled)
  const isBusy = useChat((state) => state.isBusy)
  return (
    <article className={styles.reply} aria-busy={reply.state === REPLY_STATES.running}>
      {reply.tools.length > 0 && <ToolTrace tools={reply.tools} />}
      {reply.state === REPLY_STATES.running && (
        <p className={styles.thinking}>{REPLY_CARD_COPY.thinking}</p>
      )}
      {reply.chunks.length > 0 && (
        <p className={styles.text}>
          <RichText text={reply.chunks.join('\n')} />
        </p>
      )}
      {reply.titles.length > 0 && <TitleCards cards={reply.titles} />}
      {reply.confirmations.map((confirmation) => (
        <section
          key={confirmation.pendingId}
          className={styles.ask}
          aria-label={REPLY_CARD_COPY.confirmation}
        >
          <p>{confirmation.summary}</p>
          <div className={styles.actions}>
            {[true, false].map((approve) => (
              <Button
                key={String(approve)}
                tone={approve ? BUTTON_TONES.primary : BUTTON_TONES.quiet}
                disabled={isBusy || settled.includes(confirmation.pendingId)}
                onClick={() => void press({ pendingId: confirmation.pendingId, approve })}
              >
                {approve ? REPLY_CARD_COPY.confirm : REPLY_CARD_COPY.cancel}
              </Button>
            ))}
          </div>
        </section>
      ))}
      {reply.choices.length > 0 && (
        <ul className={styles.choices} aria-label={REPLY_CARD_COPY.choices}>
          {reply.choices.map((choice) => (
            <li key={choice.value}>
              <Button className={styles.choice} disabled={isBusy} onClick={() => void pick(choice)}>
                <span>{choice.display}</span>
                {choice.detail && <span className={styles.detail}>{choice.detail}</span>}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {reply.notices.length > 0 && <NoticeList notices={reply.notices} />}
      {reply.cause && (
        <section className={styles.cause} aria-label={REPLY_CARD_COPY.whyItBroke}>
          <p>{REPLY_CARD_COPY.whyItBroke}</p>
          <pre className={styles.trace}>{reply.cause}</pre>
        </section>
      )}
      {reply.failure && (
        <p className={styles.failure} role="alert">
          {reply.failure}
        </p>
      )}
      {!!reply.expected && reply.state === REPLY_STATES.done && (
        <Verdict reply={reply} expected={reply.expected} />
      )}
    </article>
  )
}
