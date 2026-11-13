import { useMutation, useQueryClient } from '@tanstack/react-query'
import { KEYS } from '@raven/core'
import { type KeyboardEvent, useId, useState } from 'react'
import { Button, Icon } from '@raven/ui'
import { queryKeys } from '@raven/ui/headless'
import { PIN_PAD_COPY } from '@/components/PinPadDialog/copy'
import styles from '@/components/PinPadDialog/PinPadDialog.module.scss'
import { api } from '@/lib/api'
import { COMMON_COPY } from '@/lib/copy'
import { useModal } from '@/lib/useModal'
import { DialogFrame, DIALOG_WIDTHS } from '@/components/DialogFrame/DialogFrame'

/** The pad's three rows of digits; zero sits under them, between Backspace and Unlock. */
const PAD_ROW_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const
const PAD_ZERO = '0'

type PadDigit = (typeof PAD_ROW_DIGITS)[number] | typeof PAD_ZERO

const isPadDigit = (key: string): key is PadDigit =>
  key === PAD_ZERO || PAD_ROW_DIGITS.some((digit) => digit === key)

/** Longer than any PIN worth typing on a pad, so a held key cannot run on. */
const PIN_MAX_DIGITS = 12

type DigitKeyProps = { digit: PadDigit; onPress: (digit: PadDigit) => void }

const DigitKey = ({ digit, onPress }: DigitKeyProps) => (
  <button type="button" className={styles.key} onClick={() => onPress(digit)}>
    {digit}
  </button>
)

type PinPadDialogProps = { onClose: () => void }

/**
 * Asks the owner for the PIN on a pad of digits, which the keyboard's digits,
 * Backspace and Enter work too. Only an Unlock press opens it; once the PIN
 * opens, it closes and every page reads again with the unlock.
 */
export const PinPadDialog = ({ onClose }: PinPadDialogProps) => {
  const { dialog, keepKeys, close } = useModal()
  const titleId = useId()
  const queryClient = useQueryClient()
  const [pin, setPin] = useState('')
  const unlock = useMutation({
    mutationFn: (entered: string) => api.unlock(entered),
    onSuccess: (lock) => {
      close()
      queryClient.setQueryData(queryKeys.lock, lock)
      return queryClient.invalidateQueries()
    },
    onError: () => setPin(''),
  })
  const isEmpty = pin === ''
  const canUnlock = !isEmpty && !unlock.isPending

  const press = (digit: PadDigit) => {
    unlock.reset()
    setPin((current) => (current.length < PIN_MAX_DIGITS ? `${current}${digit}` : current))
  }
  const takeBack = () => setPin((current) => current.slice(0, -1))
  const submit = () => {
    if (canUnlock) unlock.mutate(pin)
  }

  // Enter always unlocks rather than pressing the focused key, so typed digits never repeat one.
  const keyActions: Record<string, () => void> = {
    [KEYS.backspace]: takeBack,
    [KEYS.enter]: submit,
  }

  const pressKey = (event: KeyboardEvent) => {
    keepKeys(event)
    if (event.metaKey || event.ctrlKey || event.altKey) return
    const { key } = event
    const action = isPadDigit(key) ? () => press(key) : keyActions[key]
    if (!action) return
    event.preventDefault()
    action()
  }

  return (
    <DialogFrame
      dialog={dialog}
      width={DIALOG_WIDTHS.narrow}
      labelledBy={titleId}
      onClose={onClose}
      onKeyDown={pressKey}
    >
      <div className={styles.body}>
        <h2 id={titleId} className={styles.title}>
          {PIN_PAD_COPY.title}
        </h2>
        <p className={styles.hint}>{PIN_PAD_COPY.hint}</p>
        <p className={styles.entered} aria-live="polite">
          <span aria-hidden="true" className={isEmpty ? styles.empty : styles.dots}>
            {isEmpty ? PIN_PAD_COPY.empty : PIN_PAD_COPY.dot.repeat(pin.length)}
          </span>
          <span className="visually-hidden">{PIN_PAD_COPY.entered(pin.length)}</span>
        </p>
        <fieldset className={styles.pad} aria-label={PIN_PAD_COPY.pad}>
          {PAD_ROW_DIGITS.map((digit) => (
            <DigitKey key={digit} digit={digit} onPress={press} />
          ))}
          <button
            type="button"
            className={styles.key}
            aria-label={PIN_PAD_COPY.backspace}
            disabled={isEmpty}
            onClick={takeBack}
          >
            <Icon name="backspace" size={24} />
          </button>
          <DigitKey digit={PAD_ZERO} onPress={press} />
          <button
            type="button"
            className={styles.enter}
            aria-label={PIN_PAD_COPY.unlock}
            disabled={!canUnlock}
            onClick={submit}
          >
            <Icon name="unlock" size={24} />
          </button>
        </fieldset>
        {unlock.isError && (
          <p role="alert" className={styles.error}>
            {unlock.error.message}
          </p>
        )}
        <div className={styles.actions}>
          <Button onClick={close}>{COMMON_COPY.cancel}</Button>
        </div>
      </div>
    </DialogFrame>
  )
}
