import type { AiMatch } from '@raven/core'
import { Icon } from '@raven/ui'
import { AI_MATCH_NOTE_COPY } from '@/components/AiMatchNote/copy'
import styles from '@/components/AiMatchNote/AiMatchNote.module.scss'

type AiMatchNoteProps = { aiMatch: AiMatch; id?: string }

/**
 * Says the AI lookup matched this movie or show, being sure, and why. Fix
 * match still points it elsewhere. `id` lets a dialog be described by it.
 */
export const AiMatchNote = ({ aiMatch, id }: AiMatchNoteProps) => (
  <p id={id} className={styles.note}>
    <Icon name="wand" size={16} />
    <span className={styles.text}>
      <strong>{AI_MATCH_NOTE_COPY.matchedByAi}</strong> {aiMatch.reason}
    </span>
  </p>
)
