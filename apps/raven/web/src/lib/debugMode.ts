import { useSearchParams } from 'react-router-dom'

/** The address's switch for debug mode: `?debug=true`. */
const DEBUG_PARAM = { name: 'debug', on: 'true' } as const

/**
 * Whether the site is in debug mode, which only `?debug=true` in the
 * address turns on: nothing keeps it, so it ends with the address that names it.
 */
export const useIsDebugMode = (): boolean => {
  const [searchParams] = useSearchParams()
  return searchParams.get(DEBUG_PARAM.name) === DEBUG_PARAM.on
}
