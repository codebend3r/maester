type MenuPillLabelProps = { title: string; value: string }

type DroppedFramesProps = { dropped: string; total: string }

type ScaledSizeProps = { size: string; scale: number }

type FrameSizeProps = { size: string; name: string }

type ScrubberPositionProps = { shown: string; total: string }

type TranscodedProps = { size: string; quality: string }

type StepDownWithNeedProps = { carried: string | null; noun: string; needed: string }

type SkipFlashProps = { isBack: boolean; seconds: number }

export const CONTROLS_COPY = {
  mute: 'Mute (m)',
  unmute: 'Unmute (m)',
  subtitlesOn: 'On',
  subtitlesOff: 'Off',
  menuPillLabel: ({ title, value }: MenuPillLabelProps) => `${title}: ${value}`,
  separator: ' · ',
  showLength: (endsAt: string) => `${endsAt}, show the length`,
  showEndTime: (length: string) => `Length ${length}, show the end time`,
  nothingUpNext: 'Nothing up next',
  next: (upNext: string) => `Next: ${upNext}`,
  fullScreen: 'Full screen',
  exitFullScreen: 'Exit full screen',
  fullScreenShortcut: (label: string) => `${label} (f)`,
  restart: 'Back to the start (Home)',
  back: 'Back 10 seconds (j)',
  play: 'Play (k)',
  pause: 'Pause (k)',
  forward: 'Forward 10 seconds (l)',
  volume: 'Volume',
} as const

export const SETTINGS_MENU_COPY = {
  loadingSubtitles: 'Loading subtitles',
  subtitlesFailed: 'These subtitles could not be loaded.',
  tracksUnavailable: 'Tracks unavailable.',
  readingTracks: 'Reading tracks',
  noAudioTracks: 'No audio tracks.',
  off: 'Off',
  on: 'On',
  speed: 'Speed',
  normalSpeed: 'Normal',
  rate: (speed: number) => `${speed}×`,
  autoplay: 'Autoplay',
  playbackInfo: 'Playback info',
  closeMenu: 'Close menu',
} as const

export const PLAYBACK_INFO_COPY = {
  directPlay: 'Direct play',
  remux: 'Remux',
  transcode: 'Transcode',
  hdr: 'HDR',
  sdr: 'SDR',
  standardDefinition: 'SD',
  frameSize: ({ size, name }: FrameSizeProps) => `${size} (${name})`,
  scaledSize: ({ size, scale }: ScaledSizeProps) => `${size} at ${scale}×`,
  fourK: '4K',
  height: (height: number) => `${height}p`,
  transcoded: ({ size, quality }: TranscodedProps) =>
    `H.264, re-encoded up to ${size} at ${quality} quality`,
  reencoded: 'H.264, re-encoded',
  conversion: 'Conversion',
  videoCodec: 'Video codec',
  copied: (codec: string) => `${codec}, copied as it is`,
  audioCodec: 'Audio codec',
  stereoAac: 'AAC stereo, re-encoded',
  readingStreams: "Reading the file's streams",
  streamsFailed: "The file's streams could not be read.",
  originalFile: 'Original file',
  container: 'Container',
  size: 'Size',
  bitrate: 'Bitrate',
  bitDepth: 'Bit depth',
  bits: (depth: number) => `${depth}-bit`,
  resolution: 'Resolution',
  frameRate: 'Frame rate',
  videoBitrate: 'Video bitrate',
  range: 'Range',
  audioTrack: 'Audio track',
  channels: 'Channels',
  audioBitrate: 'Audio bitrate',
  sampleRate: 'Sample rate',
  heading: 'Playback info',
  close: 'Close playback info',
  playback: 'Playback',
  player: 'Player',
  method: 'Method',
  delivery: 'Delivery',
  asItIs: 'The file as it is',
  fragmented: 'Fragmented MP4 through MSE',
  video: 'Video',
  playerSize: 'Player size',
  decodedSize: 'Decoded size',
  droppedFrames: 'Dropped frames',
  droppedOf: ({ dropped, total }: DroppedFramesProps) => `${dropped} of ${total}`,
} as const

export const STAGE_COPY = {
  undoSkip: 'Undo skip',
  skipIntro: 'Skip intro',
  skipCredits: 'Skip credits',
  removedFromFavourites: 'Removed from favourites',
  addedToFavourites: 'Added to favourites',
  back: 'Back',
  favourite: 'Favourite',
  upNextLabel: (label: string) => `Up next: ${label}`,
  upNext: 'Up next',
  resumedAt: (time: string) => `Resumed at ${time}`,
  startOver: 'Start over',
} as const

export const UNPLAYABLE_COPY = {
  back: 'Back',
  cannotPlay: "This video can't play in this browser.",
  tryAnyway: 'Try playing anyway',
  report: 'Report this error',
} as const

export const SCRUBBER_COPY = {
  seek: 'Seek',
  position: ({ shown, total }: ScrubberPositionProps) => `${shown} of ${total}`,
} as const

export const SHORTCUTS_TIP_COPY = {
  heading: 'Play with your keyboard',
  dismiss: 'Got it',
} as const

export const SHORTCUTS_DIALOG_COPY = {
  heading: 'Keyboard shortcuts',
  close: 'Close shortcuts',
} as const

export const UP_NEXT_CARD_COPY = {
  oneSecond: '1 second',
  seconds: (seconds: number) => `${seconds} seconds`,
  nextSeason: 'Next season',
  upNext: 'Up next',
  playsIn: (time: string) => `Plays in ${time}`,
  sceneAfter: 'A scene follows the credits',
  playNextSeason: 'Play next season',
  playNow: 'Play now',
  watchCredits: 'Watch credits',
} as const

export const PRELOADER_COPY = {
  loading: 'Loading',
} as const

export const PLAYBACK_FACTS_COPY = {
  hdr: (resolution: string) => `${resolution} HDR`,
  height: (height: number) => `${height}p`,
  subtitlesOff: 'Off',
  stepDown: (carried: string | null) =>
    `Switched to a transcode because the connection carried only ${carried}.`,
  stepDownWithNeed: ({ carried, noun, needed }: StepDownWithNeedProps) =>
    `Switched to a transcode because the connection carried ${carried} and ${noun} needs ${needed}.`,
  endsAt: (clock: string) => `Ends at ${clock}`,
} as const

export const PLAY_CHOICES_COPY = {
  playAs: 'Play as',
  quality: 'Quality',
  original: 'Play original quality',
  serverSize: "Converted at the server's size",
  convertTo: (label: string) => `Convert to ${label}`,
} as const

export const PLAYER_ACTIONS_COPY = {
  muted: 'Muted',
  soundOn: 'Sound on',
  normalSpeed: 'Normal speed',
  rate: (rate: number) => `${rate}×`,
  noSubtitles: 'No subtitles',
  subtitlesOn: 'on',
  subtitles: (language: string) => `Subtitles: ${language}`,
  subtitlesOff: 'Subtitles off',
  play: 'Play',
  pause: 'Pause',
  percent: (percent: number) => `${percent}%`,
  subtitleSize: (percent: number) => `Subtitles ${percent}%`,
  skip: ({ isBack, seconds }: SkipFlashProps) => `${isBack ? 'Back' : 'Forward'} ${seconds}s`,
} as const

export const NATIVE_ENGINE_COPY = {
  couldNotPlay: 'Raven could not play this video.',
} as const
