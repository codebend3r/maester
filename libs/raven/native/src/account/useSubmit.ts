import { ApiError } from '@raven/core'
import { useRef, useState } from 'react'

const SERVER_ERROR = 500

type UseSubmitProps = { unreachable: string }

/**
 * A form's submit: one at a time, busy while it runs, and a failure said in the server's own
 * words when it refused, else as `unreachable`. A ref, not the state, refuses a second submit
 * in the same moment, since the state is a render behind.
 */
export const useSubmit = ({ unreachable }: UseSubmitProps) => {
  const [isBusy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
      setError(isRefusal ? failure.message : unreachable)
      settle()
    })
  }

  return { isBusy, error, setError, run }
}
