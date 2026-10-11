import type { MatchItemType, MediaItem } from '@raven/core'
import { type MouseEvent, useState } from 'react'
import { MENU_HOST, MediaMenu } from '@/components/MediaMenu/MediaMenu'

/**
 * A card's, row's or tile's menu: the class its host wears, so the button
 * shows on hover or focus, the right click that opens it, and the menu itself.
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
  return {
    hostClass: MENU_HOST,
    onContextMenu: (event: MouseEvent) => {
      event.preventDefault()
      setOpen(true)
    },
    menu: (
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
