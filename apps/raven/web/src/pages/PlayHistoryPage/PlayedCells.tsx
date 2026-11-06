import { Link } from 'react-router-dom'
import { PLAY_HISTORY_COPY } from '@/pages/PlayHistoryPage/copy'
import type { PlayedPart } from '@/pages/PlayHistoryPage/playedLinks'
import styles from '@/pages/PlayHistoryPage/PlayHistoryPage.module.scss'

type PartProps = { part: PlayedPart }

/** A part of a row: a link to its page, or its text when it has none. */
export const PartLink = ({ part }: PartProps) => (
  <>
    {part.to === null && part.text}
    {part.to !== null && (
      <Link className={styles.link} to={part.to}>
        {part.text}
      </Link>
    )}
  </>
)

type PlayedFromProps = { groups: readonly (readonly PlayedPart[])[] }

/** What a row belongs to: its groups one after another, the parts of each listed. */
export const PlayedFrom = ({ groups }: PlayedFromProps) =>
  groups.map((group, groupIndex) => (
    <span key={group.map((part) => part.key).join(':')}>
      {groupIndex > 0 && PLAY_HISTORY_COPY.contextSeparator}
      {group.map((part, partIndex) => (
        <span key={part.key}>
          {partIndex > 0 && PLAY_HISTORY_COPY.listSeparator}
          <PartLink part={part} />
        </span>
      ))}
    </span>
  ))
