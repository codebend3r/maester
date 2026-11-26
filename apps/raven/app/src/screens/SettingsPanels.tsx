import {
  CAPTION_COLOURS,
  CAPTION_SIZES,
  MAX_HEIGHTS,
  type MaxHeight,
  type TitleRequest,
  type TitleRequests,
  isMaxHeight,
  REQUESTS_STATES,
  type RequestsState,
  myRequestsOf,
  requestKeyOf,
  requestsStateOf,
} from '@raven/core'
import {
  AUTOPLAY_COUNTDOWN_SECONDS,
  CAPTION_COLOUR_NAMES,
  CAPTION_SIZE_NAMES,
  CONTROLS_LINGER_SECONDS,
  useCaptionStyle,
  usePlayerPrefs,
} from '@raven/ui/headless'
import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import type { ComponentType } from 'react'

import { useAccountSession } from '@/account/session'
import {
  SettingsButton,
  SettingsChoice,
  SettingsFact,
  SettingsLine,
  SettingsSection,
  SettingsToggle,
} from '@/layouts'
import { COMING_SOON_COPY } from '@/queries/comingSoonCopy'
import type { AppQueries } from '@/queries/useAppQueries'
import { SETTINGS_COPY } from '@/screens/copy'
import { useAppPrefs } from '@/stores/appPrefs'
import { THEME_PICKER } from '@/theme/themeOptions'

/** What the away cap is called, as the web's server settings name the same heights. */
const AWAY_LABELS = {
  [MAX_HEIGHTS.uhd]: SETTINGS_COPY.heights.uhd,
  [MAX_HEIGHTS.fullHd]: SETTINGS_COPY.heights.fullHd,
  [MAX_HEIGHTS.hd]: SETTINGS_COPY.heights.hd,
} as const satisfies Record<MaxHeight, string>

/** A number as the picker keys it, which takes only strings. */
const keyOf = (value: number) => `${value}` as const

const AWAY_OPTIONS = Object.values(MAX_HEIGHTS).map((height) => ({
  key: keyOf(height),
  label: AWAY_LABELS[height],
}))

const SIZE_OPTIONS = Object.values(CAPTION_SIZES).map((size) => ({
  key: size,
  label: CAPTION_SIZE_NAMES[size],
}))

const COLOUR_OPTIONS = Object.values(CAPTION_COLOURS).map((colour) => ({
  key: colour,
  label: CAPTION_COLOUR_NAMES[colour],
}))

type SecondsOptionsProps = { min: number; max: number; step: number; current: number }

/**
 * The seconds a picker offers in place of the web's slider: every `step` from `min` to `max`,
 * and the one set now where it falls between them, so the row always names what is set.
 */
const secondsOptionsOf = ({ min, max, step, current }: SecondsOptionsProps) => {
  const steps = Array.from(
    { length: Math.floor((max - min) / step) + 1 },
    (_, at) => min + at * step,
  )
  const seconds = steps.includes(current) ? steps : [...steps, current].toSorted((a, b) => a - b)
  return seconds.map((value) => ({ key: keyOf(value), label: SETTINGS_COPY.secondsFor(value) }))
}

/** The countdown's picker steps by five, since the web's slider runs a minute. */
const COUNTDOWN_STEP = 5

type SecondsChooserProps = { set: (seconds: number) => void }

/** What a seconds picker does with the key chosen: sets the whole number it names. */
const secondsChooserOf =
  ({ set }: SecondsChooserProps) =>
  (key: string) => {
    const seconds = Number(key)
    if (Number.isInteger(seconds)) set(seconds)
  }

/**
 * Playback: what this device keeps for itself, how it plays a file and caps it away from home,
 * then the web's Playback tab, autoplay and its countdown and skipping intros, which the player
 * preferences keep here as the browser keeps them there.
 */
