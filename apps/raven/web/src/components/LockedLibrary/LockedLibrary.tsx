import { useState } from 'react'
import { BUTTON_TONES, Button, Icon } from '@raven/ui'
import { LOCKED_LIBRARY_COPY } from '@/components/LockedLibrary/copy'
import styles from '@/components/LockedLibrary/LockedLibrary.module.scss'
import { PinPadDialog } from '@/components/PinPadDialog/PinPadDialog'
import { useIsAway } from '@/lib/servers'

type LockedLibraryProps = { name: string; available: boolean }

/**
 * Stands where a locked library's videos would be. The owner, on a raven with
 * a PIN set, gets an Unlock button, and only pressing it asks for the PIN;
 * anyone else is only told it is locked. Locking again shows it afresh, closed. On another
 * server than the home one the PIN cannot hold, so the owner is told where to unlock instead.
 */
export const LockedLibrary = ({ name, available }: LockedLibraryProps) => {
  const [isAsking, setAsking] = useState(false)
  /*
   * The unlock is a cookie of the server's own origin, which a page talking to another server
   * neither sends nor keeps, so there the owner is pointed to that server's own page.
   */
  const isAway = useIsAway()
  return (
    <section className={styles.locked} aria-label={LOCKED_LIBRARY_COPY.locked}>
      <span className={styles.icon}>
        <Icon name="lock" size={28} />
      </span>
      <p className={styles.message}>{LOCKED_LIBRARY_COPY.isLocked(name)}</p>
      {available && !isAway && (
        <Button tone={BUTTON_TONES.primary} icon="unlock" onClick={() => setAsking(true)}>
          {LOCKED_LIBRARY_COPY.unlock}
        </Button>
      )}
      {available && isAway && <p className={styles.hint}>{LOCKED_LIBRARY_COPY.unlockAtHome}</p>}
      {isAsking && <PinPadDialog onClose={() => setAsking(false)} />}
    </section>
  )
}
