import { NOW_PLAYING_COPY, SONG_LEADS, type UpNextRow } from '@raven/wren'
import { useState } from 'react'

import { type Covers } from '@raven/wren-native'
import { ListRow } from '@/ui/ListRow'
import { Sheet } from '@/ui/Sheet'
import { SongRow } from '@/ui/SongRow'
import { ICONS } from '@/ui/WrenIcon'

/** A row's move, from its place to another. */
type RowMove = { from: number; to: number }

type QueueRowProps = {
  row: UpNextRow
  trackCoverOf: Covers['trackCoverOf']
  /** The first and last places a row may move to: the songs after the one playing. */
  first: number
  last: number
  onJump: (place: number) => void
  onMove: (move: RowMove) => void
  onRemove: (place: number) => void
}

/**
 * A song in Up next: a press plays it, and its More (or holding select on it) opens a small
 * menu of Move up, Move down and Remove, as Wren on the web offers them in place of the phone's
 * drag and swipe. Move up and Move down show only where the song can go.
 */
export function QueueRow({
  row,
  trackCoverOf,
  first,
  last,
  onJump,
  onMove,
  onRemove,
}: QueueRowProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const { place, track } = row
  const act = (action: () => void) => () => {
    setIsMenuOpen(false)
    action()
  }
  const openMenu = () => setIsMenuOpen(true)
  return (
    <>
      <SongRow
        label={row.label}
        lead={{ kind: SONG_LEADS.art, cover: trackCoverOf(track) }}
        onMore={openMenu}
        onPress={() => onJump(place)}
        subtitle={row.line}
        title={track.title}
      />
      <Sheet
        isOpen={isMenuOpen}
        line={row.line}
        onClose={() => setIsMenuOpen(false)}
        title={track.title}
      >
        {place > first && (
          <ListRow
            hasPreferredFocus
            icon={ICONS.chevronUp}
            onPress={act(() => onMove({ from: place, to: place - 1 }))}
            title={NOW_PLAYING_COPY.moveUp}
          />
        )}
        {place < last && (
          <ListRow
            hasPreferredFocus={place === first}
            icon={ICONS.chevronDown}
            onPress={act(() => onMove({ from: place, to: place + 1 }))}
            title={NOW_PLAYING_COPY.moveDown}
          />
        )}
        <ListRow
          hasPreferredFocus={first === last}
          icon={ICONS.trash}
          onPress={act(() => onRemove(place))}
          title={NOW_PLAYING_COPY.remove}
        />
      </Sheet>
    </>
  )
}
