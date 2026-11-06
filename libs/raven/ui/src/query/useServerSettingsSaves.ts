import {
  type ApiClient,
  DEFAULT_DISPLAY_SETTINGS,
  DEFAULT_PLAYBACK_SETTINGS,
  type DisplaySettings,
  type PlaybackSettings,
} from '@raven/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { edit, useOptimisticMutation } from '@/query/optimistic'
import { mutationKeys, queryKeys } from '@/query/queryClient'
import type { RavenQueries } from '@/query/ravenQueries'

type IsAtDefaultsProps<T extends Record<string, unknown>> = { current: T; defaults: T }

/** Whether every setting in `current` is where a fresh install has it. */
const isAtDefaults = <T extends Record<string, unknown>>({
  current,
  defaults,
}: IsAtDefaultsProps<T>): boolean =>
  Object.keys(defaults).every((key) => current[key] === defaults[key])

type UseServerSettingsSavesProps = {
  api: ApiClient
  queries: Pick<RavenQueries, 'playbackSettingsQuery' | 'displaySettingsQuery'>
  /** Called once Reset to defaults has landed on both, so the host can stop asking. */
  onReset: () => void
}

/**
 * The owner's server settings and their saves, as every Admin page holds them: playback and
 * display each save optimistically, one change at a time, and a refusal puts it back; Reset to
 * defaults sets both at once. `isAllAtDefaults` counts a setting not read yet as at its default.
 */
export const useServerSettingsSaves = ({ api, queries, onReset }: UseServerSettingsSavesProps) => {
  const queryClient = useQueryClient()
  const playback = useQuery(queries.playbackSettingsQuery)
  const display = useQuery(queries.displaySettingsQuery)
  const save = useOptimisticMutation({
    mutationKey: mutationKeys.playbackSettings,
    mutationFn: (change: Partial<PlaybackSettings>) => api.setPlaybackSettings(change),
    edits: (change) => [
      edit({
        queryKey: queries.playbackSettingsQuery.queryKey,
        update: (state) => ({ ...state, settings: { ...state.settings, ...change } }),
      }),
    ],
    settle: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.playbackSettings, exact: true }),
  })
  const saveDisplay = useOptimisticMutation({
    mutationKey: mutationKeys.displaySettings,
    mutationFn: (change: Partial<DisplaySettings>) => api.setDisplaySettings(change),
    edits: (change) => [
      edit({
        queryKey: queries.displaySettingsQuery.queryKey,
        update: (shown) => ({ ...shown, ...change }),
      }),
    ],
    settle: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.displaySettings, exact: true }),
  })
  const reset = useMutation({
    mutationFn: () =>
      Promise.all([
        api.setPlaybackSettings(DEFAULT_PLAYBACK_SETTINGS),
        api.setDisplaySettings(DEFAULT_DISPLAY_SETTINGS),
      ]),
    onSuccess: ([played, shown]) => {
      queryClient.setQueryData(queryKeys.playbackSettings, played)
      queryClient.setQueryData(queryKeys.displaySettings, shown)
      onReset()
    },
    // A reset may land on one and fail on the other, so both are read again either way.
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.playbackSettings }),
        queryClient.invalidateQueries({ queryKey: queryKeys.displaySettings }),
      ]),
  })
  const settings = playback.data?.settings
  const isBusy = save.isPending || saveDisplay.isPending || reset.isPending
  const isAllAtDefaults =
    (settings === undefined ||
      isAtDefaults({ current: settings, defaults: DEFAULT_PLAYBACK_SETTINGS })) &&
    (display.data === undefined ||
      isAtDefaults({ current: display.data, defaults: DEFAULT_DISPLAY_SETTINGS }))
  return { playback, display, save, saveDisplay, reset, isBusy, isAllAtDefaults }
}
