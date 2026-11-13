import { DESKTOP_REPLIES, DESKTOP_REQUESTS, type OpenReply, type RepliesFor } from '@raven/core'
import { BUTTON_TONES, Button, Icon } from '@raven/ui'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { askMain } from '@/desktop/client'
import { handled } from '@/lib/handled'
import { OPEN_LINK_COPY } from '@/desktop/OpenLinkDialog/copy'
import { useOpenReply } from '@/desktop/openReply'
import { useModal } from '@/lib/useModal'
import { useDesktop } from '@/stores/desktop'
import styles from '@/desktop/DesktopDialog.module.scss'
import { COMMON_COPY } from '@/lib/copy'
import { DialogFrame, DIALOG_WIDTHS } from '@/components/DialogFrame/DialogFrame'

const OUTCOME_KINDS = { open: 'open', stay: 'stay' } as const

/** What the dialog does with main's answer: leave and open it, or stay and say why not. */
type Outcome =
  | { kind: typeof OUTCOME_KINDS.open; reply: OpenReply }
  | { kind: typeof OUTCOME_KINDS.stay; message: string }

/** What main answers a pasted link with. */
type LinkReply = RepliesFor<typeof DESKTOP_REQUESTS.openLink>

const outcomeOf = (reply: LinkReply): Outcome => {
  switch (reply.type) {
    case DESKTOP_REPLIES.navigate:
    // A download link leaves for the download dialog, which applying the reply opens.
    case DESKTOP_REPLIES.downloadAsk:
      return { kind: OUTCOME_KINDS.open, reply }
    case DESKTOP_REPLIES.refused:
      return { kind: OUTCOME_KINDS.stay, message: reply.message }
    default: {
      const unreachable: never = reply
      return unreachable
    }
  }
}

type OpenLinkDialogProps = { onClose: () => void }

/** File > Open Link: a pasted Raven link or watch page goes to main, which reads it. */
export const OpenLinkDialog = ({ onClose }: OpenLinkDialogProps) => {
  const { client } = useDesktop()
  const openReply = useOpenReply()
  const { dialog, keepKeys, close } = useModal()
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
    const reply = await askMain({
      client,
      request: { type: DESKTOP_REQUESTS.openLink, link: pasted },
    })
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
    <DialogFrame
      dialog={dialog}
      onKeyDown={keepKeys}
      width={DIALOG_WIDTHS.question}
      labelledBy={ids.title}
      describedBy={ids.hint}
      onClose={closed}
    >
      <form className={styles.form} onSubmit={(event) => handled(submit(event))}>
        <h2 id={ids.title} className={styles.title}>
          {OPEN_LINK_COPY.title}
        </h2>
        <p id={ids.hint} className={styles.hint}>
          {OPEN_LINK_COPY.hint}
        </p>
        <label className={styles.field}>
          {OPEN_LINK_COPY.link}
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
          <Button onClick={close}>{COMMON_COPY.cancel}</Button>
          {/* aria-disabled, not disabled: disabling the focused button would drop focus to the page. */}
          <Button type="submit" tone={BUTTON_TONES.primary} aria-disabled={isPending}>
            {OPEN_LINK_COPY.open}
          </Button>
        </div>
      </form>
    </DialogFrame>
  )
}
