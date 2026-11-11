import {
  DIRECT_PLAYS,
  HW_ACCELS,
  MAX_HEIGHTS,
  MEMBER_STATUSES,
  QUALITIES,
  REACHABILITY_PROBLEMS,
  REMOTE_ACCESS_STATES,
  type ReachabilityProblem,
  type RemoteAccessStatus,
  TITLE_DISPLAYS,
  TRANSCODINGS,
} from '@raven/core'

type RunningProps = { library: string; work: string }

type TabLabelProps = { status: string; count: number }

type NamedProps = { label: string; library: string }

const albumWordOf = (count: number): string => (count === 1 ? 'album' : 'albums')

type CouldNotProps = { verb: string; message: string }

/** The words of the owner's settings, the web's Admin page's own. */
export const ADMIN_COPY = {
  heading: 'Admin',
  help: 'How the server works for every viewer. Only the owner sees these.',
  resetToDefaults: 'Reset to defaults',
  resetConfirm: 'Every setting goes back to its default.',
  resetAll: 'Reset all',
  resetDone: 'Every setting is back to its default.',
  resetFailed: 'Could not reset: ',
  cancel: 'Cancel',
  saveFailed: 'Could not save: ',
  reading: 'Reading the settings',
  playback: 'Playback',
  playbackHint:
    'How the server plays video, for every viewer. A change takes effect on the next play.',
  directPlay: 'Play the original file',
  transcoding: 'Server conversion',
  maxHeight: 'Transcode size',
  quality: 'Transcode quality',
  hwAccel: 'Hardware acceleration',
  encodesWith: (encoder: string) => `Transcodes encode with ${encoder} right now.`,
  tonemap: 'Tone map HDR to SDR on a transcode',
  tonemapHint: 'Colours are mapped for an SDR screen; off, HDR goes out as it is and looks flat.',
  tonemapUnavailable: 'This ffmpeg cannot tone map, so HDR goes out as it is whatever this says.',
  detectMarkers: 'Find intros and credits',
  detectMarkersHint:
    "Listens to each season in the background for the intro and end theme its episodes share, and looks for each film's credits crawl, so players offer Skip intro and count down to what is next from the credits.",
  display: 'Display',
  displayHint: 'How pages look, for every viewer.',
  movieTitles: 'Movie titles',
  scans: 'Library scans',
  scansHint:
    'Shows scans running across every library. Cancelling stops only the work running now; scans can be started again from each library.',
  stopScans: 'Cancel all running scans',
  noScans: 'No scan is running.',
  running: ({ library, work }: RunningProps) => `${library}: ${work}`,
  ratingsWork: 'Updating ratings',
  users: 'Users',
  usersHint: 'Who may use this raven. Each new account waits here until you approve it.',
  accounts: 'Accounts',
  owner: 'Owner',
  changeFailed: 'Could not change access: ',
  confirmRemove: 'Remove access for this account?',
  yesRemove: 'Yes, remove',
  yesRemoveFor: (email: string) => `Yes, remove access for ${email}`,
  cancelRemovingFor: (email: string) => `Cancel removing ${email}`,
  approve: 'Approve',
  approveFor: (email: string) => `Approve ${email}`,
  remove: 'Remove access',
  removeFor: (email: string) => `Remove access for ${email}`,
  tabLabel: ({ status, count }: TabLabelProps) => `${status} (${count})`,
} as const

/** What each value of a server playback setting is called, as the web's Admin names it. */
export const DIRECT_PLAY_LABELS = {
  [DIRECT_PLAYS.auto]: 'When the browser can',
  [DIRECT_PLAYS.force]: 'Always',
} as const

export const TRANSCODING_LABELS = {
  [TRANSCODINGS.on]: 'Remux and transcode',
  [TRANSCODINGS.remuxOnly]: 'Remux only',
  [TRANSCODINGS.off]: 'Off',
} as const

export const MAX_HEIGHT_LABELS = {
  [MAX_HEIGHTS.uhd]: '4K',
  [MAX_HEIGHTS.fullHd]: '1080p',
  [MAX_HEIGHTS.hd]: '720p',
} as const

export const QUALITY_LABELS = {
  [QUALITIES.low]: 'Low',
  [QUALITIES.medium]: 'Medium',
  [QUALITIES.high]: 'High',
} as const

