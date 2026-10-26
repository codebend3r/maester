import { useQuery } from '@tanstack/react-query'
import { DEFAULT_PLAYBACK_SETTINGS, type PlaybackPolicy } from '@raven/core'
import type { RavenQueries } from '@/query/ravenQueries'

type UsePlaybackPolicyProps = {
  queries: Pick<RavenQueries, 'playbackSettingsQuery'>
}

/**
 * The server's playback policy, for planning how a file plays here. Null
 * until the settings answer; the defaults when they cannot be read, as the
 * server falls back to them too.
 */
export const usePlaybackPolicy = ({ queries }: UsePlaybackPolicyProps): PlaybackPolicy | null => {
  const settings = useQuery(queries.playbackSettingsQuery)
  return settings.data?.settings ?? (settings.isError ? DEFAULT_PLAYBACK_SETTINGS : null)
}
