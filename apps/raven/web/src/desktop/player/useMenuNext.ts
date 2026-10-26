import { MENU_PLAYER_ACTIONS, type MenuPlayerAction } from '@raven/core'
import type { PlayerServices } from '@raven/ui/headless'
import { useEffect, useEffectEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { handled } from '@/desktop/handled'
import type { MenuHub } from '@/desktop/menuHub'

type UseMenuNextProps = {
  menu: MenuHub
  next: PlayerServices['title']['next']
  onAction?: (action: MenuPlayerAction) => void
}

/**
 * The Playback menu's Next, which is the page's to follow rather than the player's: it replaces
 * the video on screen with the one after it, so Back leaves the player. `onAction` hears every
 * other action, for a page with something to say about one.
 */
export const useMenuNext = ({ menu, next, onAction = () => {} }: UseMenuNextProps): void => {
  const navigate = useNavigate()
  const onMenu = useEffectEvent((action: MenuPlayerAction) => {
    if (action !== MENU_PLAYER_ACTIONS.next) {
      onAction(action)
      return
    }
    if (next === null) return
    handled(Promise.resolve(navigate(next.to, { replace: true, state: next.state })))
  })
  useEffect(() => menu.subscribe(onMenu), [menu])
}
