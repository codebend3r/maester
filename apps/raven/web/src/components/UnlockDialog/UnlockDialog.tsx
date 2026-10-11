import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/Button/Button'
import { api } from '@/lib/api'
import { useUnlockPrompt } from '@/stores/unlockPrompt'
import styles from '@/components/UnlockDialog/UnlockDialog.module.scss'

/** The open dialog: the PIN opens every locked library in this browser, and every page reads again. */
const PinForm = () => {
  const dialog = useRef<HTMLDialogElement>(null)
  const ids = { title: useId(), pin: useId() }
  const close = useUnlockPrompt((state) => state.close)
  const queryClient = useQueryClient()
  const [pin, setPin] = useState('')
  const unlock = useMutation({
    mutationFn: (entered: string) => api.unlock(entered),
    onSuccess: () => {
      dialog.current?.close()
      return queryClient.invalidateQueries()
    },
    onError: () => setPin(''),
  })

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    unlock.mutate(pin)
  }

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={ids.title} onClose={close}>
      <form className={styles.form} onSubmit={submit}>
        <h2 id={ids.title} className={styles.title}>
          Locked library
        </h2>
        <p className={styles.hint}>Enter the PIN to open the locked libraries in this browser.</p>
        <div className={styles.field}>
          <label htmlFor={ids.pin}>PIN</label>
          <input
            id={ids.pin}
            className={styles.input}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(event) => setPin(event.target.value)}
          />
        </div>
        {unlock.isError && (
          <p role="alert" className={styles.error}>
            {unlock.error.message}
          </p>
        )}
        <div className={styles.actions}>
          <Button onClick={() => dialog.current?.close()}>Cancel</Button>
          <Button
            type="submit"
            tone="primary"
            icon="unlock"
            disabled={pin.trim() === '' || unlock.isPending}
          >
            Unlock
          </Button>
        </div>
      </form>
    </dialog>
  )
}

/** Asks for the PIN whenever something sits in a locked library, over whatever page asked. */
export const UnlockDialog = () => {
  const open = useUnlockPrompt((state) => state.open)
  return open && <PinForm />
}
