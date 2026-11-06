import {
  DEFAULT_DISPLAY_SETTINGS,
  DEFAULT_PLAYBACK_SETTINGS,
  DISPLAY_CHOICES,
  type DisplaySettings,
  type MaxHeight,
  PLAYBACK_CHOICES,
  type PlaybackSettings,
  type PlaybackSettingsState,
  isMaxHeight,
} from '@raven/core'
import { edit, mutationKeys, queryKeys, useOptimisticMutation } from '@raven/ui/headless'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ComponentType, useState } from 'react'

import {
  SettingsButton,
  SettingsChoice,
  SettingsLine,
  SettingsSection,
  SettingsToggle,
} from '@/layouts'
import type { AppQueries } from '@/queries/useAppQueries'
import { AdminLibraries } from '@/screens/AdminLibraries'
import { AdminRemoteAccess } from '@/screens/AdminRemoteAccess'
import { AdminUsers } from '@/screens/AdminUsers'
import {
  ADMIN_COPY,
  DIRECT_PLAY_LABELS,
  ENCODER_NAMES,
  HW_ACCEL_LABELS,
  MAX_HEIGHT_LABELS,
  QUALITY_LABELS,
  TITLE_LABELS,
  TRANSCODING_LABELS,
} from '@/screens/adminCopy'

/** A height as the picker keys it, which takes only strings. */
const heightKeyOf = (height: MaxHeight) => `${height}` as const

const DIRECT_PLAY_OPTIONS = PLAYBACK_CHOICES.directPlay.map((key) => ({
  key,
  label: DIRECT_PLAY_LABELS[key],
}))
const TRANSCODING_OPTIONS = PLAYBACK_CHOICES.transcoding.map((key) => ({
  key,
  label: TRANSCODING_LABELS[key],
}))
const MAX_HEIGHT_OPTIONS = PLAYBACK_CHOICES.maxHeight.map((height) => ({
  key: heightKeyOf(height),
  label: MAX_HEIGHT_LABELS[height],
}))
const QUALITY_OPTIONS = PLAYBACK_CHOICES.quality.map((key) => ({
  key,
  label: QUALITY_LABELS[key],
}))
const HW_ACCEL_OPTIONS = PLAYBACK_CHOICES.hwAccel.map((key) => ({
  key,
  label: HW_ACCEL_LABELS[key],
}))
const TITLE_OPTIONS = DISPLAY_CHOICES.titles.map((key) => ({ key, label: TITLE_LABELS[key] }))

type IsAtDefaultsProps<T extends Record<string, unknown>> = { current: T; defaults: T }

/** Whether every setting in `current` is where a fresh install has it. */
const isAtDefaults = <T extends Record<string, unknown>>({
  current,
  defaults,
}: IsAtDefaultsProps<T>): boolean =>
  Object.keys(defaults).every((key) => current[key] === defaults[key])

type ResetControlProps = {
  isBusy: boolean
  isAllAtDefaults: boolean
  onReset: () => void
  onConfirming: (isConfirming: boolean) => void
}

const ResetConfirm = ({ isBusy, onReset, onConfirming }: ResetControlProps) => (
  <>
    <SettingsLine text={ADMIN_COPY.resetConfirm} />
    <SettingsButton isDisabled={isBusy} onPress={onReset} text={ADMIN_COPY.resetAll} />
    <SettingsButton
      isDisabled={false}
      onPress={() => onConfirming(false)}
      text={ADMIN_COPY.cancel}
    />
  </>
)

const ResetAsk = ({ isBusy, isAllAtDefaults, onConfirming }: ResetControlProps) => (
  <SettingsButton
    isDisabled={isBusy || isAllAtDefaults}
    onPress={() => onConfirming(true)}
    text={ADMIN_COPY.resetToDefaults}
  />
)

const RESET_STATES = { confirming: 'confirming', idle: 'idle' } as const
type ResetState = (typeof RESET_STATES)[keyof typeof RESET_STATES]

const RESET_VIEWS = {
  [RESET_STATES.confirming]: ResetConfirm,
  [RESET_STATES.idle]: ResetAsk,
} as const satisfies Record<ResetState, ComponentType<ResetControlProps>>

type PlaybackRowsProps = {
  state: PlaybackSettingsState
  onSave: (change: Partial<PlaybackSettings>) => void
}

