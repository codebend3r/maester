import { useEffect, useState } from 'react'

/** `value`, but only once it has stopped changing for `delayMs`. */
export const useDebouncedValue = <T>({ value, delayMs }: { value: T; delayMs: number }): T => {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])
  return settled
}
