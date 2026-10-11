import { Button } from '@/components/Button/Button'
import { Icon } from '@/components/Icon/Icon'
import { useUnlockPrompt } from '@/stores/unlockPrompt'
import styles from '@/components/LockedLibrary/LockedLibrary.module.scss'

/** Stands where a locked library's videos would be, until the PIN is entered. */
export const LockedLibrary = ({ name, available }: { name: string; available: boolean }) => {
  const ask = useUnlockPrompt((state) => state.ask)
  return (
    <section className={styles.locked} aria-label="Locked">
      <span className={styles.icon}>
        <Icon name="lock" size={28} />
      </span>
      <p className={styles.message}>{name} is locked.</p>
      {available ? (
        <Button tone="primary" icon="unlock" onClick={ask}>
          Unlock
        </Button>
      ) : (
        <p className={styles.hint}>
          Set <code>LIBRARY_PIN</code> in raven's <code>.env</code> to open it.
        </p>
      )}
    </section>
  )
}
