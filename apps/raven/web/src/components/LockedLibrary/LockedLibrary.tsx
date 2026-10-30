import type { ComponentType } from 'react'
import { Button, Icon } from '@raven/ui'
import { useUnlockPrompt } from '@raven/ui/headless'
import { LOCKED_LIBRARY_COPY } from '@/components/LockedLibrary/copy'
import styles from '@/components/LockedLibrary/LockedLibrary.module.scss'
import { COMMON_COPY } from '@/lib/copy'

/** Whether this raven has a PIN to unlock with. */
const PIN_STATES = { available: 'available', unset: 'unset' } as const

type PinState = (typeof PIN_STATES)[keyof typeof PIN_STATES]

const UnlockButton = () => {
  const ask = useUnlockPrompt((state) => state.ask)
  return (
    <Button tone="primary" icon="unlock" onClick={ask}>
      {LOCKED_LIBRARY_COPY.unlock}
    </Button>
  )
}

const PinHint = () => (
  <p className={styles.hint}>
    {LOCKED_LIBRARY_COPY.setPinBefore}
    <code>{LOCKED_LIBRARY_COPY.pinVariable}</code>
    {LOCKED_LIBRARY_COPY.setPinBetween}
    <code>{COMMON_COPY.envFile}</code>
    {LOCKED_LIBRARY_COPY.setPinAfter}
  </p>
)

const PIN_VIEWS = {
  [PIN_STATES.available]: UnlockButton,
  [PIN_STATES.unset]: PinHint,
} as const satisfies Record<PinState, ComponentType>

type LockedLibraryProps = { name: string; available: boolean }

/** Stands where a locked library's videos would be, until the PIN is entered. */
export const LockedLibrary = ({ name, available }: LockedLibraryProps) => {
  const PinView = PIN_VIEWS[available ? PIN_STATES.available : PIN_STATES.unset]
  return (
    <section className={styles.locked} aria-label={LOCKED_LIBRARY_COPY.locked}>
      <span className={styles.icon}>
        <Icon name="lock" size={28} />
      </span>
      <p className={styles.message}>{LOCKED_LIBRARY_COPY.isLocked(name)}</p>
      <PinView />
    </section>
  )
}
