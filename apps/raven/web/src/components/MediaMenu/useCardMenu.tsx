import type { MatchItemType, MediaItem } from '@raven/core'
import { type MouseEvent, useState } from 'react'
import { MENU_HOST, MediaMenu } from '@/components/MediaMenu/MediaMenu'
import { useSelection } from '@/components/SelectionScope/SelectionScope'

/**
 * A card's, row's or tile's menu: the class its host wears, so the button
 * shows on hover or focus, the right click that opens it, and the menu itself.
 * While selecting, a right click is the browser's and the menu is not there:
 * select mode takes the card's clicks.
 */
export const useCardMenu = ({
  media,
  matchType,
  inline = false,
}: {
  media: MediaItem
  matchType: MatchItemType | null
  inline?: boolean
}) => {
  const [open, setOpen] = useState(false)
  const selecting = useSelection((state) => state.selecting)
  return {
    hostClass: MENU_HOST,
    onContextMenu: (event: MouseEvent) => {
      if (selecting) return
      event.preventDefault()
      setOpen(true)
    },
    menu: selecting ? null : (
      <MediaMenu
        media={media}
        open={open}
        onOpenChange={setOpen}
        inline={inline}
        matchType={matchType}
      />
    ),
  }
}
