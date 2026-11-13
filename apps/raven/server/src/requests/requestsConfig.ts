import { ITEM_TYPES, type MatchItemType } from '@raven/core'
import { atLeast, text } from '@shared/server'

/**
 * The environment Coming soon's requests read. The arr names are the ones
 * raven's `.env` already holds, which name the NAS each arr runs on.
 */
export const REQUESTS_ENV = {
  sonarrUrl: 'SONARR_VERMITHOR_URL',
  sonarrKey: 'SONARR_VERMITHOR_API_KEY',
  radarrUrl: 'RADARR_VERMITHOR_URL',
  radarrKey: 'RADARR_VERMITHOR_API_KEY',
  movieFolder: 'REQUEST_MOVIE_FOLDER',
  showFolder: 'REQUEST_SHOW_FOLDER',
  qualityProfile: 'REQUEST_QUALITY_PROFILE',
  dailyLimit: 'REQUEST_DAILY_LIMIT',
} as const

/** Where a requested title's letter folders sit when nothing says otherwise: the library's own. */
const DEFAULT_FOLDERS = {
  [ITEM_TYPES.movie]: '/Meleys/Movies',
  [ITEM_TYPES.show]: '/Vermithor/TV',
} as const satisfies Record<MatchItemType, string>

/** The quality profile most of the library was added with. */
const DEFAULT_QUALITY_PROFILE = 'HD-1080p'

/** How many requests an account may make in 24 hours unless `REQUEST_DAILY_LIMIT` says otherwise. */
const DEFAULT_DAILY_LIMIT = 10

/** One Sonarr or Radarr: its address, without a trailing slash, and its API key. Never logged. */
export type ArrServer = { url: string; apiKey: string }

/** Coming soon's requests: the arr for each kind of title (null while it is not set up) and the rules. */
export type RequestsConfig = {
  arrs: Record<MatchItemType, ArrServer | null>
  /** The folder whose letter folders (`<folder>/B`, `<folder>/#`) each kind is added under. */
  folders: Record<MatchItemType, string>
  /** The quality profile a requested title is added with, by name. */
  qualityProfile: string
  dailyLimit: number
}

type ArrServerOfProps = { url: string | undefined; apiKey: string | undefined }

const arrServerOf = ({ url, apiKey }: ArrServerOfProps): ArrServer | null => {
  const address = url?.trim().replace(/\/+$/u, '') ?? ''
  const key = apiKey?.trim() ?? ''
  if (address === '' || key === '') return null
  return { url: address, apiKey: key }
}

const folderOf = (value: string | undefined): string | null => {
  const folder = value?.trim().replace(/\/+$/u, '') ?? ''
  return folder === '' ? null : folder
}

export const readRequestsConfig = (env: NodeJS.ProcessEnv): RequestsConfig => ({
  arrs: {
    [ITEM_TYPES.movie]: arrServerOf({
      url: env[REQUESTS_ENV.radarrUrl],
      apiKey: env[REQUESTS_ENV.radarrKey],
    }),
    [ITEM_TYPES.show]: arrServerOf({
      url: env[REQUESTS_ENV.sonarrUrl],
      apiKey: env[REQUESTS_ENV.sonarrKey],
    }),
  },
  folders: {
    [ITEM_TYPES.movie]:
      folderOf(env[REQUESTS_ENV.movieFolder]) ?? DEFAULT_FOLDERS[ITEM_TYPES.movie],
    [ITEM_TYPES.show]: folderOf(env[REQUESTS_ENV.showFolder]) ?? DEFAULT_FOLDERS[ITEM_TYPES.show],
  },
  qualityProfile: text({
    value: env[REQUESTS_ENV.qualityProfile],
    fallback: DEFAULT_QUALITY_PROFILE,
  }),
  dailyLimit: atLeast({
    value: env[REQUESTS_ENV.dailyLimit],
    min: 1,
    fallback: DEFAULT_DAILY_LIMIT,
  }),
})
