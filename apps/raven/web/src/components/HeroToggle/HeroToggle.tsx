import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { HeroPickChange } from '@raven/core'
import { Button, useToasts } from '@raven/ui'
import { afterHeroPicked } from '@raven/ui/headless'
import { api } from '@/lib/api'
import { heroPicksQuery } from '@/lib/queries'

/**
 * The admin's switch for one movie or show: whether home's hero shows it.
 * Mount it inside `AdminOnly`, so only a manager asks for the picks. It waits
 * for the picks, and a title not yet in is held back while the hero is full.
 */
export const HeroToggle = ({ itemId }: { itemId: number }) => {
  const queryClient = useQueryClient()
  const showNotice = useToasts((state) => state.show)
  const picks = useQuery(heroPicksQuery)
  const update = useMutation({
    mutationFn: (pick: HeroPickChange) => api.setHeroPick(pick),
    onSuccess: () => afterHeroPicked(queryClient),
    onError: (error) => showNotice(error.message),
  })
  if (!picks.data) return null
  const isShown = picks.data.itemIds.includes(itemId)
  const isFull = !isShown && picks.data.itemIds.length >= picks.data.limit
  return (
    <Button
      icon="pin"
      aria-pressed={isShown}
      disabled={update.isPending || isFull}
      title={
        isFull
          ? `The hero holds at most ${picks.data.limit} titles; take one out first`
          : isShown
            ? "Take this title out of Home's hero"
            : "Show this title in Home's hero"
      }
      onClick={() => update.mutate({ itemId, isShown: !isShown })}
    >
      {isShown ? 'In hero' : 'Add to hero'}
    </Button>
  )
}
