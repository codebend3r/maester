import type { MediaItem } from '@raven/core'
import type { RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import { useVideoEvents } from '@/components/Player/useVideoEvents'
import { watchLink } from '@/lib/itemLinks'

/**
 * The link to the next video in line, null with none, followed once this
 * one ends. The next takes this one's place in history, so Back leaves the
 * player in one step however many played.
 */
export const useUpNext = ({
  videoRef,
  upNext,
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  upNext: readonly MediaItem[]
}) => {
  const navigate = useNavigate()
  const [next, ...after] = upNext
  const link = next ? { ...watchLink({ media: next, upNext: after }), replace: true } : null
  useVideoEvents({
    videoRef,
    on: {
      ended: () => {
        if (link) void navigate(link.to, { replace: link.replace, state: link.state })
      },
    },
  })
  return link
}
