import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ADMIN_LOCK_STATES, type AdminLock, plural } from '@raven/core'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@raven/ui'
import { queryKeys } from '@raven/ui/headless'
import { Loading } from '@/components/Skeleton/Skeleton'
import { api } from '@/lib/api'
import { adminLockQuery } from '@/lib/queries'
import { SettingsSkeleton } from '@/pages/SettingsPage/Setting'
import { Titled } from '@/pages/SettingsPage/Titled'
import styles from '@/pages/SettingsPage/SettingsPage.module.scss'

type CountdownProps = { deadline: number }

/** Whole seconds until `deadline`, counted down as they pass. */
const Countdown = ({ deadline }: CountdownProps) => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1_000))
  return plural({ n: seconds, one: 'second', many: 'seconds' })
}

type AdminLockHintProps = { lock: AdminLock; readAt: number }

/** What the admin lock's toggle says under it; `readAt` is when the lock was read, its countdown's start. */
const AdminLockHint = ({ lock, readAt }: AdminLockHintProps) => {
  switch (lock.state) {
    case ADMIN_LOCK_STATES.on:
      return lock.available ? (
        'Turning it off asks for the admin password.'
      ) : (
        <>
          Set <code>ADMIN_PASSWORD</code> in raven's <code>.env</code> to turn it off.
        </>
      )
    case ADMIN_LOCK_STATES.turningOn:
      return (
        <>
          Turns on in <Countdown deadline={readAt + lock.remainingMs} />. Until then, turning it off
          needs no password.
        </>
      )
    case ADMIN_LOCK_STATES.off:
      return 'Off in this browser until it is turned back on, through refreshes, restarts and redeploys. Turned on, it waits a moment first, so a slip costs no password.'
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
          <Titled icon="lock">Admin</Titled>
        </h2>
        <p className={styles.help}>
          On in every browser until the admin password is entered there. While it is on, raven can
          be watched but not managed: no library is added, edited, scanned or matched, no match,
          metadata or image is changed, the settings above stay as they are, and no video is deleted
          or has its file's path shown. Locked libraries are hidden altogether, so nothing asks for
          their PIN.
        </p>
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
        <Loading label="Reading the admin lock">
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
          <span className={styles.choiceLabel}>Admin lock</span>
          <span className={styles.choiceHint}>
            <AdminLockHint lock={current} readAt={lock.dataUpdatedAt} />
          </span>
        </label>
      )}
      {isAskingNow && (
        <form className={styles.password} onSubmit={submit}>
          <label htmlFor={passwordId} className={styles.passwordLabel}>
            Admin password
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
            <Button onClick={() => setAsking(false)}>Cancel</Button>
            <Button
              type="submit"
              tone="primary"
              icon="unlock"
              disabled={password === '' || unlock.isPending}
            >
              Turn off
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
