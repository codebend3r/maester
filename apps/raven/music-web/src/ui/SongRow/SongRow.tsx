import { classNames } from '@raven/ui/headless'
import { KIT_COPY, SONG_LEADS, type SongLead, type SongLeadOf, songLeadOf } from '@raven/wren'
import type { ComponentType } from 'react'
import type { Cover } from '@/music/useCovers'
import { COLORS, RADII, SIZES } from '@/theme/tokens'
import { AlbumArt } from '@/ui/AlbumArt/AlbumArt'
import { EqualizerIndicator } from '@/ui/EqualizerIndicator/EqualizerIndicator'
import { IconButton } from '@/ui/IconButton/IconButton'
import { Pressable } from '@/ui/Pressable/Pressable'
import { ICONS } from '@/ui/WrenIcon/icons'
import styles from '@/ui/SongRow/SongRow.module.scss'

type LeadProps = { lead: SongLeadOf<Cover>; isPlaying: boolean }

function ArtLead({ lead }: LeadProps) {
  return (
    lead.kind === SONG_LEADS.art && (
      <AlbumArt cover={lead.cover} radius={RADII.xs} size={SIZES.rowArt} />
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
}

/**
 * A song in a list: its art, number or equalizer, its title and line, its length, and More. A
 * press plays from it.
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
}: SongRowProps) {
  const Lead =
    LEAD_VIEWS[songLeadOf({ hasArt: lead.kind === SONG_LEADS.art, isPlaying: isCurrent })]
  return (
    <div className={styles.row}>
      <Pressable className={styles.main} isCurrent={isCurrent} label={label} onPress={onPress}>
        <Lead isPlaying={isPlaying} lead={lead} />
        <span className={styles.text}>
          <span className={classNames([styles.title, isCurrent && styles.playing])}>{title}</span>
          {subtitle !== null && <span className={styles.subtitle}>{subtitle}</span>}
        </span>
        <span className={styles.duration}>{duration}</span>
      </Pressable>
      {onMore !== undefined && (
        <span className={styles.more}>
          <IconButton
            color={COLORS.text3}
            icon={ICONS.more}
            label={KIT_COPY.more(title)}
            onPress={onMore}
            size={SIZES.smallButton}
          />
        </span>
      )}
    </div>
  )
}
