import { WREN_ICONS } from '@raven/wren'
import { classNames } from '@raven/ui/headless'
import {
  KIT_COPY,
  type MenuLike,
  SONG_LEADS,
  type ShownLead,
  type SongLead,
  type SongLeadOf,
  songLeadOf,
} from '@raven/wren'
import type { ComponentType } from 'react'
import type { Cover } from '@/music/useCovers'
import { COLORS, RADII, SIZES } from '@/theme/tokens'
import { AlbumArt } from '@/ui/AlbumArt/AlbumArt'
import { EqualizerIndicator } from '@/ui/EqualizerIndicator/EqualizerIndicator'
import { IconButton } from '@/ui/IconButton/IconButton'
import { LikeButton } from '@/ui/LikeButton/LikeButton'
import { Pressable } from '@/ui/Pressable/Pressable'
import styles from '@/ui/SongRow/SongRow.module.scss'

type LeadProps = {
  lead: ShownLead<Cover>
  isPlaying: boolean
  /** What holding the art does, where the row leads with it. */
  onArtHold?: () => void
}

function ArtLead({ lead, onArtHold }: LeadProps) {
  return (
    lead.kind === SONG_LEADS.art && (
      <AlbumArt cover={lead.cover} onHold={onArtHold} radius={RADII.xs} size={SIZES.rowArt} />
    )
  )
}

/** The queue's track in a list of covers: its cover under a veil, the equalizer over it. */
function ArtEqualizerLead({ lead, isPlaying, onArtHold }: LeadProps) {
  return (
    lead.kind === SONG_LEADS.artEqualizer && (
      <span className={styles.artEqualizer}>
        <AlbumArt cover={lead.cover} onHold={onArtHold} radius={RADII.xs} size={SIZES.rowArt} />
        <span className={styles.veil}>
          <EqualizerIndicator isOnPicture isPlaying={isPlaying} />
        </span>
      </span>
    )
  )
}

function NumberLead({ lead }: LeadProps) {
  return (
    lead.kind === SONG_LEADS.number && (
      <span className={styles.lead}>
        <span className={styles.number}>{lead.number}</span>
      </span>
    )
  )
}

function EqualizerLead({ isPlaying }: LeadProps) {
  return (
    <span className={styles.lead}>
      <EqualizerIndicator isPlaying={isPlaying} />
    </span>
  )
}

const LEAD_VIEWS = {
  [SONG_LEADS.art]: ArtLead,
  [SONG_LEADS.number]: NumberLead,
  [SONG_LEADS.equalizer]: EqualizerLead,
  [SONG_LEADS.artEqualizer]: ArtEqualizerLead,
} as const satisfies Record<SongLead, ComponentType<LeadProps>>

type SongRowProps = {
  title: string
  /** The line under the title: the artists, or nothing on their own album. */
  subtitle?: string | null
  /** The track's length, "3:36". */
  duration: string
  /** What leads the row: its cover, or its number on its album's page. */
  lead: SongLeadOf<Cover>
  /** Whether this is the queue's track: its title in red and, numbered, the equalizer. */
  isCurrent?: boolean
  /** Whether the queue's track is playing rather than paused, so the equalizer moves. */
  isPlaying?: boolean
  /** What the row is called aloud. */
  label: string
  onPress: () => void
  /** More: the track's menu, which the apps also open by holding the row. */
  onMore?: () => void
  /** What holding the row's art does: the song's cover menu. A short tap still plays. */
  onArtHold?: () => void
  /** The song's heart, at the row's end: always shown while it is a favourite, else on hover or focus. */
  like?: MenuLike
}

/**
 * A song in a list: its art, number or equalizer (over the art, or in the number's place, while
 * it is the queue's track), its title and line, its length, and More. A press plays from it.
 */
export function SongRow({
  title,
  subtitle = null,
  duration,
  lead,
  isCurrent = false,
  isPlaying = false,
  label,
  onPress,
  onMore,
  onArtHold,
  like,
}: SongRowProps) {
  const shown = songLeadOf({ lead, isCurrent })
  const Lead = LEAD_VIEWS[shown.kind]
  return (
    <div className={styles.row}>
      <Pressable className={styles.main} isCurrent={isCurrent} label={label} onPress={onPress}>
        <Lead isPlaying={isPlaying} lead={shown} onArtHold={onArtHold} />
        <span className={styles.text}>
          <span className={classNames([styles.title, isCurrent && styles.playing])}>{title}</span>
          {subtitle !== null && <span className={styles.subtitle}>{subtitle}</span>}
        </span>
        <span className={styles.duration}>{duration}</span>
      </Pressable>
      {like !== undefined && (
        <span className={classNames([styles.like, like.isLiked && styles.liked])}>
          <LikeButton idleColor={COLORS.text3} like={like} size={SIZES.smallButton} title={title} />
        </span>
      )}
      {onMore !== undefined && (
        <span className={styles.more}>
          <IconButton
            color={COLORS.text3}
            icon={WREN_ICONS.more}
            label={KIT_COPY.more(title)}
            onPress={onMore}
            size={SIZES.smallButton}
          />
        </span>
      )}
    </div>
  )
}
