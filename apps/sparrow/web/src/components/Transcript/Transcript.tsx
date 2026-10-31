import { type ComponentType, type RefObject, useEffect, useRef } from 'react'
import { NoticeList } from '@/components/NoticeList/NoticeList'
import { ReplyCard } from '@/components/ReplyCard/ReplyCard'
import { SPARROW_SIZES, SparrowMark } from '@/components/SparrowMark/SparrowMark'
import { DECISION_COPY, TRANSCRIPT_COPY } from '@/components/Transcript/copy'
import styles from '@/components/Transcript/Transcript.module.scss'
import type { Tier } from '@/lib/api'
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

type AvatarProps = { tier: Tier }

type UserAvatarProps = AvatarProps

/** The user, as the first letter of their tier. */
const UserAvatar = ({ tier }: UserAvatarProps) => (
  <span className={styles.userAvatar}>
    <span aria-hidden="true">{tier.charAt(0).toUpperCase()}</span>
    <span className="visually-hidden">{TRANSCRIPT_COPY.you}</span>
  </span>
)

const SparrowAvatar = () => (
  <span className={styles.sparrowAvatar}>
    <SparrowMark size={SPARROW_SIZES.sm} />
    <span className="visually-hidden">{TRANSCRIPT_COPY.sparrow}</span>
  </span>
)

const ENTRY_AVATARS = {
  [ENTRY_KINDS.said]: UserAvatar,
  [ENTRY_KINDS.reply]: SparrowAvatar,
  [ENTRY_KINDS.decision]: SparrowAvatar,
} as const satisfies Record<EntryKind, ComponentType<AvatarProps>>

type EntryRowProps = { entry: Entry; tier: Tier }

/** One message: who sent it, then what it says. */
const EntryRow = ({ entry, tier }: EntryRowProps) => {
  const Avatar = ENTRY_AVATARS[entry.kind]
  const View = ENTRY_VIEWS[entry.kind]
  return (
    <li className={styles.row}>
      <Avatar tier={tier} />
      <div className={styles.body}>
        <View entry={entry} />
      </div>
    </li>
  )
}

const TRANSCRIPT_STATES = { empty: 'empty', filled: 'filled' } as const

type TranscriptState = (typeof TRANSCRIPT_STATES)[keyof typeof TRANSCRIPT_STATES]

type TranscriptViewProps = {
  entries: Entry[]
  tier: Tier
  end: RefObject<HTMLLIElement | null>
}

const EmptyTranscript = () => (
  <section className={styles.empty}>
    <span className={styles.emptyMark}>
      <SparrowMark size={SPARROW_SIZES.lg} />
    </span>
    <h2 className={styles.emptyHeading}>{TRANSCRIPT_COPY.emptyHeading}</h2>
    <p className={styles.emptyLine}>{TRANSCRIPT_COPY.emptyLine}</p>
  </section>
)

type FilledTranscriptProps = TranscriptViewProps

const FilledTranscript = ({ entries, tier, end }: FilledTranscriptProps) => (
  <ol className={styles.transcript} aria-label={TRANSCRIPT_COPY.label}>
    {entries.map((entry) => (
      <EntryRow key={entry.id} entry={entry} tier={tier} />
    ))}
    <li ref={end} aria-hidden="true" />
  </ol>
)

const TRANSCRIPT_VIEWS = {
  [TRANSCRIPT_STATES.empty]: EmptyTranscript,
  [TRANSCRIPT_STATES.filled]: FilledTranscript,
} as const satisfies Record<TranscriptState, ComponentType<TranscriptViewProps>>

type TranscriptProps = { tier: Tier }

/** The conversation so far, newest at the bottom and kept in view. */
export const Transcript = ({ tier }: TranscriptProps) => {
  const entries = useChat((state) => state.entries)
  const end = useRef<HTMLLIElement>(null)
  // Every render is a change to `entries`, the one thing this reads, so each one scrolls.
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' })
  })

  const View =
    TRANSCRIPT_VIEWS[entries.length === 0 ? TRANSCRIPT_STATES.empty : TRANSCRIPT_STATES.filled]
  return <View entries={entries} tier={tier} end={end} />
}
