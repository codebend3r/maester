import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiClient, CaptionStyle } from '@raven/core'
import { afterCaptionStyle } from '@/query/invalidate'
import { editKey, useOptimisticMutation } from '@/query/optimistic'
import { mutationKeys, queryKeys } from '@/query/queryClient'
import { useEffect } from 'react'
import { usePlayerPrefs } from '@/stores/playerPrefs'

type CaptionStyleHandle = {
  style: CaptionStyle
  change: (change: Partial<CaptionStyle>) => void
}

/**
 * How the account's subtitles look, the same for every video on every device. `style` is the
 * query's data, which starts as the look this device last kept in the player prefs and is read
 * from the server at once, so the first frame and a server out of reach still draw the last known
 * look. `change` saves the size, the colour or both: the pick is merged into `style`, shown at
 * once (before the first read answers too, since the query always holds a look) and put back if
 * the server refuses it. Whatever the server or a pick puts in the query is kept in the prefs, in
 * the one effect below. With no `api` (a signed-out host, a local file) nothing is asked, `style`
 * is the kept look, and a change is kept on this device alone.
 */
export const useCaptionStyle = (api: ApiClient | null): CaptionStyleHandle => {
  const queryClient = useQueryClient()
  const stored = usePlayerPrefs((prefs) => prefs.captionStyle)
  const keep = usePlayerPrefs((prefs) => prefs.setCaptionStyle)
  const { data, dataUpdatedAt } = useQuery({
    queryKey: queryKeys.captionStyle,
    queryFn: api === null ? skipToken : () => api.getCaptionStyle(),
    initialData: stored,
    // As old as can be, so the stored look is read over at once.
    initialDataUpdatedAt: 0,
  })
  /*
   * Only a look the server gave or a pick made: the seed is the stored copy already. The seed
   * means the query always holds a look, but `skipToken` leaves its type saying it may not.
   */
  useEffect(() => {
    if (data !== undefined && dataUpdatedAt > 0) keep(data)
  }, [data, dataUpdatedAt, keep])
  const save = useOptimisticMutation<CaptionStyle>({
    mutationKey: mutationKeys.captionStyle,
    mutationFn: (next) => (api === null ? Promise.resolve(next) : api.setCaptionStyle(next)),
    edits: (next) => [
      editKey<CaptionStyle>({ queryKey: queryKeys.captionStyle, update: () => next }),
    ],
    settle: () => afterCaptionStyle(queryClient),
  })
  const style = api === null || data === undefined ? stored : data
  return { style, change: (change) => save.mutate({ ...style, ...change }) }
}
