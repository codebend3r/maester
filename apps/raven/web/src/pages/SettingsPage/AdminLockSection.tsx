import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ADMIN_LOCK_STATES, type AdminLock, plural } from '@raven/core'
import { type ComponentType, type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@raven/ui'
import { queryKeys, KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import { Loading } from '@/components/Skeleton/Skeleton'
import { api } from '@/lib/api'
import { adminLockQuery } from '@/lib/queries'
import { SettingsSkeleton } from '@/pages/SettingsPage/Setting'
import { Titled } from '@/pages/SettingsPage/Titled'
import { SETTINGS_COPY } from '@/pages/SettingsPage/copy'
import styles from '@/pages/SettingsPage/SettingsPage.module.scss'
import { COMMON_COPY } from '@/lib/copy'

type CountdownProps = { deadline: number }

/** Whole seconds until `deadline`, counted down as they pass. */
const Countdown = ({ deadline }: CountdownProps) => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1_000))
  return plural({
    n: seconds,
    one: SETTINGS_COPY.adminLock.second,
    many: SETTINGS_COPY.adminLock.seconds,
  })
}

const LOCKED_HINT_KEYS = { available: 'available', unavailable: 'unavailable' } as const
type LockedHintKey = (typeof LOCKED_HINT_KEYS)[keyof typeof LOCKED_HINT_KEYS]

const AvailableHint = () => SETTINGS_COPY.adminLock.onHint

const UnavailableHint = () => (
  <>
    {SETTINGS_COPY.adminLock.unavailableSet}{' '}
    <code>{SETTINGS_COPY.adminLock.unavailableEnvVar}</code> {SETTINGS_COPY.adminLock.unavailableIn}{' '}
    <code>{COMMON_COPY.envFile}</code> {SETTINGS_COPY.adminLock.unavailableTurnOff}
  </>
)

const LOCKED_HINTS = {
  [LOCKED_HINT_KEYS.available]: AvailableHint,
  [LOCKED_HINT_KEYS.unavailable]: UnavailableHint,
} as const satisfies Record<LockedHintKey, ComponentType>

type LockedHintProps = { isAvailable: boolean }

/** The lock is on: turning it off asks for the password, or needs one set first. */
const LockedHint = ({ isAvailable }: LockedHintProps) => {
  const Hint = LOCKED_HINTS[isAvailable ? LOCKED_HINT_KEYS.available : LOCKED_HINT_KEYS.unavailable]
  return <Hint />
}

type TurningOnHintProps = { deadline: number }

const TurningOnHint = ({ deadline }: TurningOnHintProps) => (
  <>
    {SETTINGS_COPY.adminLock.turnsOnIn} <Countdown deadline={deadline} />
    {SETTINGS_COPY.adminLock.turnsOnUntil}
  </>
)

const OffHint = () => SETTINGS_COPY.adminLock.offHint

type LockHintViewProps = {
  [ADMIN_LOCK_STATES.on]: LockedHintProps
  [ADMIN_LOCK_STATES.turningOn]: TurningOnHintProps
  [ADMIN_LOCK_STATES.off]: Record<never, never>
}

const LOCK_HINTS = {
  [ADMIN_LOCK_STATES.on]: LockedHint,
  [ADMIN_LOCK_STATES.turningOn]: TurningOnHint,
  [ADMIN_LOCK_STATES.off]: OffHint,
} as const satisfies ViewsOf<LockHintViewProps>

type AdminLockHintProps = { lock: AdminLock; readAt: number }

/** Which hint the lock's state takes, with what it needs; `readAt` is when the lock was read, its countdown's start. */
type LockHintViewOfProps = AdminLockHintProps

const lockHintViewOf = ({ lock, readAt }: LockHintViewOfProps): ViewOf<LockHintViewProps> => {
  switch (lock.state) {
    case ADMIN_LOCK_STATES.on:
      return { key: lock.state, props: { isAvailable: lock.available } }
    case ADMIN_LOCK_STATES.turningOn:
      return { key: lock.state, props: { deadline: readAt + lock.remainingMs } }
    case ADMIN_LOCK_STATES.off:
      return { key: lock.state, props: {} }
    default: {
      const unknown: never = lock
      return unknown
    }
  }
}

type ToggleProps = { from: AdminLock; checked: boolean }

