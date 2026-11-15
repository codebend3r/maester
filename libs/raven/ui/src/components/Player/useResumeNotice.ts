import { useEffect, useState } from 'react'

/** How long the resume notice, with its Start over, stays up. */
const RESUME_NOTICE_MS = 6_000

/**
 * Where a title resumed, shown a few seconds after it starts with a way to start over; null
 * once it has gone, or for a title that starts at the beginning.
 */
export const useResumeNotice = (resumeAt: number) => {
  const [resumedAt, setResumedAt] = useState<number | null>(resumeAt > 0 ? resumeAt : null)
  const isShown = resumedAt !== null
  useEffect(() => {
    if (!isShown) return
    const timer = window.setTimeout(() => setResumedAt(null), RESUME_NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [isShown])
  return { resumedAt, dismiss: () => setResumedAt(null) }
}
