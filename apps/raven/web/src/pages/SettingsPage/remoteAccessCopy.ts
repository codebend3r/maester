import {
  REACHABILITY_PROBLEMS,
  REMOTE_ACCESS_STATES,
  type ReachabilityProblem,
  type RemoteAccessStatus,
} from '@raven/core'

type StreamsHintProps = { quality: string; streams: number }

type CheckedAtProps = { at: string }

/** The words of Admin's Remote Access section, modelled on Plex's settings of that name. */
export const REMOTE_ACCESS_COPY = {
  heading: 'Remote Access',
  help: 'How raven is reached from outside your home network: a port your router forwards to the NAS, a hostname with a trusted certificate, and how much of your upload a remote viewer may take.',
  route: 'How raven is reached',
  privateLabel: 'Private',
  publicLabel: 'Public',
  internet: 'Internet',
  unknownAddress: 'Not known yet',
  noPort: 'No port',
  enable: 'Enable remote access',
  enableHint: 'Offers the public address below to every app away from home.',
  hostname: 'Public hostname',
  hostnameHint:
    'The name your certificate is for, such as your Synology DDNS name. A name, never an IP address: the address may change.',
  publicPort: 'Manually specify public port',
  publicPortHint: 'The port your router forwards from the internet.',
  privatePort: 'Private port',
  privatePortHint:
    "The port on the NAS the router forwards to: the reverse proxy rule's. Blank when it is the same as the public port.",
  privatePortPlaceholder: 'Same as public',
  uploadMbps: 'Internet upload speed (Mbps)',
  uploadHint:
    'A remote stream may use all of it, as with Plex. Players away from home transcode a file over this or the limit below.',
  remoteLimit: 'Limit remote stream bitrate',
  remoteLimitHint:
    'Viewers away from home play a file over this size as a transcode at it; one under it plays as it is.',
  original: 'Original (No limit)',
  streamsHint: ({ quality, streams }: StreamsHintProps) =>
    `Remote transcodes are held to ${quality}; your upload carries ${streams} at once.`,
  apply: 'Apply',
  checkAgain: 'Check again',
  checking: 'Checking from outside your network',
  checkedAt: ({ at }: CheckedAtProps) => `Checked ${at}.`,
  notForwarded:
    "raven can not see the addresses of viewers away from home, so it can not tell them apart or from home. Add an X-Forwarded-For header to the reverse proxy rule, and name the proxy's address in RAVEN_TRUSTED_PROXIES.",
} as const

/** The status line: what the outside check found, or why it could not look. */
export const REMOTE_ACCESS_STATUS_COPY = {
  [REMOTE_ACCESS_STATES.disabled]: 'Remote access is off.',
  [REMOTE_ACCESS_STATES.unconfigured]:
    'Enter a public hostname and port to reach raven outside your network.',
  [REMOTE_ACCESS_STATES.unchecked]:
    'raven cannot check from outside your network: set RAVEN_WEB_URL and RAVEN_PROXY_SECRET on the server.',
  [REMOTE_ACCESS_STATES.reachable]: 'Fully accessible outside your network',
  [REMOTE_ACCESS_STATES.unreachable]: 'Not reachable outside your network',
} as const satisfies Record<RemoteAccessStatus['state'], string>

/** What went wrong, in words the owner can act on. */
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
