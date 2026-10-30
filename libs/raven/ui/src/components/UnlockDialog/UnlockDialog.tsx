import { useMutation } from '@tanstack/react-query'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/Button/Button'
import { Icon } from '@/components/Icon/Icon'
import { UNLOCK_DIALOG_COPY } from '@/components/UnlockDialog/copy'
import styles from '@/components/UnlockDialog/UnlockDialog.module.scss'

export const UNLOCK_SECRETS = { pin: 'pin', adminPassword: 'adminPassword' } as const

export type UnlockSecret = (typeof UNLOCK_SECRETS)[keyof typeof UNLOCK_SECRETS]

/** The words and field for each secret a server can ask for; the hints are the web's own. */
const SECRETS = {
  pin: {
    title: 'Locked library',
    label: 'PIN',
    inputMode: 'numeric',
    hint: 'Enter the PIN to open the locked libraries in this browser.',
  },
  adminPassword: {
    title: 'Admin lock',
    label: 'Admin password',
    inputMode: undefined,
    hint: 'Enter the admin password to see the locked libraries in this browser.',
  },
} as const satisfies Record<UnlockSecret, unknown>

type UnlockDialogProps = {
  /** Shown from mount only: a host asking for another secret keys the dialog by it, so it opens afresh. */
  secret: UnlockSecret
  /** Under the title. Left out: the web's own words for the secret. */
  hint?: string
  /** Rejects with the server's reason, which the dialog shows. */
  unlock: (entered: string) => Promise<unknown>
  /** The dialog closes itself just after; the host closes its prompt here. */
  onUnlocked: () => void | Promise<unknown>
  /** Dismissed without unlocking: Cancel or Escape. */
  onClose: () => void
}

/** Asks for a secret over whatever page asked; the host unlocks, and says what reads again. */
export const UnlockDialog = ({ secret, hint, unlock, onUnlocked, onClose }: UnlockDialogProps) => {
  const words = SECRETS[secret]
  const dialog = useRef<HTMLDialogElement>(null)
  const isUnlocked = useRef(false)
  const ids = { title: useId(), field: useId() }
  const [entered, setEntered] = useState('')
  const attempt = useMutation({
    mutationFn: (value: string) => unlock(value),
    // The dialog leaves at once; the mutation stays pending while the host's pages read again.
    onSuccess: () => {
      isUnlocked.current = true
      const unlocked = onUnlocked()
      dialog.current?.close()
      return unlocked
    },
    onError: () => setEntered(''),
  })

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  // The close event also follows an unlock, queued as a task in Chromium, so only a dismissal is reported.
  const closed = () => {
    if (isUnlocked.current) return
    onClose()
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    attempt.mutate(entered)
  }

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={ids.title} onClose={closed}>
      <form className={styles.form} onSubmit={submit}>
        <h2 id={ids.title} className={styles.title}>
          {words.title}
        </h2>
        <p className={styles.hint}>{hint ?? words.hint}</p>
        <div className={styles.field}>
          <label htmlFor={ids.field}>{words.label}</label>
          <input
            id={ids.field}
            className={styles.input}
            type="password"
            inputMode={words.inputMode}
            autoComplete="off"
            value={entered}
            onChange={(event) => setEntered(event.target.value)}
          />
        </div>
        {attempt.isError && (
          <p role="alert" className={styles.error}>
            <Icon name="alert" size={16} />
            {attempt.error.message}
          </p>
        )}
        <div className={styles.actions}>
          <Button onClick={() => dialog.current?.close()}>{UNLOCK_DIALOG_COPY.cancel}</Button>
          <Button
            type="submit"
            tone="primary"
            icon="unlock"
            disabled={entered.trim() === '' || attempt.isPending}
          >
            {UNLOCK_DIALOG_COPY.unlock}
          </Button>
        </div>
      </form>
    </dialog>
  )
}
