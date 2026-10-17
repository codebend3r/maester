import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@raven/ui'
import { useDesktop } from '@/renderer/desktop/DesktopContext'
import styles from '@/renderer/Shell/OpenLinkDialog.module.scss'
import { useOpenReply } from '@/renderer/Shell/openReply'
import type { DesktopReply } from '@/shared/protocol'

const UNOPENED = 'raven player could not open that link. Try again.'

/** What the dialog does with main's answer: leave and play, leave quietly, or stay and say why. */
type Outcome =
  | { kind: 'play'; reply: DesktopReply }
  | { kind: 'close' }
  | { kind: 'stay'; message: string }

const outcomeOf = (reply: DesktopReply | null): Outcome => {
  if (reply === null) return { kind: 'stay', message: UNOPENED }
  switch (reply.type) {
    case 'play':
    case 'playServer':
      return { kind: 'play', reply }
    // The person said no to the trust prompt, so there is nothing to say.
    case 'done':
      return { kind: 'close' }
    case 'refused':
      return { kind: 'stay', message: reply.message }
    case 'file':
    case 'recents':
    case 'output':
    case 'servers':
    case 'serverReply':
    case 'serverUnreachable':
      return { kind: 'stay', message: UNOPENED }
    default: {
      const unreachable: never = reply
      return unreachable
    }
  }
}

/** File > Open Link: a pasted link goes to main, which reads it and asks before trusting a server. */
export const OpenLinkDialog = ({ onClose }: { onClose: () => void }) => {
  const { client } = useDesktop()
  const openReply = useOpenReply()
  const dialog = useRef<HTMLDialogElement>(null)
  const field = useRef<HTMLInputElement>(null)
  // A reply that lands after the dialog closed (Cancel during main's prompt) is dropped, so it plays nothing.
  const isClosed = useRef(false)
  const isAsking = useRef(false)
  const ids = { title: useId(), hint: useId(), refusal: useId() }
  const [link, setLink] = useState('')
  const [refusal, setRefusal] = useState('')
  const [isPending, setIsPending] = useState(false)

  useEffect(() => {
    isClosed.current = false
    if (dialog.current !== null && !dialog.current.open) dialog.current.showModal()
    if (field.current !== null) field.current.focus()
    return () => {
      isClosed.current = true
    }
  }, [])

  // Closing fires the dialog's close event, which tells the Shell to unmount it.
  const close = () => {
    if (dialog.current !== null) dialog.current.close()
  }

  const closed = () => {
    isClosed.current = true
    onClose()
  }

  // The player listens on the window: a key pressed here stays here. Escape closes the dialog
  // itself, so it never depends on the browser's cancel, which a cancelled keydown suppresses.
  const keepKeys = (event: KeyboardEvent) => {
    event.stopPropagation()
    if (event.key !== 'Escape') return
    event.preventDefault()
    close()
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const pasted = link.trim()
    if (pasted === '' || isAsking.current) return
    isAsking.current = true
    setRefusal('')
    setIsPending(true)
    const reply = await client.request({ type: 'openLink', link: pasted }).catch(() => null)
    isAsking.current = false
    if (isClosed.current) return
    setIsPending(false)
    const outcome = outcomeOf(reply)
    switch (outcome.kind) {
      case 'play':
        openReply(outcome.reply)
        return close()
      case 'close':
        return close()
      case 'stay':
        setRefusal(outcome.message)
        // Back to the link, so the person can correct it.
        if (field.current !== null) field.current.focus()
        return
      default: {
        const unreachable: never = outcome
        return unreachable
      }
    }
  }

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={ids.title}
      aria-describedby={ids.hint}
      onClose={closed}
      onKeyDown={keepKeys}
    >
      <form className={styles.form} onSubmit={(event) => void submit(event)}>
        <h2 id={ids.title} className={styles.title}>
          Open a link
        </h2>
        <p id={ids.hint} className={styles.hint}>
          Paste a raven player link or the address of a title on a raven server.
        </p>
        <label className={styles.field}>
          Link
          <input
            ref={field}
            className={styles.input}
            type="url"
            required
            autoComplete="off"
            spellCheck={false}
            value={link}
            aria-invalid={refusal !== ''}
            aria-describedby={refusal === '' ? undefined : ids.refusal}
            onChange={(event) => setLink(event.target.value)}
          />
        </label>
        {refusal !== '' && (
          <p id={ids.refusal} role="alert" className={styles.refusal}>
            {refusal}
          </p>
        )}
        <div className={styles.actions}>
          <Button onClick={close}>Cancel</Button>
          {/* aria-disabled, not disabled: disabling the focused button would drop focus to the page. */}
          <Button className={styles.submit} type="submit" tone="primary" aria-disabled={isPending}>
            Open
          </Button>
        </div>
      </form>
    </dialog>
  )
}
