import { type FormEvent, type KeyboardEvent, useRef, useState } from 'react'
import { Button, BUTTON_TONES } from '@/components/Button/Button'
import { COMPOSER_COPY } from '@/components/Composer/copy'
import styles from '@/components/Composer/Composer.module.scss'
import { UsageMeter } from '@/components/UsageMeter/UsageMeter'
import { useChat } from '@/stores/chat'

const KEYS = { enter: 'Enter' } as const

/** Grows the field with what is typed, up to the stylesheet's max-block-size, then it scrolls. */
const fit = (field: HTMLTextAreaElement) => {
  field.style.blockSize = 'auto'
  field.style.blockSize = `${field.scrollHeight}px`
}

/** Where you write to sparrow: Enter sends, Shift+Enter starts a new line. */
export const Composer = () => {
  const [text, setText] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const send = useChat((state) => state.send)
  const isBusy = useChat((state) => state.isBusy)
  const message = text.trim()
  const canSend = !isBusy && message !== ''

  const submit = () => {
    if (!canSend) return
    setText('')
    // Back to one row: the cleared value only reaches the field on the next render.
    if (input.current) input.current.style.blockSize = ''
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
      <div className={styles.box}>
        <label className="visually-hidden" htmlFor="composer-message">
          {COMPOSER_COPY.label}
        </label>
        <textarea
          ref={input}
          id="composer-message"
          className={styles.input}
          rows={1}
          value={text}
          placeholder={COMPOSER_COPY.placeholder}
          onChange={(event) => {
            setText(event.target.value)
            fit(event.target)
          }}
          onKeyDown={onKeyDown}
        />
        <Button
          type="submit"
          tone={BUTTON_TONES.primary}
          className={styles.send}
          disabled={!canSend}
        >
          {COMPOSER_COPY.send}
        </Button>
      </div>
      <div className={styles.footer}>
        <p className={styles.hint}>{COMPOSER_COPY.hint}</p>
        <div className={styles.meter}>
          <UsageMeter />
        </div>
      </div>
    </form>
  )
}
