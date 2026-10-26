import { type ReactNode, useId, useState } from 'react'
import { Button, Icon } from '@raven/ui'
import styles from '@/components/AuthScreen/AuthScreen.module.scss'

const MISMATCH_COPY = 'The passwords do not match.'

type FieldAlertProps = { id: string; children: string }

const FieldAlert = ({ id, children }: FieldAlertProps) => (
  <p id={id} role="alert" className={styles.alert}>
    <span className={styles.alertIcon}>
      <Icon name="alert" size={18} />
    </span>
    <span className={styles.alertText}>{children}</span>
  </p>
)

type EmailFieldProps = {
  value: string
  onChange: (value: string) => void
}

export const EmailField = ({ value, onChange }: EmailFieldProps) => {
  const id = useId()
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        Email
      </label>
      <input
        id={id}
        className={styles.input}
        type="email"
        name="email"
        inputMode="email"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

type PasswordFieldProps = {
  label: string
  autoComplete: string
  value: string
  onChange: (value: string) => void
  error: string | null
  isShown: boolean
  onToggleShown: () => void
  alsoReveals?: string
  children?: ReactNode
}

/**
 * A password with Show beside it to read it back, and `error` under it,
 * marked as the field to fix. Show also reads back `alsoReveals`, the id of
 * an input that repeats the password; `children` follows the alert.
 */
export const PasswordField = ({
  label,
  autoComplete,
  value,
  onChange,
  error,
  isShown,
  onToggleShown,
  alsoReveals,
  children,
}: PasswordFieldProps) => {
  const ids = { input: useId(), error: useId() }
  const isInvalid = error !== null
  return (
    <div className={styles.field}>
      <label htmlFor={ids.input} className={styles.label}>
        {label}
      </label>
      <div className={isInvalid ? `${styles.box} ${styles.invalid}` : styles.box}>
        <input
          id={ids.input}
          className={styles.boxed}
          type={isShown ? 'text' : 'password'}
          name="password"
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          required
          aria-invalid={isInvalid}
          aria-describedby={isInvalid ? ids.error : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <Button
          tone="ghost"
          className={styles.reveal}
          aria-controls={alsoReveals === undefined ? ids.input : `${ids.input} ${alsoReveals}`}
          onClick={onToggleShown}
        >
          {isShown ? 'Hide' : 'Show'}
          <span className="visually-hidden"> password</span>
        </Button>
      </div>
      {isInvalid && <FieldAlert id={ids.error}>{error}</FieldAlert>}
      {children}
    </div>
  )
}

type PasswordFieldsProps = {
  label: string
  password: string
  confirmation: string
  refusal: { password: string; message: string } | null
  isMismatched: boolean
  onPasswordChange: (value: string) => void
  onConfirmationChange: (value: string) => void
}

/**
 * A new password typed twice, with one Show and Hide for both. `refusal` is
 * what the server said against the password it was sent, shown under the
 * field only while it still holds that password; `isMismatched` marks the
 * confirmation instead. Only one of the two shows at a time.
 */
export const PasswordFields = ({
  label,
  password,
  confirmation,
  refusal,
  isMismatched,
  onPasswordChange,
  onConfirmationChange,
}: PasswordFieldsProps) => {
  const ids = { confirm: useId(), mismatch: useId() }
  const [isShown, setShown] = useState(false)
  const isRefused = !isMismatched && refusal !== null && refusal.password === password

  return (
    <>
      <PasswordField
        label={label}
        autoComplete="new-password"
        value={password}
        onChange={onPasswordChange}
        error={isRefused ? refusal.message : null}
        isShown={isShown}
        onToggleShown={() => setShown((now) => !now)}
        alsoReveals={ids.confirm}
      />
      <div className={styles.field}>
        <label htmlFor={ids.confirm} className={styles.label}>
          Confirm password
        </label>
        <input
          id={ids.confirm}
          className={styles.input}
          type={isShown ? 'text' : 'password'}
          name="confirm-password"
          autoComplete="new-password"
          autoCapitalize="none"
          spellCheck={false}
          required
          aria-invalid={isMismatched}
          aria-describedby={isMismatched ? ids.mismatch : undefined}
          value={confirmation}
          onChange={(event) => onConfirmationChange(event.target.value)}
        />
        {isMismatched && <FieldAlert id={ids.mismatch}>{MISMATCH_COPY}</FieldAlert>}
      </div>
    </>
  )
}
