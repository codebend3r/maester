import { useNativeAudioHost } from '@raven/native'
import { unlockNow } from '@raven/native/headless'
import { type ComponentType, useMemo } from 'react'

import { trackPlanFor } from '@/downloads/downloadVisibility'
import { VideoAudioHost } from '@/music/VideoAudioHost'
import { DEVICE_INPUT } from '@/platform/devicePlatform'
import { INPUT_KINDS, type InputKind } from '@/platform/platform'
import { mediaSourcesFor } from '@/player/mediaSources'
import type { AppQueries } from '@/queries/useAppQueries'
import { useDownloads } from '@/stores/downloads'

/** What a music host reads of the active server. */
type MusicSession = Pick<AppQueries, 'server' | 'api'>

type NativeAudioHostProps = { session: MusicSession }

/**
 * Music on an iPhone or iPad, through `@raven/native`'s host over `@raven/audio`: a track
 * downloaded to this device plays from its file, with the cover saved beside it. The plan
 * reads the downloads and the unlock as each track plays, so neither is ever stale.
 */
const NativeAudioHost = ({ session: { server, api } }: NativeAudioHostProps) => {
  const plan = useMemo(
    () =>
      trackPlanFor({
        serverId: server.id,
        read: () => {
          const { entries, device } = useDownloads.getState()
          return { entries, isUnlocked: unlockNow(server.id), uriOf: device.disk.uriOf }
        },
      }),
    [server.id],
  )
  useNativeAudioHost({ api, server, sourcesFor: mediaSourcesFor, plan })
  return null
}

type MusicHostProps = { session: MusicSession }

/** The player each kind of device plays music through: the video player on a TV, `@raven/audio` under the thumb. */
const MUSIC_HOSTS = {
  [INPUT_KINDS.focus]: VideoAudioHost,
  [INPUT_KINDS.touch]: NativeAudioHost,
} as const satisfies Record<InputKind, ComponentType<MusicHostProps>>

/**
 * The one place music plays from, mounted above the routes so leaving a screen stops nothing:
 * `@raven/audio` on an iPhone or iPad, where the lock screen and the background matter, and the
 * video player out of sight on a TV.
 */
export const MusicHost = ({ session }: MusicHostProps) => {
  const Host = MUSIC_HOSTS[DEVICE_INPUT]
  return <Host session={session} />
}
