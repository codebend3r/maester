import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { HeroPickChange, HeroPicks } from '@raven/core'
import { Button, useToasts } from '@raven/ui'
import { afterHeroPicked } from '@raven/ui/headless'
import { HERO_TOGGLE_COPY } from '@/components/HeroToggle/copy'
import { api } from '@/lib/api'
import { heroPicksQuery } from '@/lib/queries'

type HeroTitleProps = { isFull: boolean; isShown: boolean; limit: number }

/** What the switch says it will do on a hover. */
const heroTitle = ({ isFull, isShown, limit }: HeroTitleProps): string => {
  if (isFull) return HERO_TOGGLE_COPY.heroFull(limit)
  if (isShown) return HERO_TOGGLE_COPY.takeOut
  return HERO_TOGGLE_COPY.putIn
}

type HeroSwitchProps = { itemId: number; picks: HeroPicks }

const HeroSwitch = ({ itemId, picks }: HeroSwitchProps) => {
  const queryClient = useQueryClient()
  const showNotice = useToasts((state) => state.show)
  const update = useMutation({
    mutationFn: (pick: HeroPickChange) => api.setHeroPick(pick),
    onSuccess: () => afterHeroPicked(queryClient),
    onError: (error) => showNotice(error.message),
  })
  const isShown = picks.itemIds.includes(itemId)
  const isFull = !isShown && picks.itemIds.length >= picks.limit
  return (
    <Button
      icon="pin"
      aria-pressed={isShown}
      disabled={update.isPending || isFull}
      title={heroTitle({ isFull, isShown, limit: picks.limit })}
      onClick={() => update.mutate({ itemId, isShown: !isShown })}
    >
      {isShown ? HERO_TOGGLE_COPY.inHero : HERO_TOGGLE_COPY.addToHero}
    </Button>
  )
}

type HeroToggleProps = { itemId: number }

/**
 * The admin's switch for one movie or show: whether home's hero shows it.
 * Mount it inside `AdminOnly`, so only a manager asks for the picks. It waits
 * for the picks, and a title not yet in is held back while the hero is full.
 */
export const HeroToggle = ({ itemId }: HeroToggleProps) => {
  const picks = useQuery(heroPicksQuery)
  return picks.data !== undefined && <HeroSwitch itemId={itemId} picks={picks.data} />
}