/** The server's playback settings, in the web's order. */
const PlaybackRows = ({ state: { settings, effective }, onSave }: PlaybackRowsProps) => (
  <>
    <SettingsChoice
      label={ADMIN_COPY.directPlay}
      onChoose={(directPlay) => onSave({ directPlay })}
      options={DIRECT_PLAY_OPTIONS}
      value={settings.directPlay}
    />
    <SettingsChoice
      label={ADMIN_COPY.transcoding}
      onChoose={(transcoding) => onSave({ transcoding })}
      options={TRANSCODING_OPTIONS}
      value={settings.transcoding}
    />
    <SettingsChoice
      label={ADMIN_COPY.maxHeight}
      onChoose={(key) => {
        const maxHeight = Number(key)
        if (isMaxHeight(maxHeight)) onSave({ maxHeight })
      }}
      options={MAX_HEIGHT_OPTIONS}
      value={heightKeyOf(settings.maxHeight)}
    />
    <SettingsChoice
      label={ADMIN_COPY.quality}
      onChoose={(quality) => onSave({ quality })}
      options={QUALITY_OPTIONS}
      value={settings.quality}
    />
    <SettingsChoice
      label={ADMIN_COPY.hwAccel}
      onChoose={(hwAccel) => onSave({ hwAccel })}
      options={HW_ACCEL_OPTIONS}
      value={settings.hwAccel}
    />
    <SettingsLine text={ADMIN_COPY.encodesWith(ENCODER_NAMES[effective.encoder])} />
    <SettingsToggle
      hint={effective.tonemapAvailable ? ADMIN_COPY.tonemapHint : ADMIN_COPY.tonemapUnavailable}
      isOn={settings.tonemap}
      label={ADMIN_COPY.tonemap}
      onToggle={(tonemap) => onSave({ tonemap })}
    />
    <SettingsToggle
      hint={ADMIN_COPY.detectMarkersHint}
      isOn={settings.detectMarkers}
      label={ADMIN_COPY.detectMarkers}
      onToggle={(detectMarkers) => onSave({ detectMarkers })}
    />
  </>
)

type FailureLineProps = { failure: Error | null }

/** Why the server refused a change, until the next one. */
const SaveFailure = ({ failure }: FailureLineProps) =>
  failure !== null && <SettingsLine isAlert text={`${ADMIN_COPY.saveFailed}${failure.message}`} />

type AdminSettingsProps = { session: AppQueries; ownerId: string }

/**
 * The owner's settings, the web's Admin page: Reset to defaults, Playback, Display, Remote
 * Access, the library scans and Users. Changes save as they are made and show at once; the
 * server is the authority on every one, so a refusal puts the change back and says why.
 */
export const AdminSettings = ({ session, ownerId }: AdminSettingsProps) => {
  const { api, queries } = session
  const queryClient = useQueryClient()
  const [isConfirming, setConfirming] = useState(false)
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
      setConfirming(false)
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
  const Reset = RESET_VIEWS[isConfirming ? RESET_STATES.confirming : RESET_STATES.idle]

  return (
    <>
      <SettingsSection note={ADMIN_COPY.help} title={ADMIN_COPY.heading}>
        <Reset
          isAllAtDefaults={isAllAtDefaults}
          isBusy={isBusy}
          onConfirming={setConfirming}
          onReset={() => reset.mutate()}
        />
        {reset.isSuccess && isAllAtDefaults && <SettingsLine text={ADMIN_COPY.resetDone} />}
        {reset.error !== null && (
          <SettingsLine isAlert text={`${ADMIN_COPY.resetFailed}${reset.error.message}`} />
        )}
      </SettingsSection>
      <SettingsSection note={ADMIN_COPY.playbackHint} title={ADMIN_COPY.playback}>
        {playback.isPending && <SettingsLine text={ADMIN_COPY.reading} />}
        {playback.error !== null && <SettingsLine isAlert text={playback.error.message} />}
        {playback.data !== undefined && (
          <PlaybackRows onSave={(change) => save.mutate(change)} state={playback.data} />
        )}
        <SaveFailure failure={save.failure} />
      </SettingsSection>
      <SettingsSection note={ADMIN_COPY.displayHint} title={ADMIN_COPY.display}>
        {display.isPending && <SettingsLine text={ADMIN_COPY.reading} />}
        {display.error !== null && <SettingsLine isAlert text={display.error.message} />}
        {display.data !== undefined && (
          <SettingsChoice
            label={ADMIN_COPY.movieTitles}
            onChoose={(titles) => saveDisplay.mutate({ titles })}
            options={TITLE_OPTIONS}
            value={display.data.titles}
          />
        )}
        <SaveFailure failure={saveDisplay.failure} />
      </SettingsSection>
      <AdminRemoteAccess session={session} />
      <AdminLibraries session={session} />
      <AdminUsers ownerId={ownerId} session={session} />
    </>
  )
}
