import { DESKTOP_REPLIES, DESKTOP_REQUESTS, type DesktopReply } from '@raven/core'
import { Button, Icon } from '@raven/ui'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { handled } from '@/desktop/handled'
import { useOpenReply } from '@/desktop/openReply'
import { useModal } from '@/desktop/useModal'
import { useDesktop } from '@/stores/desktop'
import styles from '@/desktop/DesktopDialog.module.scss'

const UNOPENED = 'Raven could not open that link. Try again.'

const OUTCOME_KINDS = { open: 'open', stay: 'stay' } as const

/** What the dialog does with main's answer: leave and open it, or stay and say why not. */
type Outcome =
  | { kind: typeof OUTCOME_KINDS.open; reply: DesktopReply }
  | { kind: typeof OUTCOME_KINDS.stay; message: string }

const outcomeOf = (reply: DesktopReply): Outcome => {
  switch (reply.type) {
    case DESKTOP_REPLIES.play:
    case DESKTOP_REPLIES.navigate:
    // A download link leaves for the download dialog, which applying the reply opens.
    case DESKTOP_REPLIES.downloadAsk:
      return { kind: OUTCOME_KINDS.open, reply }
    case DESKTOP_REPLIES.refused:
      return { kind: OUTCOME_KINDS.stay, message: reply.message }
    case DESKTOP_REPLIES.done:
    case DESKTOP_REPLIES.file:
    case DESKTOP_REPLIES.recents:
    case DESKTOP_REPLIES.output:
    case DESKTOP_REPLIES.title:
    case DESKTOP_REPLIES.titleRefused:
    case DESKTOP_REPLIES.updates:
    case DESKTOP_REPLIES.downloads:
    case DESKTOP_REPLIES.space:
      return { kind: OUTCOME_KINDS.stay, message: UNOPENED }
    default: {
      const unreachable: never = reply
      return unreachable
    }
  }
}

/** File > Open Link: a pasted Raven link or watch page goes to main, which reads it. */
export const OpenLinkDialog = ({ onClose }: { onClose: () => void }) => {
  const { client } = useDesktop()
  const openReply = useOpenReply()
  const { dialog, close, keepKeys } = useModal()
  const field = useRef<HTMLInputElement>(null)
  // A reply that lands after the dialog closed is dropped, so it opens nothing.
  const isClosed = useRef(false)
  const isAsking = useRef(false)
  const ids = { title: useId(), hint: useId(), refusal: useId() }
  const [link, setLink] = useState('')
  const [refusal, setRefusal] = useState('')
  const [isPending, setIsPending] = useState(false)

  useEffect(() => {
    isClosed.current = false
    field.current?.focus()
    return () => {
      isClosed.current = true
    }
  }, [])

  const closed = () => {
    isClosed.current = true
    onClose()
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const pasted = link.trim()
    if (pasted === '' || isAsking.current) return
    isAsking.current = true
    setRefusal('')
    setIsPending(true)
    const reply = await client.request({ type: DESKTOP_REQUESTS.openLink, link: pasted })
    isAsking.current = false
    if (isClosed.current) return
    setIsPending(false)
    const outcome = outcomeOf(reply)
    switch (outcome.kind) {
      case OUTCOME_KINDS.open:
        openReply(outcome.reply)
        return close()
      case OUTCOME_KINDS.stay:
        setRefusal(outcome.message)
        // Back to the link, so the person can correct it.
        return field.current?.focus()
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
      <form className={styles.form} onSubmit={(event) => handled(submit(event))}>
        <h2 id={ids.title} className={styles.title}>
          Open a link
        </h2>
        <p id={ids.hint} className={styles.hint}>
          Paste a Raven link or the address of a title on raven.
        </p>
        <label className={styles.field}>
          Link
          <input
            ref={field}
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
          <p id={ids.refusal} role="alert" className={styles.error}>
            <Icon name="alert" size={16} />
            {refusal}
          </p>
        )}
        <div className={styles.actions}>
          <Button onClick={close}>Cancel</Button>
          {/* aria-disabled, not disabled: disabling the focused button would drop focus to the page. */}
          <Button type="submit" tone="primary" aria-disabled={isPending}>
            Open
          </Button>
        </div>
      </form>
    </dialog>
  )
}
