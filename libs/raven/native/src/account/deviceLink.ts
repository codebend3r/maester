import {
  DEVICE_CLAIM_STATUSES,
  type DeviceClaim,
  type DeviceSession,
  type DeviceSignIn,
  type FetchLike,
  createDeviceSignInClient,
  deviceLinkUrl,
  shownDeviceCode,
  spokenDeviceCode,
} from '@raven/core'

import { readSupabaseConfig } from '@/account/supabaseAuth'

/** What a TV's sign-in screen shows of signing in by code: a code to scan, or one that ran out. */
export const DEVICE_LINK_STATES = { ready: 'ready', expired: 'expired' } as const

/** The code a TV's sign-in screen shows; a screen with none to show holds null. */
export type DeviceLink =
  | {
      kind: typeof DEVICE_LINK_STATES.ready
      /** The code as it is read off the screen, `BCDF-GHJK`. */
      code: string
      /** What the QR code holds: the approve page with the code filled in. */
      url: string
      /** The approve page as a viewer types it, with no scheme: `raven.example/link`. */
      address: string
    }
  | { kind: typeof DEVICE_LINK_STATES.expired }

/** What each TV app's panel for a code is handed, raven's and Wren's alike. */
export type ScanPanelProps = {
  link: DeviceLink
  /** Asks for a new code once the last ran out. */
  onRenew: () => void
}

/** Sign-in's code to scan, in the words every TV app says it in. */
export const DEVICE_SCAN_COPY = {
  title: 'Scan to sign in',
  note: "Point your phone's camera at the code, then approve this TV. No typing.",
  /** What the QR code is called aloud. */
  qrLabel: 'QR code that opens the approve page on your phone',
  orOpen: (address: string) => `Or open ${address} and enter`,
  /** The code aloud, a letter at a time. */
  codeLabel: (code: string) => `Code ${spokenDeviceCode(code)}`,
  expired: 'That code ran out.',
  renew: 'Show a new code',
} as const

/*
 * How many codes a screen left open shows, one after another, before it stops asking: half an
 * hour of them, so a TV left on its sign-in screen does not ask the database all night.
 */
const CODES_PER_WATCH = 3

const SCHEME = /^https?:\/\//

/** A started sign-in, where its code is approved, and the ask whether it has been. */
export type OpenedDeviceSignIn = DeviceSignIn & {
  webUrl: string
  /** Asks whether the code was approved; null for an ask that got no answer. */
  claim: () => Promise<DeviceClaim | null>
}

type WatchDeviceSignInProps = {
  /** Starts a sign-in; null where the server offers none, so the screen shows no code. */
  open: () => Promise<OpenedDeviceSignIn | null>
  wait: (ms: number) => Promise<void>
  now: () => number
  /** True once the screen has gone, so nothing more is asked or said. */
  isStopped: () => boolean
  /** The code to show now, or null where the server offers none. */
  onLink: (link: DeviceLink | null) => void
}

/** An opened sign-in to keep asking about, and the moment its code runs out. */
type AskProps = { opened: OpenedDeviceSignIn; until: number }

/**
 * Shows a code and asks until it is approved, answering the approver's session. A code that ran
 * out or was spent is followed by a new one, `CODES_PER_WATCH` in all, and then the screen is
 * told the code expired, for the viewer to ask again. Null when it stopped or no code is offered.
 */
export const watchDeviceSignIn = ({
  open,
  wait,
  now,
  isStopped,
  onLink,
}: WatchDeviceSignInProps): Promise<DeviceSession | null> => {
  const ask = async ({ opened, until }: AskProps): Promise<DeviceSession | null> => {
    await wait(opened.pollMs)
    if (isStopped() || now() >= until) return null
    const answer = await opened.claim()
    if (isStopped() || answer?.status === DEVICE_CLAIM_STATUSES.gone) return null
    if (answer?.status === DEVICE_CLAIM_STATUSES.approved) return answer.session
    return ask({ opened, until })
  }

  const show = async (codesLeft: number): Promise<DeviceSession | null> => {
    if (codesLeft === 0) {
      onLink({ kind: DEVICE_LINK_STATES.expired })
      return null
    }
    const opened = await open()
    if (isStopped()) return null
    if (opened === null) {
      onLink(null)
      return null
    }
    onLink({
      kind: DEVICE_LINK_STATES.ready,
      code: shownDeviceCode(opened.userCode),
      url: deviceLinkUrl({ webUrl: opened.webUrl, code: opened.userCode }),
      address: deviceLinkUrl({ webUrl: opened.webUrl }).replace(SCHEME, ''),
    })
    const session = await ask({ opened, until: now() + opened.expiresInMs })
    if (session !== null || isStopped()) return session
    return show(codesLeft - 1)
  }

  return show(CODES_PER_WATCH)
}

type OpenDeviceSignInProps = {
  /** The raven server the account signs in to, whose auth config names the database and the web. */
  origin: string
  /** What the approver is shown, as "Raven on Apple TV". */
  deviceName: string
  fetch: FetchLike
}

/**
 * `watchDeviceSignIn`'s `open` against the server's own Supabase project, read afresh for each
 * code: the sign-in it starts asks about its code through the client that started it.
 */
export const openDeviceSignIn = async ({
  origin,
  deviceName,
  fetch,
}: OpenDeviceSignInProps): Promise<OpenedDeviceSignIn | null> => {
  const config = await readSupabaseConfig({ origin }).catch(() => null)
  if (config === null) return null
  const client = createDeviceSignInClient({ ...config, fetch })
  const started = await client.start({ deviceName })
  if (started === null) return null
  return {
    ...started,
    webUrl: config.webUrl,
    claim: () => client.claim({ deviceCode: started.deviceCode }),
  }
}