export const HW_ACCEL_LABELS = {
  [HW_ACCELS.auto]: 'Auto',
  [HW_ACCELS.none]: 'CPU only',
  [HW_ACCELS.vaapi]: 'VAAPI',
  [HW_ACCELS.videotoolbox]: 'VideoToolbox',
} as const

export const TITLE_LABELS = {
  [TITLE_DISPLAYS.logo]: 'Logo',
  [TITLE_DISPLAYS.text]: 'Text',
} as const

export const ENCODER_NAMES = {
  software: 'libx264 on the CPU',
  vaapi: 'VAAPI',
  videotoolbox: 'VideoToolbox',
} as const

/** The tabs of the web's Users section, each a list here. */
export const MEMBER_STATUS_LABELS = {
  [MEMBER_STATUSES.pending]: 'Pending',
  [MEMBER_STATUSES.approved]: 'Approved',
  [MEMBER_STATUSES.revoked]: 'Removed',
} as const

export const NOBODY_LABELS = {
  [MEMBER_STATUSES.pending]: 'No one is waiting for approval.',
  [MEMBER_STATUSES.approved]: 'No one is approved yet.',
  [MEMBER_STATUSES.revoked]: 'No one has been removed.',
} as const

/** Remote Access's words, the web's where the app shows the same thing, to read only. */
export const REMOTE_ACCESS_COPY = {
  heading: 'Remote Access',
  help: 'How raven is reached from outside your home network. Change it in raven on the web or the desktop.',
  privateLabel: 'Private',
  publicLabel: 'Public',
  unknownAddress: 'Not known yet',
  noPort: 'No port',
  remoteLimit: 'Remote stream limit',
  original: 'Original (No limit)',
  checkedAt: (at: string) => `Checked ${at}.`,
} as const

export const REMOTE_ACCESS_STATUS_COPY = {
  [REMOTE_ACCESS_STATES.disabled]: 'Remote access is off.',
  [REMOTE_ACCESS_STATES.unconfigured]:
    'No public hostname and port are set, so raven is not reached from outside your network.',
  [REMOTE_ACCESS_STATES.unchecked]:
    'raven cannot check from outside your network: set RAVEN_WEB_URL and RAVEN_PROXY_SECRET on the server.',
  [REMOTE_ACCESS_STATES.reachable]: 'Fully accessible outside your network',
  [REMOTE_ACCESS_STATES.unreachable]: 'Not reachable outside your network',
} as const satisfies Record<RemoteAccessStatus['state'], string>

export const REACHABILITY_PROBLEM_COPY = {
  [REACHABILITY_PROBLEMS.dns]: 'The hostname does not resolve. Check the DDNS record.',
  [REACHABILITY_PROBLEMS.privateAddress]:
    'The hostname points at a private address, which the internet cannot reach. Point it at your public address.',
  [REACHABILITY_PROBLEMS.refused]:
    'The connection was refused. Check the port forward and that the reverse proxy listens on the private port.',
  [REACHABILITY_PROBLEMS.timeout]:
    'Nothing answered in time. Check the port forward and the firewall; behind CGNAT no forward can work.',
  [REACHABILITY_PROBLEMS.certificate]:
    'Something answered, but its certificate is not trusted for the hostname. Give the reverse proxy rule its certificate.',
  [REACHABILITY_PROBLEMS.notRaven]:
    'Something answered on that port, but not this raven. Check where the port forward and the reverse proxy point.',
  [REACHABILITY_PROBLEMS.checkerFailed]:
    'The check from outside could not run. Try again in a moment.',
} as const satisfies Record<ReachabilityProblem, string>

/** A library's long actions, the web's library actions' words. */
export const LIBRARY_ACTIONS_COPY = {
  quickScan: 'Quick scan',
  fullScan: 'Full scan',
  scanMarkers: 'Scan intros and credits',
  mergeAlbums: 'Merge duplicate albums',
  updateRatings: 'Update ratings',
  matchAgain: 'Match again',
  cancel: (label: string) => `Cancel ${label.toLowerCase()}`,
  named: ({ label, library }: NamedProps) => `${label} ${library}`,
  couldNot: ({ verb, message }: CouldNotProps) => `Could not ${verb}: ${message}`,
  markersQueued: 'Intro and credits scan queued.',
  noAlbumsMerged: 'No duplicate albums found.',
  albumsMerged: (count: number) => `Merged ${count} duplicate ${albumWordOf(count)}.`,
} as const
