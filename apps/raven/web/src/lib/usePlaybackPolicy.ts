import { useQuery } from '@tanstack/react-query'
import { DEFAULT_PLAYBACK_SETTINGS, type PlaybackPolicy } from '@raven/core'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queryClient'

/**
 * The server's playback policy, for planning how a file plays here. Null
 * until the settings answer; the defaults when they cannot be read, as the
 * server falls back to them too.
 */
export const usePlaybackPolicy = (): PlaybackPolicy | null => {
  const settings = useQuery({
    queryKey: queryKeys.playbackSettings,
    queryFn: api.getPlaybackSettings,
    staleTime: 60_000,
  })
  return settings.data?.settings ?? (settings.isError ? DEFAULT_PLAYBACK_SETTINGS : null)
}