export const PlaybackPanel = () => {
  const shouldPreferDirectPlay = useAppPrefs((state) => state.shouldPreferDirectPlay)
  const isTranscodeAllowed = useAppPrefs((state) => state.isTranscodeAllowed)
  const awayMaxHeight = useAppPrefs((state) => state.awayMaxHeight)
  const change = useAppPrefs((state) => state.change)
  const autoplay = usePlayerPrefs((prefs) => prefs.autoplay)
  const setAutoplay = usePlayerPrefs((prefs) => prefs.setAutoplay)
  const countdownSeconds = usePlayerPrefs((prefs) => prefs.autoplayCountdownSeconds)
  const setCountdownSeconds = usePlayerPrefs((prefs) => prefs.setAutoplayCountdownSeconds)
  const autoSkipIntro = usePlayerPrefs((prefs) => prefs.autoSkipIntro)
  const setAutoSkipIntro = usePlayerPrefs((prefs) => prefs.setAutoSkipIntro)
  return (
    <>
      <SettingsSection note={SETTINGS_COPY.awayNote} title={SETTINGS_COPY.playback}>
        <SettingsToggle
          hint={SETTINGS_COPY.preferDirectHint}
          isOn={shouldPreferDirectPlay}
          label={SETTINGS_COPY.preferDirect}
          onToggle={(isOn) => change({ shouldPreferDirectPlay: isOn })}
        />
        <SettingsToggle
          hint={SETTINGS_COPY.allowTranscodeHint}
          isOn={isTranscodeAllowed}
          label={SETTINGS_COPY.allowTranscode}
          onToggle={(isOn) => change({ isTranscodeAllowed: isOn })}
        />
        <SettingsChoice
          label={SETTINGS_COPY.away}
          onChoose={(key) => {
            const height = Number(key)
            if (isMaxHeight(height)) change({ awayMaxHeight: height })
          }}
          options={AWAY_OPTIONS}
          value={keyOf(awayMaxHeight)}
        />
      </SettingsSection>
      <SettingsSection
        note={SETTINGS_COPY.countdownHint(AUTOPLAY_COUNTDOWN_SECONDS)}
        title={SETTINGS_COPY.upNext}
      >
        <SettingsToggle
          hint={SETTINGS_COPY.autoplayHint}
          isOn={autoplay}
          label={SETTINGS_COPY.autoplay}
          onToggle={setAutoplay}
        />
        <SettingsToggle
          hint={SETTINGS_COPY.skipIntrosHint}
          isOn={autoSkipIntro}
          label={SETTINGS_COPY.skipIntros}
          onToggle={setAutoSkipIntro}
        />
        <SettingsChoice
          label={SETTINGS_COPY.countdown}
          onChoose={secondsChooserOf({ set: setCountdownSeconds })}
          options={secondsOptionsOf({
            ...AUTOPLAY_COUNTDOWN_SECONDS,
            step: COUNTDOWN_STEP,
            current: countdownSeconds,
          })}
          value={keyOf(countdownSeconds)}
        />
      </SettingsSection>
    </>
  )
}

/** Subtitles: how they look on this device; each device keeps its own. */
export const SubtitlesPanel = () => {
  const captions = useCaptionStyle()
  return (
    <SettingsSection note={SETTINGS_COPY.subtitlesNote} title={SETTINGS_COPY.subtitles}>
      <SettingsChoice
        label={SETTINGS_COPY.subtitleSize}
        onChoose={(size) => captions.change({ size })}
        options={SIZE_OPTIONS}
        value={captions.style.size}
      />
      <SettingsChoice
        label={SETTINGS_COPY.subtitleColour}
        onChoose={(colour) => captions.change({ colour })}
        options={COLOUR_OPTIONS}
        value={captions.style.colour}
      />
    </SettingsSection>
  )
}

