import { classNames } from '@raven/ui/headless'
import { KIT_COPY, NOW_PLAYING_COPY, type UpNextRow } from '@raven/wren'
import { useCovers } from '@/music/useCovers'
import type { UpNextPlace } from '@/screens/NowPlaying/UpNext'
import { COLORS, RADII, SIZES } from '@/theme/tokens'
import { AlbumArt } from '@/ui/AlbumArt/AlbumArt'
import { IconButton } from '@/ui/IconButton/IconButton'
import { Pressable } from '@/ui/Pressable/Pressable'
import { ICONS } from '@/ui/WrenIcon/icons'
import styles from '@/screens/NowPlaying/QueueRow.module.scss'

/** A row's move, from its place to another. */
type RowMove = { from: number; to: number }

type QueueRowProps = {
  row: UpNextRow
  /** The first and last places a row may move to: the songs after the one playing. */
  first: number
  last: number
  /** Where Up next sits; the wide layout's pane has its own ground and margins. */
  place: UpNextPlace
  onJump: (place: number) => void
  onMove: (move: RowMove) => void
  onRemove: (place: number) => void
}

/**
 * A song in Up next: a press plays it, and its Move up, Move down and Remove buttons do what the
 * apps' drag, swipe and screen reader actions do, each named for the song it acts on.
 */
export function QueueRow({
  row,
  first,
  last,
  place: upNextPlace,
  onJump,
  onMove,
  onRemove,
}: QueueRowProps) {
  const { trackCoverOf } = useCovers()
  const { place, track } = row
  const named = (action: string) => KIT_COPY.labelled({ label: action, value: track.title })
  return (
    <li className={classNames([styles.row, styles[upNextPlace]])}>
      <Pressable className={styles.main} label={row.label} onPress={() => onJump(place)}>
        <AlbumArt cover={trackCoverOf(track)} radius={RADII.xs} size={SIZES.miniArt} />
        <span className={styles.text}>
          <span className={styles.title}>{track.title}</span>
          <span className={styles.line}>{row.line}</span>
        </span>
      </Pressable>
      <IconButton
        color={COLORS.text3}
        icon={ICONS.chevronUp}
        isDisabled={place <= first}
        label={named(NOW_PLAYING_COPY.moveUp)}
        onPress={() => onMove({ from: place, to: place - 1 })}
        size={SIZES.smallButton}
      />
      <IconButton
        color={COLORS.text3}
        icon={ICONS.chevronDown}
        isDisabled={place >= last}
        label={named(NOW_PLAYING_COPY.moveDown)}
        onPress={() => onMove({ from: place, to: place + 1 })}
        size={SIZES.smallButton}
      />
      <IconButton
        color={COLORS.text3}
        icon={ICONS.trash}
        label={named(NOW_PLAYING_COPY.remove)}
        onPress={() => onRemove(place)}
        size={SIZES.smallButton}
      />
    </li>
  )
}
