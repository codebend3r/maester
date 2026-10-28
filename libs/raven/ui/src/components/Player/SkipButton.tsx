import { Button } from '@/components/Button/Button'
import styles from '@/components/Player/SkipButton.module.scss'

type SkipButtonProps = {
  /** What it says: Skip intro, Skip credits, Undo. */
  label: string
  onClick: () => void
}

/** The one skip control, above the bar at the right: Skip intro, Undo after one skipped by itself, and Skip credits. */
export const SkipButton = ({ label, onClick }: SkipButtonProps) => (
  <Button tone="ghost" icon="skipNext" className={styles.skip} onClick={onClick}>
    {label}
  </Button>
)