/** Account: who is signed in, and Sign out, which sends the viewer back to sign-in. */
export const AccountPanel = () => {
  const email = useAccountSession((state) => state.session?.email ?? null)
  const signOut = useAccountSession((state) => state.signOut)
  return (
    <SettingsSection
      note={email === null ? null : SETTINGS_COPY.signedInAs(email)}
      title={SETTINGS_COPY.account}
    >
      <SettingsButton isDisabled={false} onPress={signOut} text={SETTINGS_COPY.signOut} />
    </SettingsSection>
  )
}

/** This app: how raven looks on this device, as the web's This app tab holds Raven's own. */
export const ThisAppPanel = () => {
  const theme = useAppPrefs((state) => state.theme)
  const change = useAppPrefs((state) => state.change)
  return (
    <SettingsSection note={SETTINGS_COPY.themeNote} title={THEME_PICKER.label}>
      <SettingsChoice
        label={THEME_PICKER.label}
        onChoose={(picked) => change({ theme: picked })}
        options={THEME_PICKER.options}
        value={theme}
      />
    </SettingsSection>
  )
}

/** Advanced: settings few need, kept on this device. For now, how long the player's controls linger. */
export const AdvancedPanel = () => {
  const lingerSeconds = usePlayerPrefs((prefs) => prefs.controlsLingerSeconds)
  const setLingerSeconds = usePlayerPrefs((prefs) => prefs.setControlsLingerSeconds)
  return (
    <SettingsSection note={SETTINGS_COPY.advanced.help} title={SETTINGS_COPY.advanced.heading}>
      <SettingsChoice
        label={SETTINGS_COPY.advanced.linger}
        onChoose={secondsChooserOf({ set: setLingerSeconds })}
        options={secondsOptionsOf({ ...CONTROLS_LINGER_SECONDS, step: 1, current: lingerSeconds })}
        value={keyOf(lingerSeconds)}
      />
      <SettingsLine text={SETTINGS_COPY.advanced.lingerHint(CONTROLS_LINGER_SECONDS)} />
    </SettingsSection>
  )
}

type RequestsViewProps = { query: UseQueryResult<TitleRequests>; mine: readonly TitleRequest[] }

const RequestsReading = () => <SettingsLine text={SETTINGS_COPY.requests.reading} />

const RequestsFailed = ({ query }: RequestsViewProps) => (
  <SettingsLine isAlert text={`${SETTINGS_COPY.requests.failed}${query.error?.message ?? ''}`} />
)

const RequestsNone = () => <SettingsLine text={SETTINGS_COPY.requests.none} />

/** Each request, newest first as the server lists them: its title and where it stands. */
const RequestsListed = ({ mine }: RequestsViewProps) =>
  mine.map((request) => (
    <SettingsFact
      key={requestKeyOf(request)}
      label={request.title}
      value={COMING_SOON_COPY.statuses[request.status].label}
    />
  ))

const REQUESTS_VIEWS = {
  [REQUESTS_STATES.reading]: RequestsReading,
  [REQUESTS_STATES.failed]: RequestsFailed,
  [REQUESTS_STATES.none]: RequestsNone,
  [REQUESTS_STATES.listed]: RequestsListed,
} as const satisfies Record<RequestsState, ComponentType<RequestsViewProps>>

type RequestsPanelProps = { session: AppQueries }

/** Requests: every title the caller asked Coming soon to download, and where each stands. */
export const RequestsPanel = ({ session }: RequestsPanelProps) => {
  const query = useQuery(session.queries.requestsQuery)
  const mine = myRequestsOf(query.data)
  const View = REQUESTS_VIEWS[requestsStateOf({ query, count: mine.length })]
  return (
    <SettingsSection note={SETTINGS_COPY.requests.help} title={SETTINGS_COPY.requests.heading}>
      {query.data !== undefined && (
        <SettingsLine text={COMING_SOON_COPY.request.left(query.data.budget)} />
      )}
      <View mine={mine} query={query} />
    </SettingsSection>
  )
}
