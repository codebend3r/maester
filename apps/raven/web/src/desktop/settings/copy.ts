import { formatBytes } from '@raven/core'

type SpaceProps = { used: number; free: number; computer: string }

export const DOWNLOADS_SECTION_COPY = {
  help: (computer: string) => `What Raven keeps on this ${computer}.`,
  deleteOnceWatchedHint:
    'What a new download starts with. A download set so goes a while after its last minutes play.',
  space: ({ used, free, computer }: SpaceProps) =>
    `${formatBytes(used)} of downloads, ${formatBytes(free)} free on this ${computer}.`,
  deleteAllQuestion: 'Delete all downloads?',
  deleteAllFreeing: (used: number) => `Delete all downloads? ${formatBytes(used)} will be freed.`,
  deleteAll: 'Delete all',
  showInFinder: 'Show in Finder',
  deleteAllDownloads: 'Delete all downloads',
} as const

export const THIS_COMPUTER_COPY = {
  title: 'This computer',
  help: (computer: string) => `How Raven sends sound from this ${computer}.`,
  pcmLabel: 'Speakers or TV',
  pcmHint: (computer: string) =>
    `Sound decoded on this ${computer}, up to 7.1, for whatever is plugged in.`,
  passthroughLabel: 'Receiver passthrough',
  passthroughHint: 'Dolby Digital and DTS go to the receiver as they are, for it to decode.',
  headphonesLabel: 'Headphones',
  headphonesHint: 'Mixed down to stereo, or spatial on AirPods.',
  saved: 'Sound output saved. It applies to the video you play next.',
  unsaved: 'Raven could not save the sound output. Try again.',
  engineNotRunning: "Raven's video engine is not running, so the sound settings wait until it is.",
  soundOutput: 'Sound output',
  formats: 'Formats your receiver decodes',
  passthroughNote:
    'macOS passes Dolby Digital and DTS core to the receiver; TrueHD, DTS-HD MA and E-AC3 play as PCM.',
  volumeOnReceiver: 'Volume is set on your receiver.',
  noFormats: 'No formats chosen, so sound plays as PCM.',
  spatial: 'Spatial audio (AirPods)',
  outputDevice: 'Output device',
  systemDefault: 'System default',
  noDeviceList: 'Device list unavailable.',
} as const

export const UPDATES_SECTION_COPY = {
  title: 'Updates',
  help: 'Raven asks GitHub for its newest release and sends nothing else. It never installs one by itself.',
  unreadable: 'Raven could not read its update settings.',
  unchanged: 'Raven could not change its update check. Try again.',
  unchecked: 'Raven could not check for updates. Try again.',
  unopened: 'Raven could not open the release page. Try again.',
  checkDaily: 'Check for updates once a day',
  version: (current: string) => `This is Raven ${current}.`,
  notChecked: 'Not checked yet.',
  lastChecked: (at: string) => `Last checked ${at}.`,
  checkNow: 'Check now',
  whatsNew: "See what's new",
} as const
