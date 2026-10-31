import { type ComponentType, type RefObject, useEffect, useRef } from 'react'
import { NoticeList } from '@/components/NoticeList/NoticeList'
import { ReplyCard } from '@/components/ReplyCard/ReplyCard'
import { DECISION_COPY, TRANSCRIPT_COPY } from '@/components/Transcript/copy'
import styles from '@/components/Transcript/Transcript.module.scss'
import { ENTRY_KINDS, type Entry } from '@/lib/entries'
import { useChat } from '@/stores/chat'

type EntryKind = Entry['kind']

type EntryViewProps = { entry: Entry }

type SaidViewProps = EntryViewProps

const SaidView = ({ entry }: SaidViewProps) =>
  entry.kind === ENTRY_KINDS.said && <p className={styles.said}>{entry.text}</p>

type ReplyViewProps = EntryViewProps

const ReplyView = ({ entry }: ReplyViewProps) =>
  entry.kind === ENTRY_KINDS.reply && <ReplyCard reply={entry} />

type DecisionViewProps = EntryViewProps

const DecisionView = ({ entry }: DecisionViewProps) =>
  entry.kind === ENTRY_KINDS.decision && (
    <section className={styles.decision} aria-label={DECISION_COPY.label}>
      <p>{entry.text}</p>
      {entry.notices.length > 0 && <NoticeList notices={entry.notices} />}
    </section>
  )

const ENTRY_VIEWS = {
  [ENTRY_KINDS.said]: SaidView,
  [ENTRY_KINDS.reply]: ReplyView,
  [ENTRY_KINDS.decision]: DecisionView,
} as const satisfies Record<EntryKind, ComponentType<EntryViewProps>>

const EntryView = ({ entry }: EntryViewProps) => {
  const View = ENTRY_VIEWS[entry.kind]
  return <View entry={entry} />
}

const TRANSCRIPT_STATES = { empty: 'empty', filled: 'filled' } as const

type TranscriptState = (typeof TRANSCRIPT_STATES)[keyof typeof TRANSCRIPT_STATES]

type TranscriptViewProps = { entries: Entry[]; end: RefObject<HTMLLIElement | null> }

const EmptyTranscript = () => <p className={styles.empty}>{TRANSCRIPT_COPY.empty}</p>

type FilledTranscriptProps = TranscriptViewProps

const FilledTranscript = ({ entries, end }: FilledTranscriptProps) => (
  <ol className={styles.transcript} aria-label={TRANSCRIPT_COPY.label}>
    {entries.map((entry) => (
      <li key={entry.id} className={entry.kind === ENTRY_KINDS.said ? styles.mine : styles.theirs}>
        <EntryView entry={entry} />
      </li>
    ))}
    <li ref={end} aria-hidden="true" />
  </ol>
)

const TRANSCRIPT_VIEWS = {
  [TRANSCRIPT_STATES.empty]: EmptyTranscript,
  [TRANSCRIPT_STATES.filled]: FilledTranscript,
} as const satisfies Record<TranscriptState, ComponentType<TranscriptViewProps>>

/** The conversation so far, newest at the bottom and kept in view. */
export const Transcript = () => {
  const entries = useChat((state) => state.entries)
  const end = useRef<HTMLLIElement>(null)
  // Every render is a change to `entries`, the one thing this reads, so each one scrolls.
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' })
  })

  const View =
    TRANSCRIPT_VIEWS[entries.length === 0 ? TRANSCRIPT_STATES.empty : TRANSCRIPT_STATES.filled]
  return <View entries={entries} end={end} />
}
