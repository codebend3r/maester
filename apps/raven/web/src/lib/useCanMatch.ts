import { useQuery } from '@tanstack/react-query'
import { METADATA_SERVICE_STATES } from '@raven/core'
import { metadataHealthQuery } from '@/lib/queries'

type UseCanMatchProps = {
  /** Whether to ask the server at all: a library nothing is matched in has no need to. */
  isEnabled?: boolean
}

/** Whether TMDB answers, so files can be matched: they only leave pending while it does. */
export const useCanMatch = ({ isEnabled = true }: UseCanMatchProps = {}): boolean => {
  const metadata = useQuery({ ...metadataHealthQuery, enabled: isEnabled })
  return (metadata.data?.tmdb ?? null) === METADATA_SERVICE_STATES.ok
}
