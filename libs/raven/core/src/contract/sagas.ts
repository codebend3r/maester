import { isMediaList } from '@/contract/items'
import { type Infer, isNumber, isString, listOf, object, oneOf, union } from '@/schema'

/** How a saga's slideshow moves from one movie's backdrop to the next. */
export const SLIDESHOW_MOTIONS = { fade: 'fade', kenBurns: 'kenBurns', slide: 'slide' } as const

export const isSlideshowMotion = oneOf(Object.values(SLIDESHOW_MOTIONS))

export type SlideshowMotion = Infer<typeof isSlideshowMotion>

export const SAGA_BACKDROP_TYPES = { slideshow: 'slideshow', still: 'still' } as const

/**
 * What a saga's page shows behind its title: its movies' backdrops in turn,
 * first to last and round again, or the one of them picked, held still.
 * `PUT /api/libraries/:id/sagas/:sagaId/backdrop` takes it and answers with it.
 */
export const isSagaBackdrop = union(
  object({ type: oneOf([SAGA_BACKDROP_TYPES.slideshow]), motion: isSlideshowMotion }),
  object({ type: oneOf([SAGA_BACKDROP_TYPES.still]), itemId: isNumber }),
)

export type SagaBackdrop = Infer<typeof isSagaBackdrop>

/** A saga's backdrop until its library picks another. */
export const DEFAULT_SAGA_BACKDROP: SagaBackdrop = {
  type: SAGA_BACKDROP_TYPES.slideshow,
  motion: SLIDESHOW_MOTIONS.fade,
}

/**
 * A saga: a TMDB collection (The Lord of the Rings Collection, say) and the
 * movies of it a library holds, oldest first, one entry each, its best file.
 * The pictures its backdrop shows are read off them by `sagaPictures`.
 */
export const isSaga = object({
  tmdbId: isString,
  name: isString,
  backdrop: isSagaBackdrop,
  media: isMediaList,
})

export type Saga = Infer<typeof isSaga>

/** `GET /api/libraries/:id/sagas`: a library's sagas of two movies or more, by name. */
export const isSagaList = listOf(isSaga)
