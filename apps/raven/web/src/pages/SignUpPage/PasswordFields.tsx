import { useId, useState } from 'react'
import { Button, Icon } from '@raven/ui'
import signInStyles from '@/pages/SignInPage/SignInPage.module.scss'

const MISMATCH_COPY = 'The passwords do not match.'

const Alert = ({ id, children }: { id: string; children: string }) => (
  <p id={id} role="alert" className={signInStyles.alert}>
    <span className={signInStyles.alertIcon}>
      <Icon name="alert" size={18} />
    </span>
    <span className={signInStyles.alertText}>{children}</span>
  </p>
)

/**
 * A new password typed twice, with one Show and Hide for both. `refusal` is
 * what the server said against the password, shown under it; `isMismatched`
 * marks the confirmation instead. Only one of the two shows at a time.
 */
export const PasswordFields = ({
  label = 'Password',
  password,
  confirmation,
  refusal,
  isMismatched,
  onPasswordChange,
  onConfirmationChange,
}: {
  label?: string
  password: string
  confirmation: string
  refusal: string | null
  isMismatched: boolean
  onPasswordChange: (value: string) => void
  onConfirmationChange: (value: string) => void
}) => {
  const ids = { password: useId(), confirm: useId(), error: useId() }
  const [isShown, setShown] = useState(false)
  const type = isShown ? 'text' : 'password'
  const isRefused = refusal !== null && !isMismatched

  return (
    <>
      <div className={signInStyles.field}>
        <label htmlFor={ids.password} className={signInStyles.label}>
          {label}
        </label>
        <div
          className={
            isRefused
              ? `${signInStyles.box} ${signInStyles.secret} ${signInStyles.invalid}`
              : `${signInStyles.box} ${signInStyles.secret}`
          }
        >
          <input
            id={ids.password}
            className={signInStyles.boxed}
            type={type}
            name="password"
            autoComplete="new-password"
            autoCapitalize="none"
            spellCheck={false}
            required
            aria-invalid={isRefused}
            aria-describedby={isRefused ? ids.error : undefined}
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
          />
          <Button
            tone="ghost"
            className={signInStyles.reveal}
            aria-controls={`${ids.password} ${ids.confirm}`}
            onClick={() => setShown((now) => !now)}
          >
            {isShown ? 'Hide' : 'Show'}
            <span className="visually-hidden"> password</span>
          </Button>
        </div>
        {isRefused && <Alert id={ids.error}>{refusal}</Alert>}
      </div>
      <div className={signInStyles.field}>
        <label htmlFor={ids.confirm} className={signInStyles.label}>
          Confirm password
        </label>
        <input
          id={ids.confirm}
          className={signInStyles.input}
          type={type}
          name="confirm-password"
          autoComplete="new-password"
          autoCapitalize="none"
          spellCheck={false}
          required
          aria-invalid={isMismatched}
          aria-describedby={isMismatched ? ids.error : undefined}
          value={confirmation}
          onChange={(event) => onConfirmationChange(event.target.value)}
        />
        {isMismatched && <Alert id={ids.error}>{MISMATCH_COPY}</Alert>}
      </div>
    </>
  )
}
