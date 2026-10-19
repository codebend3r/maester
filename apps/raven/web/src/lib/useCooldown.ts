import { useEffect, useState } from 'react'

const COOLDOWN_SECONDS = 60
const SECOND_MS = 1000

/** Counts down from a minute once started. */
export const useCooldown = () => {
  const [secondsLeft, setSecondsLeft] = useState(0)
  useEffect(() => {
    if (secondsLeft <= 0) return
    const timer = setTimeout(() => setSecondsLeft((now) => now - 1), SECOND_MS)
    return () => clearTimeout(timer)
  }, [secondsLeft])
  return {
    secondsLeft,
    isCounting: secondsLeft > 0,
    start: () => setSecondsLeft(COOLDOWN_SECONDS),
  }
}
