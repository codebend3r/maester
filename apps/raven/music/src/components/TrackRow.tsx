import type { Track } from '@raven/core'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { IconButton } from '@/components/Controls'
import { MENU_VIEWS, type MenuView, TrackMenu } from '@/components/TrackMenu'
import { TRACK_ROW_COPY } from '@/components/copy'
import { WREN_ICONS } from '@/theme/icons'
import { OPACITIES, PALETTE, SIZES } from '@/theme/wrenTheme'

type TrackRowProps = {
  track: Track
  /** What leads the row: the track's number on its album, or nothing. */
  lead: string | null
  /** What sits under the title: the artists, or nothing on their own album. */
  line: string | null
  length: string
  /** What the row is called aloud. */
  label: string
  isPlaying: boolean
  onPress: () => void
}

/**
 * A track in a list: a press plays from it, and holding it, or its More, opens its menu: Play
 * next, Add to queue and Add to playlist.
 */
export function TrackRow({ track, lead, line, length, label, isPlaying, onPress }: TrackRowProps) {
  const [menu, setMenu] = useState<MenuView | null>(null)
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ selected: isPlaying }}
        onLongPress={() => setMenu(MENU_VIEWS.actions)}
        onPress={onPress}
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}
      >
        {lead !== null && <Text style={[styles.lead, isPlaying && styles.on]}>{lead}</Text>}
        <View style={styles.text}>
          <Text numberOfLines={1} style={[styles.title, isPlaying && styles.on]}>
            {track.title}
          </Text>
          {line !== null && (
            <Text numberOfLines={1} style={styles.line}>
              {line}
            </Text>
          )}
        </View>
        <Text style={styles.line}>{length}</Text>
      </Pressable>
      <IconButton
        icon={WREN_ICONS.more}
        label={TRACK_ROW_COPY.more(track.title)}
        onPress={() => setMenu(MENU_VIEWS.actions)}
      />
      {menu !== null && <TrackMenu onView={setMenu} track={track} view={menu} />}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    borderBottomColor: PALETTE.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
  },
  main: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: SIZES.space2,
    minHeight: SIZES.fieldHeight,
    paddingVertical: SIZES.space1,
  },
  lead: { color: PALETTE.muted, fontSize: SIZES.textSm, minWidth: SIZES.space4 },
  text: { flex: 1 },
  title: { color: PALETTE.text, fontSize: SIZES.text },
  line: { color: PALETTE.muted, fontSize: SIZES.textSm },
  on: { color: PALETTE.accent },
  pressed: { opacity: OPACITIES.pressed },
})
