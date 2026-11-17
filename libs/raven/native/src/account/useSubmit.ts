import { ApiError } from '@raven/core'
import { useRef, useState } from 'react'

import { SIGN_IN_ERRORS, type SignInError } from '@/account/signInErrors'

const SERVER_ERROR = 500

/**
 * A form's submit: one at a time, busy while it runs, and a failure kept as a refusal in the
 * server's own words when it refused, else as out of reach. A ref, not the state, refuses a
 * second submit in the same moment, since the state is a render behind.
 */
export const useSubmit = () => {
  const [isBusy, setBusy] = useState(false)
  const [error, setError] = useState<SignInError | null>(null)
  const isRunning = useRef(false)

  const run = (work: () => Promise<void>): void => {
    if (isRunning.current) return
    isRunning.current = true
    setBusy(true)
    setError(null)
    const settle = () => {
      isRunning.current = false
      setBusy(false)
    }
    work().then(settle, (failure: unknown) => {
      const isRefusal = failure instanceof ApiError && failure.status < SERVER_ERROR
      setError(
        isRefusal
          ? { kind: SIGN_IN_ERRORS.refused, message: failure.message }
          : { kind: SIGN_IN_ERRORS.unreachable },
      )
      settle()
    })
  }

  return { isBusy, error, setError, run }
}
