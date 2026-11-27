import { type Infer, isNumber, isString, listOf, matching, object, tagged } from '@/schema'

/**
 * Signing in on a TV by scanning a code: the TV starts a sign-in and shows its user code, in a QR
 * code and as text; a phone already signed in to raven's web app approves it at `DEVICE_LINK_PATH`;
 * the TV, asking all the while, is handed a session of the approver's. The database's side is
 * `@raven/supabase`'s `device_sign_ins` migration and its `device-sign-in` Edge Function.
 */
export const DEVICE_SIGN_IN_RPCS = {
  start: 'start_device_sign_in',
  request: 'device_sign_in_request',
  approve: 'approve_device_sign_in',
} as const

/** The functions' argument names, as the database declares them. */
export const DEVICE_SIGN_IN_ARGS = { deviceName: 'device_name', code: 'code' } as const

/** The web page a scanned code opens, and the query key the code rides in. */
export const DEVICE_LINK_PATH = '/link'
export const DEVICE_LINK_PARAM = 'code'

/** The letters a code is made of: consonants only, so none spells a word. */
const CODE_LETTERS = 'BCDFGHJKLMNPQRSTVWXZ'
const CODE_LENGTH = 8
const CODE_HALF = CODE_LENGTH / 2
const CODE_PATTERN = new RegExp(`^[${CODE_LETTERS}]{${CODE_LENGTH}}$`)
const NOT_A_LETTER = /[^A-Z]/g

/**
 * A code as the database keeps it, from one typed or scanned in any case, with or without its
 * dash; null for anything that is not a whole code.
 */
export const cleanDeviceCode = (typed: string): string | null => {
  const letters = typed.toUpperCase().replace(NOT_A_LETTER, '')
  return CODE_PATTERN.test(letters) ? letters : null
}

/** A code as a screen shows it and a voice reads it: two groups of four, `BCDF-GHJK`. */
export const shownDeviceCode = (code: string): string =>
  `${code.slice(0, CODE_HALF)}-${code.slice(CODE_HALF)}`

/** A shown code a letter at a time, `B C D F G H J K`, so a screen reader does not say it as a word. */
export const spokenDeviceCode = (shown: string): string =>
  Array.from(shown.replace('-', '')).join(' ')

/** What `start_device_sign_in` answers: one row, in the database's names, its clock in seconds. */
export const isStartedDeviceSignIns = listOf(
  object({
    device_code: isString,
    user_code: matching(CODE_PATTERN),
    expires_in: isNumber,
    poll_interval: isNumber,
  }),
)

export const DEVICE_CLAIM_STATUSES = {
  pending: 'pending',
  approved: 'approved',
  gone: 'gone',
} as const

const isDeviceSession = object({
  accessToken: isString,
  refreshToken: isString,
  expiresIn: isNumber,
  userId: isString,
  email: isString,
})

/** The session an approved TV is handed, in the Edge Function's names. */
export type DeviceSession = Infer<typeof isDeviceSession>

/** The field a claim's answer names its status in, which tells the three answers apart. */
export const DEVICE_CLAIM_TAG = { status: 'status' } as const

export const isDeviceClaim = tagged({
  tag: DEVICE_CLAIM_TAG.status,
  variants: {
    [DEVICE_CLAIM_STATUSES.pending]: {},
    [DEVICE_CLAIM_STATUSES.approved]: { session: isDeviceSession },
    [DEVICE_CLAIM_STATUSES.gone]: {},
  },
})

/** What a waiting TV hears: nobody has approved yet, the session, or a code that no longer stands. */
export type DeviceClaim = Infer<typeof isDeviceClaim>
