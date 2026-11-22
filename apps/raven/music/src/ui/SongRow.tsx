import type { ComponentType } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import {
  KIT_COPY,
  SONG_LEADS,
  type ShownLead,
  type SongLead,
  songLeadOf,
  type SongLeadOf,
} from '@raven/wren'

import type { Cover } from '@/music/useCovers'
import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { ON_PICTURE, RADIUS, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { AlbumArt } from '@/ui/AlbumArt'
import { EqualizerIndicator } from '@/ui/EqualizerIndicator'
import { IconButton } from '@/ui/IconButton'
import { pressedStyleOf } from '@/ui/press'
import { ICONS, WrenIcon } from '@/ui/WrenIcon'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  row: {
    alignItems: 'center',
    borderBottomColor: colors.line,
    borderBottomWidth: SIZE.hairline,
    flexDirection: 'row',
    minHeight: SIZE.row,
  },
  main: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: SIZE.rowGap,
    minHeight: SIZE.row,
    paddingVertical: SPACE.s2,
  },
  lead: { alignItems: 'center', justifyContent: 'center', width: SIZE.trackNumber },
  // The picture's own veil, the same in every theme, so the bars read over any cover.
  veil: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    backgroundColor: ON_PICTURE.veil,
    borderRadius: RADIUS.xs,
    justifyContent: 'center',
  },
  number: { ...TYPE.time, color: colors.text3 },
  text: { flex: 1 },
  title: { ...TYPE.rowTitle, color: colors.text },
  playing: { color: colors.accentText },
  subtitle: { ...TYPE.meta, color: colors.text2 },
  end: { alignItems: 'center', flexDirection: 'row', gap: SPACE.s2 },
  duration: { ...TYPE.time, color: colors.text3 },
  more: {
    alignItems: 'center',
    height: SIZE.touchTarget,
    justifyContent: 'center',
    width: SIZE.smallButton,
  },
}))

type LeadProps = { lead: ShownLead<Cover>; isPlaying: boolean }

function ArtLead({ lead }: LeadProps) {
  return (
    lead.kind === SONG_LEADS.art && (
      <AlbumArt cover={lead.cover} radius={RADIUS.xs} size={SIZE.rowArt} />
    )
  )
}

/** The queue's track in a list of covers: its cover under a veil, the equalizer over it. */
function ArtEqualizerLead({ lead, isPlaying }: LeadProps) {
  const styles = useStyles()
  return (
    lead.kind === SONG_LEADS.artEqualizer && (
      <View>
        <AlbumArt cover={lead.cover} radius={RADIUS.xs} size={SIZE.rowArt} />
        <View style={styles.veil}>
          <EqualizerIndicator isOnPicture isPlaying={isPlaying} />
        </View>
      </View>
    )
  )
}

function NumberLead({ lead }: LeadProps) {
  const styles = useStyles()
  return (
    lead.kind === SONG_LEADS.number && (
      <View style={styles.lead}>
        <Text style={styles.number}>{lead.number}</Text>
      </View>
    )
  )
}

function EqualizerLead({ isPlaying }: LeadProps) {
  const styles = useStyles()
  return (
    <View style={styles.lead}>
      <EqualizerIndicator isPlaying={isPlaying} />
    </View>
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
  isDownloaded?: boolean
  /** What the row is called aloud. */
  label: string
  onPress: () => void
  onLongPress?: () => void
  /** More: the track's menu. */
  onMore?: () => void
}

/**
 * A song in a list: its art, number or equalizer, its title and line, a check when it is
 * downloaded, its length, and More. A press plays from it.
 */
export function SongRow({
  title,
  subtitle = null,
  duration,
  lead,
  isCurrent = false,
  isPlaying = false,
  isDownloaded = false,
  label,
  onPress,
  onLongPress,
  onMore,
}: SongRowProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  const shown = songLeadOf({ lead, isCurrent })
  const Lead = LEAD_VIEWS[shown.kind]
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ selected: isCurrent }}
        onLongPress={onLongPress}
        onPress={onPress}
        style={pressedStyleOf({ style: styles.main })}
      >
        <Lead isPlaying={isPlaying} lead={shown} />
        <View style={styles.text}>
          <Text numberOfLines={1} style={[styles.title, isCurrent && styles.playing]}>
            {title}
          </Text>
          {subtitle !== null && (
            <Text numberOfLines={1} style={styles.subtitle}>
              {subtitle}
            </Text>
          )}
        </View>
        <View style={styles.end}>
          {isDownloaded && (
            <View accessibilityLabel={KIT_COPY.downloaded} accessible>
              <WrenIcon color={colors.text3} name={ICONS.downloaded} size={SIZE.check} />
            </View>
          )}
          <Text style={styles.duration}>{duration}</Text>
        </View>
      </Pressable>
      {onMore !== undefined && (
        <View style={styles.more}>
          <IconButton
            color={colors.text3}
            icon={ICONS.more}
            label={KIT_COPY.more(title)}
            onPress={onMore}
            size={SIZE.smallButton}
          />
        </View>
      )}
    </View>
  )
}
