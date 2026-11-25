import type { Track } from '@raven/core'
import { useTrackFavourite } from '@raven/ui/headless'
import type { MenuLike } from '@raven/wren'

import { toastFailure } from '@/stores/toast'
import type { WrenSession } from '@/useWren'

type UseTrackLikeProps = { session: WrenSession; track: Track }

/**
 * A song's heart over the session's server: whether it is a favourite, and the press that turns
 * it on or off, a failure said in a toast. Whoever opens the song's menu reads it and hands it
 * on, so a heart beside the song and the menu's Like show the same state while a press is on its way.
 */
export const useTrackLike = ({ session, track }: UseTrackLikeProps): MenuLike =>
  useTrackFavourite({ api: session.api, queries: session.queries, track, onFailure: toastFailure })
