import { CONTENT_TYPES, HEADERS, HTTP_METHODS } from '@shared/http'
import { createPostgrest } from '@/accountData/postgrest'
import { type FetchLike, readJson } from '@/apiClient/transport'
import {
  AUTH_HEADERS,
  DEVICE_LINK_PARAM,
  DEVICE_LINK_PATH,
  DEVICE_SIGN_IN_ARGS,
  DEVICE_SIGN_IN_RPCS,
  type DeviceClaim,
  isDeviceClaim,
  isStartedDeviceSignIns,
  shownDeviceCode,
} from '@/contract'
import { toQueryString, withoutTrailingSlash } from '@/query'

// Where the Edge Function that answers a waiting TV is served, under the project's address.
const DEVICE_SIGN_IN_FUNCTION_PATH = '/functions/v1/device-sign-in'

const MS_PER_SECOND = 1000

type DeviceLinkUrlProps = {
  /** raven's web address, `webUrl` in the server's `GET /api/auth/config`. */
  webUrl: string
  /** Left out for the address a viewer types by hand, which then asks for the code. */
  code?: string
}

/** Where a phone approves a code: the address the QR code holds, or the one read off the screen. */
export const deviceLinkUrl = ({ webUrl, code }: DeviceLinkUrlProps): string => {
  const page = `${withoutTrailingSlash(webUrl)}${DEVICE_LINK_PATH}`
  return code === undefined
    ? page
    : `${page}?${toQueryString({ [DEVICE_LINK_PARAM]: shownDeviceCode(code) })}`
}

/** A sign-in a TV has started: the secret it keeps, the code it shows, and its clock. */
export type DeviceSignIn = {
  deviceCode: string
  userCode: string
  /** How long the code stands, from when it was made. */
  expiresInMs: number
  /** How long to wait between asks. */
  pollMs: number
}

type CreateDeviceSignInClientProps = {
  supabaseUrl: string
  publishableKey: string
  fetch: FetchLike
}

type StartProps = { deviceName: string }

type ClaimProps = { deviceCode: string }

/**
 * The TV's two calls, made signed out with the publishable key alone. `start` answers null when
 * the project has no such function yet (an older database) or does not answer, so a screen simply
 * offers no code; `claim` answers null for an ask that got no answer, which the TV asks again.
 */
export const createDeviceSignInClient = ({
  supabaseUrl,
  publishableKey,
  fetch,
}: CreateDeviceSignInClientProps) => {
  const rest = createPostgrest({
    supabaseUrl,
    publishableKey,
    accessToken: async () => null,
    fetch,
  })
  const claimUrl = `${withoutTrailingSlash(supabaseUrl)}${DEVICE_SIGN_IN_FUNCTION_PATH}`

  return {
    start: async ({ deviceName }: StartProps): Promise<DeviceSignIn | null> => {
      try {
        const [row] = await rest.rpc({
          name: DEVICE_SIGN_IN_RPCS.start,
          args: { [DEVICE_SIGN_IN_ARGS.deviceName]: deviceName },
          guard: isStartedDeviceSignIns,
        })
        if (row === undefined) return null
        return {
          deviceCode: row.device_code,
          userCode: row.user_code,
          expiresInMs: row.expires_in * MS_PER_SECOND,
          pollMs: row.poll_interval * MS_PER_SECOND,
        }
      } catch {
        return null
      }
    },

    claim: async ({ deviceCode }: ClaimProps): Promise<DeviceClaim | null> => {
      try {
        const response = await fetch(claimUrl, {
          method: HTTP_METHODS.post,
          headers: {
            [HEADERS.accept]: CONTENT_TYPES.json,
            [HEADERS.contentType]: CONTENT_TYPES.json,
            [AUTH_HEADERS.apiKey]: publishableKey,
          },
          body: JSON.stringify({ deviceCode }),
        })
        if (!response.ok) return null
        const body = await readJson(response)
        return isDeviceClaim(body) ? body : null
      } catch {
        return null
      }
    },
  }
}
