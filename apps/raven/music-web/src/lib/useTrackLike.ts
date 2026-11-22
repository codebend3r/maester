import type { Track } from '@raven/core'
import { useTrackFavourite } from '@raven/ui/headless'
import type { MenuLike } from '@raven/wren'
import { api } from '@/lib/api'
import { queries } from '@/lib/queries'
import { toastFailure } from '@/stores/toast'

type UseTrackLikeProps = { track: Track }

/**
 * A song's heart over the page's one `api`: whether it is a favourite, and the press that turns
 * it on or off, a failure said in a toast. The row that holds it hands it to its menu, so the
 * heart and the menu's Like show the same state while a press is on its way.
 */
export const useTrackLike = ({ track }: UseTrackLikeProps): MenuLike =>
  useTrackFavourite({ api, queries, track, onFailure: toastFailure })
