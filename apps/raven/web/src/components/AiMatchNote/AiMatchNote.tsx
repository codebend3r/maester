import type { AiMatch } from '@raven/core'
import { Icon } from '@/components/Icon/Icon'
import styles from '@/components/AiMatchNote/AiMatchNote.module.scss'

/** Says the AI lookup matched this movie or show, being sure, and why. Fix match still points it elsewhere. */
export const AiMatchNote = ({ aiMatch }: { aiMatch: AiMatch }) => (
  <p className={styles.note}>
    <Icon name="wand" size={16} />
    <span>
      <strong>Matched by AI.</strong> {aiMatch.reason}
    </span>
  </p>
)
