import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { mediaSourcesFor } from '@/player/mediaSources'
import { Playing, type PlayingProps } from '@/player/Playing'
import { type LocalCopy, localWayOf } from '@/player/playWay'

export type LocalPlayerProps = Omit<PlayingProps, 'way' | 'summary'> & {
  /** The video's download on this device, which plays in place of the server's. */
  local: LocalCopy
}

/**
 * A download, played at once from its file as it is, the server or no server: it waits on
 * nothing the server says, and reads only the item's page for the synopsis, which fails quietly
 * offline. Progress still goes to the server, as it does for every video.
 */
export const LocalPlayer = ({ local, ...playing }: LocalPlayerProps) => {
  const { session, media } = playing
  const details = useQuery(session.queries.itemQuery(media.item?.id ?? null))
  // One per server, so the subtitles reach the video the same way as the server's picture would.
  const sources = mediaSourcesFor(session.server)
  const way = useMemo(() => localWayOf({ sources, copy: local }), [sources, local])
  return <Playing {...playing} summary={details.data?.summary ?? null} way={way} />
}
