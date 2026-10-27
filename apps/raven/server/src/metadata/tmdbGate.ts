import { ServiceUnavailableException } from '@nestjs/common'
import { type TmdbClient, TmdbError } from '@/metadata/tmdbClient'

/** A TMDB failure as a route answers it: 503 with TMDB's own word; anything else is thrown on. */
export const tmdbUnavailable = (error: unknown): never => {
  if (error instanceof TmdbError) throw new ServiceUnavailableException(error.message)
  throw error
}

type RequireTmdbProps = {
  tmdb: Pick<TmdbClient, 'enabled'>
  /** What the route would do with TMDB, for the 503: "search TMDB", "fetch details from TMDB". */
  toDo: string
}

/** 503 unless there is a TMDB token it has not refused. */
export const requireTmdb = ({ tmdb, toDo }: RequireTmdbProps): void => {
  if (!tmdb.enabled) throw new ServiceUnavailableException(`Set TMDB_API_TOKEN to ${toDo}.`)
}
