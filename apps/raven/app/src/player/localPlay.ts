import { type MediaItem, ROUTE_STATES, type RouteQuery } from '@raven/core'
import { useEffect, useState } from 'react'

import type { LocalCopy } from '@/player/playWay'

/**
 * How long a downloaded video waits for the server's word on it (where the viewer left off)
 * before it plays from what the download kept: long enough for a server at home to answer.
 */
const LOCAL_PATIENCE_MS = 4000

/** Whether a download still waits for the server: true until `LOCAL_PATIENCE_MS` past its start. */
export const usePatience = (isWaiting: boolean): boolean => {
  const [isPatient, setPatient] = useState(true)
  useEffect(() => {
    if (!isWaiting) return undefined
    const timer = setTimeout(() => setPatient(false), LOCAL_PATIENCE_MS)
    return () => clearTimeout(timer)
  }, [isWaiting])
  return isPatient
}

/** A download on this device, as the player may open it: the video it kept, and its file. */
export type KeptVideo = { media: MediaItem; copy: LocalCopy }

export const PLAY_ORIGINS = { server: 'server', local: 'local' } as const

/** Where the video's bytes come from: the server as the page says, or a download on this device. */
type PlayOrigin =
  | { kind: typeof PLAY_ORIGINS.server }
  | { kind: typeof PLAY_ORIGINS.local; media: MediaItem; local: LocalCopy }

const FROM_SERVER: PlayOrigin = { kind: PLAY_ORIGINS.server }

type PlayOriginOfProps = {
  /** The video's download on this device; null for none. */
  kept: KeptVideo | null
  page: RouteQuery<MediaItem>
  /** Whether a download still waits for the server's word on the video. */
  isPatient: boolean
}

/**
 * Decided once: a download always plays from the device, as the server's video (for the spot it
 * saved) once the server answers, or as the video the download kept once the server is late or
 * out of reach; until then, and with no download, the server's page decides.
 */
export const playOriginOf = ({ kept, page, isPatient }: PlayOriginOfProps): PlayOrigin => {
  if (kept === null) return FROM_SERVER
  if (page.state === ROUTE_STATES.ready) {
    return { kind: PLAY_ORIGINS.local, media: page.data, local: kept.copy }
  }
  if (page.state === ROUTE_STATES.loading && isPatient) return FROM_SERVER
  return { kind: PLAY_ORIGINS.local, media: kept.media, local: kept.copy }
}
