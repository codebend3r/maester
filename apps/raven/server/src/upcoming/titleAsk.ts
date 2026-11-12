import { NotFoundException } from '@nestjs/common'
import { isTitleRequestAsk, type TitleRequestAsk } from '@raven/core'

type TitleAskOfProps = { type: string; tmdbId: string }

/** A title's route parameters as a movie or show and its TMDB id, or a 404 for an address that names none. */
export const titleAskOf = ({ type, tmdbId }: TitleAskOfProps): TitleRequestAsk => {
  const ask = { type, tmdbId }
  if (!isTitleRequestAsk(ask)) throw new NotFoundException(`No ${type} ${tmdbId}`)
  return ask
}
