import { isPosterEntry } from '@/contract/home'
import { isShowEntry } from '@/contract/items'
import { type Infer, isNumber, listOf, object } from '@/schema'

/** A show with Dolby Vision profile 5 episodes: how many of its episodes on disk are. */
export const isDolbyVisionOnlyShow = object({ entry: isShowEntry, episodes: isNumber })

export type DolbyVisionOnlyShow = Infer<typeof isDolbyVisionOnlyShow>

/**
 * `GET /api/libraries/:id/dolby-vision`: what in a library is Dolby Vision
 * profile 5, which a browser plays purple and green. Its shows by title, each
 * with how many of its episodes are, and every other such file (a movie's, or
 * an episode matched to no show) with its card's poster, by title.
 */
export const isDolbyVisionOnlyListing = object({
  shows: listOf(isDolbyVisionOnlyShow),
  files: listOf(isPosterEntry),
})

export type DolbyVisionOnlyListing = Infer<typeof isDolbyVisionOnlyListing>
