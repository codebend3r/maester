import { type ComponentType, type RefObject, createElement, useEffect, useRef } from 'react'
import { NoticeList } from '@/components/NoticeList/NoticeList'
import { ReplyCard } from '@/components/ReplyCard/ReplyCard'
import { SPARROW_SIZES, SparrowMark } from '@/components/SparrowMark/SparrowMark'
import { DECISION_COPY, TRANSCRIPT_COPY } from '@/components/Transcript/copy'
import styles from '@/components/Transcript/Transcript.module.scss'
import type { Tier } from '@/lib/api'
import { ENTRY_KINDS, type Entry, type EntryKind } from '@/lib/entries'
import { noticesOf, toReply } from '@/lib/reply'
import { useChat } from '@/stores/chat'

type EntryOf<K extends EntryKind> = Extract<Entry, { kind: K }>

type EntryViewProps<K extends EntryKind> = { entry: EntryOf<K> }

type EntryViews = { [K in EntryKind]: ComponentType<EntryViewProps<K>> }

type SaidViewProps = EntryViewProps<typeof ENTRY_KINDS.said>

const SaidView = ({ entry }: SaidViewProps) => <p className={styles.said}>{entry.text}</p>

type ReplyViewProps = EntryViewProps<typeof ENTRY_KINDS.reply>

const ReplyView = ({ entry }: ReplyViewProps) => <ReplyCard reply={toReply({ entry })} />

type DecisionViewProps = EntryViewProps<typeof ENTRY_KINDS.decision>

const DecisionView = ({ entry }: DecisionViewProps) => {
  const notices = noticesOf(entry.events)
  return (
    <section className={styles.decision} aria-label={DECISION_COPY.label}>
      <p>{entry.text}</p>
      {notices.length > 0 && <NoticeList notices={notices} />}
    </section>
  )
}

const ENTRY_VIEWS = {
  [ENTRY_KINDS.said]: SaidView,
  [ENTRY_KINDS.reply]: ReplyView,
  [ENTRY_KINDS.decision]: DecisionView,
} as const satisfies EntryViews

// Read through the mapped type, so a kind's view is looked up with that kind's entry.
const entryViews: EntryViews = ENTRY_VIEWS

type EntryViewOfProps<K extends EntryKind> = { kind: K; entry: EntryOf<K> }

/** The view for an entry's kind, handed that entry; `createElement`, since JSX can't check it. */
const EntryView = <K extends EntryKind>({ kind, entry }: EntryViewOfProps<K>) =>
  createElement(entryViews[kind], { entry })

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
  return (
    <li className={styles.row}>
      <Avatar tier={tier} />
      <div className={styles.body}>
        <EntryView kind={entry.kind} entry={entry} />
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
    if (end.current) end.current.scrollIntoView({ block: 'end' })
  })

  const View =
    TRANSCRIPT_VIEWS[entries.length === 0 ? TRANSCRIPT_STATES.empty : TRANSCRIPT_STATES.filled]
  return <View entries={entries} tier={tier} end={end} />
}
