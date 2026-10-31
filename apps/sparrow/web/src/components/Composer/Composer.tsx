import { type FormEvent, type KeyboardEvent, useState } from 'react'
import { Button, BUTTON_TONES } from '@/components/Button/Button'
import { COMPOSER_COPY } from '@/components/Composer/copy'
import styles from '@/components/Composer/Composer.module.scss'
import { useChat } from '@/stores/chat'

const KEYS = { enter: 'Enter' } as const

/** Where you write to sparrow: Enter sends, Shift+Enter starts a new line. */
export const Composer = () => {
  const [text, setText] = useState('')
  const send = useChat((state) => state.send)
  const isBusy = useChat((state) => state.isBusy)
  const message = text.trim()
  const canSend = !isBusy && message !== ''

  const submit = () => {
    if (!canSend) return
    setText('')
    void send({ text: message })
  }
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    submit()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== KEYS.enter || event.shiftKey) return
    event.preventDefault()
    submit()
  }

  return (
    <form className={styles.composer} onSubmit={onSubmit}>
      <label className={styles.label} htmlFor="composer-message">
        {COMPOSER_COPY.label}
      </label>
      <textarea
        id="composer-message"
        className={styles.input}
        rows={2}
        value={text}
        placeholder={COMPOSER_COPY.placeholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <Button type="submit" tone={BUTTON_TONES.primary} className={styles.send} disabled={!canSend}>
        {COMPOSER_COPY.send}
      </Button>
    </form>
  )
}
