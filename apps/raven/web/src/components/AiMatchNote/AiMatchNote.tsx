import type { AiMatch } from '@raven/core'
import { Icon } from '@/components/Icon/Icon'
import styles from '@/components/AiMatchNote/AiMatchNote.module.scss'

/**
 * Says the AI lookup matched this movie or show, being sure, and why. Fix
 * match still points it elsewhere. `id` lets a dialog be described by it.
 */
export const AiMatchNote = ({ aiMatch, id }: { aiMatch: AiMatch; id?: string }) => (
  <p id={id} className={styles.note}>
    <Icon name="wand" size={16} />
    <span className={styles.text}>
      <strong>Matched by AI.</strong> {aiMatch.reason}
    </span>
  </p>
)
