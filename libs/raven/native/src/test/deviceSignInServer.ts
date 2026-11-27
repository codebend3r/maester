import {
  ACCOUNT_RPC_PATH,
  AUTH_CONFIG_STATES,
  AUTH_COOKIE,
  AUTH_PATHS,
  DEVICE_CLAIM_STATUSES,
  DEVICE_SIGN_IN_RPCS,
  type DeviceClaim,
  type DeviceSession,
} from '@raven/core'

const WEB_HOST = 'raven.test'

const PENDING: DeviceClaim = { status: DEVICE_CLAIM_STATUSES.pending }

/** What the fake answers by path; any other path is the Edge Function's claim. */
const ANSWERS: Record<string, unknown> = {
  [AUTH_PATHS.config]: {
    state: AUTH_CONFIG_STATES.ready,
    supabaseUrl: 'https://project.test',
    publishableKey: 'sb_publishable_test',
    webUrl: `https://${WEB_HOST}`,
    cookieName: AUTH_COOKIE,
  },
  [`${ACCOUNT_RPC_PATH}${DEVICE_SIGN_IN_RPCS.start}`]: [
    { device_code: 'a'.repeat(64), user_code: 'BCDFGHJK', expires_in: 600, poll_interval: 0 },
  ],
}

type FetchInput = Parameters<typeof fetch>[0]

/**
 * A raven server and its Supabase project that offer a TV a code to scan, for a test to stand in
 * for the platform's `fetch`: the code is `BCDF-GHJK`, approved at `address`, and it waits until
 * `approve` hands the next ask a session. `reset` makes it wait again.
 */
export const fakeDeviceSignInServer = () => {
  const held: { claim: DeviceClaim } = { claim: PENDING }
  return {
    /** The approve page as the TV shows it. */
    address: `${WEB_HOST}/link`,
    /** The code as the TV says it aloud. */
    spokenCode: 'B C D F G H J K',
    fetch: async (input: FetchInput): Promise<Response> => {
      const { pathname } = new URL(String(input))
      return Response.json(ANSWERS[pathname] ?? held.claim)
    },
    reset: (): void => {
      held.claim = PENDING
    },
    approve: (session: DeviceSession): void => {
      held.claim = { status: DEVICE_CLAIM_STATUSES.approved, session }
    },
  }
}
