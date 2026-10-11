import { useQuery } from '@tanstack/react-query'
import { DEFAULT_PLAYBACK_SETTINGS, type PlaybackPolicy } from '@raven/core'
import { playbackSettingsQuery } from '@/lib/queries'

/**
 * The server's playback policy, for planning how a file plays here. Null
 * until the settings answer; the defaults when they cannot be read, as the
 * server falls back to them too.
 */
export const usePlaybackPolicy = (): PlaybackPolicy | null => {
  const settings = useQuery(playbackSettingsQuery)
  return settings.data?.settings ?? (settings.isError ? DEFAULT_PLAYBACK_SETTINGS : null)
}
