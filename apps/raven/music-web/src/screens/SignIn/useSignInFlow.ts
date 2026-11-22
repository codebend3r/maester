import { SIGN_IN_ERRORS, type SignInError } from '@raven/core'
import { useState } from 'react'
import { signIn } from '@/lib/signIn'

type UseSignInFlowProps = {
  /** Where a finished sign-in goes. */
  onDone: () => void
}

type Credentials = Parameters<typeof signIn>[0]

/**
 * Sign-in's one step, as the apps run it: the raven account's email and password and nothing
 * more. It holds the fields, whether a submit is under way and the one error the last submit
 * left, which the screen says in Wren's words (`signInErrorsOf`).
 */
export const useSignInFlow = ({ onDone }: UseSignInFlowProps) => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<SignInError | null>(null)

  const attempt = async (credentials: Credentials): Promise<void> => {
    setIsBusy(true)
    setError(null)
    try {
      const failure = await signIn(credentials)
      if (failure !== null) {
        setError(failure)
        return
      }
      setPassword('')
      onDone()
    } finally {
      setIsBusy(false)
    }
  }

  const submitAccount = (): void => {
    const trimmed = email.trim()
    if (trimmed === '' || password === '') {
      setError({ kind: SIGN_IN_ERRORS.missing })
      return
    }
    // `signIn` answers every failure as its error and never rejects; the catch only keeps the promise from floating.
    attempt({ email: trimmed, password }).catch(() => undefined)
  }

  return { email, setEmail, password, setPassword, isBusy, error, submitAccount }
}

/** What the flow hands the form: the fields, their setters, the error and the submit. */
export type SignInFlow = ReturnType<typeof useSignInFlow>
