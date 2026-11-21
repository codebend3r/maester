import { parseCookies } from '@shared/http'
import { AUTH_CONFIG_STATES, type AuthConfig } from '@/contract'

/** The server's auth config once accounts are on: what a browser builds its Supabase client from. */
export type ReadyAuthConfig = Extract<AuthConfig, { state: typeof AUTH_CONFIG_STATES.ready }>

type HasSessionCookieProps = {
  /** A browser's `document.cookie`. */
  cookies: string
  cookieName: string
}

/**
 * Whether the browser holds a Supabase session at all: Supabase keeps it in the cookie the config
 * names, split into `<name>.0`, `<name>.1` and on when it is long. Without one nobody is signed
 * in, which a page can say before Supabase's code has loaded.
 */
export const hasSessionCookie = ({ cookies, cookieName }: HasSessionCookieProps): boolean =>
  parseCookies({ header: cookies }).some(
    ({ name }) => name === cookieName || name.startsWith(`${cookieName}.`),
  )
