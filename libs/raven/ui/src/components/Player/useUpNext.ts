import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useHostServices } from '@/stores/playerServices'

/** Replaces the current watch entry only on a transition to ended. */
export const useUpNext = ({ ended }: { ended: boolean }) => {
  const navigate = useNavigate()
  const {
    title: { next },
  } = useHostServices()
  const wasEnded = useRef(false)
  useEffect(() => {
    if (ended && !wasEnded.current && next) {
      void navigate(next.to, { replace: true, state: next.state })
    }
    wasEnded.current = ended
  }, [ended, next, navigate])
  return next
}