/**
 * The admin lock, at the foot of the page. It holds in every browser until
 * the admin password is entered there. Turned back on, it waits a moment
 * before it holds, and unticked again in that moment it needs no password,
 * so a slip of the finger costs nothing.
 */
export const AdminLockSection = () => {
  const headingId = useId()
  const passwordId = useId()
  const queryClient = useQueryClient()
  const lock = useQuery(adminLockQuery)
  const current = lock.data
  const [isAsking, setAsking] = useState(false)
  const [password, setPassword] = useState('')
  const passwordInput = useRef<HTMLInputElement>(null)
  const settle = (next: AdminLock) => queryClient.setQueryData(queryKeys.adminLock, next)
  const unlock = useMutation({
    mutationFn: (entered: string) => api.unlockAdmin(entered),
    onSuccess: (next) => {
      settle(next)
      setAsking(false)
    },
    onSettled: () => setPassword(''),
  })
  const turnOn = useMutation({ mutationFn: () => api.lockAdmin(), onSuccess: settle })
  const keepOff = useMutation({
    mutationFn: () => api.keepAdminUnlocked(),
    onSuccess: settle,
    // Too late, it holds already: read again, it asks for the password.
    onError: () => queryClient.invalidateQueries({ queryKey: queryKeys.adminLock }),
  })
  const busy = unlock.isPending || turnOn.isPending || keepOff.isPending
  const failure = turnOn.error ?? keepOff.error
  const isAskingNow = isAsking && current?.state === ADMIN_LOCK_STATES.on

  useEffect(() => {
    if (isAskingNow) passwordInput.current?.focus()
  }, [isAskingNow])

  const toggle = ({ from, checked }: ToggleProps): void => {
    switch (from.state) {
      case ADMIN_LOCK_STATES.on:
        unlock.reset()
        setAsking(!checked)
        return
      case ADMIN_LOCK_STATES.turningOn:
        if (!checked) keepOff.mutate()
        return
      case ADMIN_LOCK_STATES.off:
        if (checked) turnOn.mutate()
        return
      default: {
        const unknown: never = from
        return unknown
      }
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    unlock.mutate(password)
  }

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <header className={styles.sectionHead}>
        <h2 id={headingId} className={styles.heading}>
          <Titled icon="lock">{SETTINGS_COPY.adminLock.heading}</Titled>
        </h2>
        <p className={styles.help}>{SETTINGS_COPY.adminLock.help}</p>
      </header>
      {lock.isError && (
        <p className={styles.error} role="alert">
          {lock.error.message}
        </p>
      )}
      {failure && (
        <p className={styles.error} role="alert">
          {failure.message}
        </p>
      )}
      {lock.isPending && (
        <Loading label={SETTINGS_COPY.adminLock.reading}>
          <SettingsSkeleton count={1} />
        </Loading>
      )}
      {current && (
        <label className={styles.lock}>
          <input
            type="checkbox"
            className={styles.switch}
            checked={current.state !== ADMIN_LOCK_STATES.off && !isAskingNow}
            disabled={busy || (current.state === ADMIN_LOCK_STATES.on && !current.available)}
            onChange={(event) => toggle({ from: current, checked: event.target.checked })}
          />
          <span className={styles.choiceLabel}>{SETTINGS_COPY.adminLock.label}</span>
          <span className={styles.choiceHint}>
            <KeyedView<LockHintViewProps>
              views={LOCK_HINTS}
              view={lockHintViewOf({ lock: current, readAt: lock.dataUpdatedAt })}
            />
          </span>
        </label>
      )}
      {isAskingNow && (
        <form className={styles.password} onSubmit={submit}>
          <label htmlFor={passwordId} className={styles.passwordLabel}>
            {SETTINGS_COPY.adminLock.password}
          </label>
          <input
            ref={passwordInput}
            id={passwordId}
            className={styles.passwordInput}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {unlock.isError && (
            <p role="alert" className={styles.error}>
              {unlock.error.message}
            </p>
          )}
          <div className={styles.actions}>
            <Button onClick={() => setAsking(false)}>{COMMON_COPY.cancel}</Button>
            <Button
              type="submit"
              tone="primary"
              icon="unlock"
              disabled={password === '' || unlock.isPending}
            >
              {SETTINGS_COPY.adminLock.turnOff}
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
