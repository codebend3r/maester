import { useState } from 'react'
import { BUTTON_TONES, Button, Icon } from '@raven/ui'
import { LOCKED_LIBRARY_COPY } from '@/components/LockedLibrary/copy'
import styles from '@/components/LockedLibrary/LockedLibrary.module.scss'
import { PinPadDialog } from '@/components/PinPadDialog/PinPadDialog'

type LockedLibraryProps = { name: string; available: boolean }

/**
 * Stands where a locked library's videos would be. The owner, on a raven with
 * a PIN set, gets an Unlock button, and only pressing it asks for the PIN;
 * anyone else is only told it is locked. Locking again shows it afresh, closed.
 */
export const LockedLibrary = ({ name, available }: LockedLibraryProps) => {
  const [isAsking, setAsking] = useState(false)
  return (
    <section className={styles.locked} aria-label={LOCKED_LIBRARY_COPY.locked}>
      <span className={styles.icon}>
        <Icon name="lock" size={28} />
      </span>
      <p className={styles.message}>{LOCKED_LIBRARY_COPY.isLocked(name)}</p>
      {available && (
        <Button tone={BUTTON_TONES.primary} icon="unlock" onClick={() => setAsking(true)}>
          {LOCKED_LIBRARY_COPY.unlock}
        </Button>
      )}
      {isAsking && <PinPadDialog onClose={() => setAsking(false)} />}
    </section>
  )
}
