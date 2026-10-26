import { useEffect, useRef } from 'react'
import { NoticeList } from '@/components/NoticeList/NoticeList'
import { ReplyCard } from '@/components/ReplyCard/ReplyCard'
import styles from '@/components/Transcript/Transcript.module.scss'
import { ENTRY_KINDS, type Entry } from '@/lib/entries'
import { useChat } from '@/stores/chat'

type EntryViewProps = { entry: Entry }

const EntryView = ({ entry }: EntryViewProps) => {
  switch (entry.kind) {
    case ENTRY_KINDS.said:
      return <p className={styles.said}>{entry.text}</p>
    case ENTRY_KINDS.reply:
      return <ReplyCard reply={entry} />
    case ENTRY_KINDS.decision:
      return (
        <section className={styles.decision} aria-label="Decision">
          <p>{entry.text}</p>
          {entry.notices.length > 0 && <NoticeList notices={entry.notices} />}
        </section>
      )
    default: {
      const unknown: never = entry
      return unknown
    }
  }
}

/** The conversation so far, newest at the bottom and kept in view. */
export const Transcript = () => {
  const entries = useChat((state) => state.entries)
  const end = useRef<HTMLLIElement>(null)
  // Every render is a change to `entries`, the one thing this reads, so each one scrolls.
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' })
  })

  if (entries.length === 0) {
    return <p className={styles.empty}>Ask luwin something, or send one of the case's messages.</p>
  }
  return (
    <ol className={styles.transcript} aria-label="Conversation">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className={entry.kind === ENTRY_KINDS.said ? styles.mine : styles.theirs}
        >
          <EntryView entry={entry} />
        </li>
      ))}
      <li ref={end} aria-hidden="true" />
    </ol>
  )
}
