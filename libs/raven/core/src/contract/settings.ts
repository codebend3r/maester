import { type Infer, exactPartial, isBoolean, object, oneOf } from '@/schema'

export const DIRECT_PLAYS = { auto: 'auto', force: 'force' } as const

export const TRANSCODINGS = { on: 'on', remuxOnly: 'remuxOnly', off: 'off' } as const

export const QUALITIES = { low: 'low', medium: 'medium', high: 'high' } as const

/** The frames a transcode may be scaled down to, in lines: 4K, 1080p and 720p. */
export const MAX_HEIGHTS = { uhd: 2160, fullHd: 1080, hd: 720 } as const

export const HW_ACCELS = {
  auto: 'auto',
  videotoolbox: 'videotoolbox',
  vaapi: 'vaapi',
  none: 'none',
} as const

/** The values each playback setting takes. */
export const PLAYBACK_CHOICES = {
  directPlay: Object.values(DIRECT_PLAYS),
  transcoding: Object.values(TRANSCODINGS),
  maxHeight: Object.values(MAX_HEIGHTS),
  quality: Object.values(QUALITIES),
  hwAccel: Object.values(HW_ACCELS),
} as const

export const isHwAccel = oneOf(PLAYBACK_CHOICES.hwAccel)

export const isMaxHeight = oneOf(PLAYBACK_CHOICES.maxHeight)

/** The frame a transcode is scaled down to: one of `MAX_HEIGHTS`. */
export type MaxHeight = Infer<typeof isMaxHeight>

/** What encodes a transcode: `auto` takes the GPU the machine has, `none` keeps to the CPU. */
export type HwAccel = Infer<typeof isHwAccel>

/** How the server plays video, set once for every viewer in Settings. */
export const isPlaybackSettings = object({
  /**
   * `auto` plays the original file when the browser takes it and converts
   * otherwise; `force` always sends the original file, for a browser the
   * check underrates.
   */
  directPlay: oneOf(PLAYBACK_CHOICES.directPlay),
  /**
   * `on` remuxes and transcodes as needed; `remuxOnly` never re-encodes
   * video; `off` converts nothing, so only files the browser plays as they
   * are play.
   */
  transcoding: oneOf(PLAYBACK_CHOICES.transcoding),
  /** The frame a transcode is scaled down to. */
  maxHeight: isMaxHeight,
  /** How hard a transcode is squeezed: `low` for a slow network, `high` for a big screen. */
  quality: oneOf(PLAYBACK_CHOICES.quality),
  /** What encodes a transcode: `auto` takes the GPU the machine has, `none` keeps to the CPU. */
  hwAccel: isHwAccel,
  /** Whether HDR is tone mapped to SDR on a transcode when the build can. */
  tonemap: isBoolean,
  /** Whether the server listens to each season in the background for the intro its episodes share. */
  detectMarkers: isBoolean,
})

export type PlaybackSettings = Infer<typeof isPlaybackSettings>

export const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = {
  directPlay: DIRECT_PLAYS.auto,
  transcoding: TRANSCODINGS.on,
  maxHeight: 1080,
  quality: QUALITIES.medium,
  hwAccel: HW_ACCELS.auto,
  tonemap: true,
  detectMarkers: true,
}

/** A change sends any of the fields; each given must be a value the setting takes. */
export const isPlaybackSettingsChange = exactPartial(isPlaybackSettings.shape)

export const ENCODER_KINDS = {
  software: 'software',
  vaapi: 'vaapi',
  videotoolbox: 'videotoolbox',
} as const

export const isEncoderKind = oneOf(Object.values(ENCODER_KINDS))

/** What transcodes encode with: the CPU, or a GPU through VAAPI or VideoToolbox. */
export type EncoderKind = Infer<typeof isEncoderKind>

/** The settings as kept, with what they come to on this machine. */
export const isPlaybackSettingsState = object({
  settings: isPlaybackSettings,
  effective: object({
    /** What transcodes encode with, after the test encode. */
    encoder: isEncoderKind,
    /** Whether this ffmpeg can tone map at all. */
    tonemapAvailable: isBoolean,
  }),
})

export type PlaybackSettingsState = Infer<typeof isPlaybackSettingsState>

export const TITLE_DISPLAYS = { logo: 'logo', text: 'text' } as const

/** The values each display setting takes. */
export const DISPLAY_CHOICES = {
  titles: Object.values(TITLE_DISPLAYS),
} as const

/** How pages look, set once for every viewer in Settings. */
export const isDisplaySettings = object({
  /** `logo` shows a movie's or show's title as its logo where TMDB has one; `text` always spells it out. */
  titles: oneOf(DISPLAY_CHOICES.titles),
})

export type DisplaySettings = Infer<typeof isDisplaySettings>

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = { titles: TITLE_DISPLAYS.logo }

/** A change sends any of the fields; each given must be a value the setting takes. */
export const isDisplaySettingsChange = exactPartial(isDisplaySettings.shape)

export type DisplaySettingsChange = Infer<typeof isDisplaySettingsChange>
