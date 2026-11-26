import {
  KIT_COPY,
  SONG_LEADS,
  type ShownLead,
  type SongLead,
  type SongLeadOf,
  songLeadOf,
} from '@raven/wren'
import { type ComponentType } from 'react'
import { Text, View } from 'react-native'

import { type Cover } from '@raven/wren-native'
import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { AlbumArt } from '@/ui/AlbumArt'
import { Equalizer } from '@/ui/Equalizer'
import { FocusButton } from '@/ui/FocusButton'
import { Focusable } from '@/ui/Focusable'
import { ICONS } from '@/ui/WrenIcon'

const useStyles = themedStyles(({ colors }) => ({
  row: { alignItems: 'center', flexDirection: 'row', gap: SPACE.s2 },
  main: {
    alignItems: 'center',
    borderRadius: RADIUS.item,
    flex: 1,
    flexDirection: 'row',
    gap: SPACE.s3,
    minHeight: SIZE.row,
    paddingHorizontal: SPACE.s3,
  },
  lit: { backgroundColor: colors.surface2 },
  lead: { alignItems: 'center', justifyContent: 'center', width: SIZE.rowArt },
  number: { ...TYPE.time, color: colors.text3 },
  words: { flex: 1 },
  title: { ...TYPE.row, color: colors.text },
  playing: { color: colors.accentText },
  line: { ...TYPE.meta, color: colors.text2 },
  duration: { ...TYPE.time, color: colors.text3 },
}))

type LeadProps = { lead: ShownLead<Cover>; isPlaying: boolean }

function ArtLead({ lead }: LeadProps) {
  return (
    lead.kind === SONG_LEADS.art && (
      <AlbumArt cover={lead.cover} radius={RADIUS.thumb} size={SIZE.rowArt} />
    )
  )
}

/** The queue's track in a list of covers: its cover, the equalizer over it. */
function ArtEqualizerLead({ lead, isPlaying }: LeadProps) {
  return (
    lead.kind === SONG_LEADS.artEqualizer && (
      <>
        <AlbumArt cover={lead.cover} radius={RADIUS.thumb} size={SIZE.rowArt} />
        <Equalizer isOnPicture isPlaying={isPlaying} />
      </>
    )
  )
}

function NumberLead({ lead }: LeadProps) {
  const styles = useStyles()
  return lead.kind === SONG_LEADS.number && <Text style={styles.number}>{lead.number}</Text>
}

function EqualizerLead({ isPlaying }: LeadProps) {
  return <Equalizer isPlaying={isPlaying} />
}

/** What leads the row: its cover or its number, with the equalizer while it is the queue's track. */
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
  /** The track's length, "3:36"; none where the list says no lengths (Up next). */
  duration?: string | null
  lead: SongLeadOf<Cover>
  /** Whether this is the queue's track: its title in the accent and the equalizer in its lead. */
  isCurrent?: boolean
  isPlaying?: boolean
  /** What the row is called aloud. */
  label: string
  onPress: () => void
  /** The track's menu: holding select on the row, or its More. */
  onMore: () => void
  hasPreferredFocus?: boolean
  testID?: string
}

/**
 * A song in a list: its lead, its title and line and its length, one control a press plays
 * from, and More beside it, which right reaches. Holding select on the row opens the same menu.
 */
export function SongRow({
  title,
  subtitle = null,
  duration = null,
  lead,
  isCurrent = false,
  isPlaying = false,
  label,
  onPress,
  onMore,
  hasPreferredFocus,
  testID,
}: SongRowProps) {
  const styles = useStyles()
  const shown = songLeadOf({ lead, isCurrent })
  const Lead = LEAD_VIEWS[shown.kind]
  return (
    <View style={styles.row}>
      <Focusable
        focusedStyle={styles.lit}
        hasPreferredFocus={hasPreferredFocus}
        hasRing={false}
        isSelected={isCurrent}
        label={label}
        onLongPress={onMore}
        onPress={onPress}
        style={styles.main}
        testID={testID}
      >
        <View style={styles.lead}>
          <Lead isPlaying={isPlaying} lead={shown} />
        </View>
        <View style={styles.words}>
          <Text numberOfLines={1} style={[styles.title, isCurrent && styles.playing]}>
            {title}
          </Text>
          {subtitle !== null && (
            <Text numberOfLines={1} style={styles.line}>
              {subtitle}
            </Text>
          )}
        </View>
        {duration !== null && <Text style={styles.duration}>{duration}</Text>}
      </Focusable>
      <FocusButton icon={ICONS.more} label={KIT_COPY.more(title)} onPress={onMore} />
    </View>
  )
}
