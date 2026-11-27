import { WREN_ICONS, type WrenIconName } from '@raven/wren'
import type { Palette } from '@raven/wren'
import { PLAYER_COPY } from '@raven/wren'
import { playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { router, usePathname } from 'expo-router'
import { useState } from 'react'
import { Text, TVFocusGuideView, View } from 'react-native'

import { useNowPlaying, type WrenSession, useWren } from '@raven/wren-native'
import { WREN_ROUTES } from '@raven/wren-native/headless'
import { PLACES, type Place, placeOf } from '@/shell/places'
import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/tvTokens'
import { themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { AlbumArt } from '@/ui/AlbumArt'
import { FOCUS_ROLES, Focusable } from '@/ui/Focusable'
import { WrenIcon } from '@/ui/WrenIcon'
import { WrenLockup } from '@/ui/WrenLockup'
import type { Track } from '@raven/core'

/** Each place's drawing, the phone's tab bar's. */
const PLACE_ICONS = {
  [WREN_ROUTES.home]: WREN_ICONS.home,
  [WREN_ROUTES.library]: WREN_ICONS.library,
  [WREN_ROUTES.search]: WREN_ICONS.search,
  [WREN_ROUTES.settings]: WREN_ICONS.settings,
} as const satisfies Record<Place['route'], WrenIconName>

const useStyles = themedStyles(({ colors }) => ({
  sidebar: {
    backgroundColor: colors.surface,
    gap: SPACE.s4,
    paddingHorizontal: SPACE.s2,
    paddingVertical: SPACE.s6,
  },
  open: { width: SIZE.sidebarOpen },
  closed: { width: SIZE.sidebarClosed },
  brand: { alignItems: 'center', height: SIZE.logo, justifyContent: 'center' },
  places: { flex: 1, gap: SPACE.s1 },
  row: {
    alignItems: 'center',
    borderRadius: RADIUS.item,
    flexDirection: 'row',
    gap: SPACE.s3,
    minHeight: SIZE.button,
    paddingHorizontal: SPACE.s3,
  },
  lit: { backgroundColor: colors.text },
  placeText: { ...TYPE.button, color: colors.text2 },
  here: { color: colors.text },
  litText: { color: colors.bg },
  playingWords: { flex: 1 },
  playingTitle: { ...TYPE.meta, color: colors.text },
  playingLine: { ...TYPE.meta, color: colors.text2 },
}))

type InkOfProps = { colors: Palette; isFocused: boolean; isHere: boolean }

/** A place's drawing's ink: the ground's under the remote, the accent where Wren is, else quiet. */
const inkOf = ({ colors, isFocused, isHere }: InkOfProps): string => {
  if (isFocused) return colors.bg
  return isHere ? colors.accentText : colors.text2
}

/** What a row of the sidebar is told of it: whether it is open, and the way to say the remote came or went. */
type SidebarRowProps = { isOpen: boolean; onFocus: () => void; onBlur: () => void }

type PlaceRowProps = SidebarRowProps & { place: Place; isHere: boolean }

/** One place: its drawing, and its name while the sidebar is open; the one showing is marked. */
function PlaceRow({ place, isHere, isOpen, onFocus, onBlur }: PlaceRowProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  return (
    <Focusable
      focusedStyle={styles.lit}
      hasRing={false}
      isSelected={isHere}
      label={place.title}
      onBlur={onBlur}
      onFocus={onFocus}
      onPress={() => router.navigate(place.route)}
      role={FOCUS_ROLES.tab}
      style={styles.row}
    >
      {({ isFocused }) => (
        <>
          <WrenIcon color={inkOf({ colors, isFocused, isHere })} name={PLACE_ICONS[place.route]} />
          {isOpen && (
            <Text style={[styles.placeText, isHere && styles.here, isFocused && styles.litText]}>
              {place.title}
            </Text>
          )}
        </>
      )}
    </Focusable>
  )
}

type PlayingRowProps = SidebarRowProps & { session: WrenSession; track: Track }

/**
 * The playing song at the sidebar's foot, the phone's mini player: its cover and, open, its title
 * and artists. A press opens Now Playing; it is read as the mini player is, "Now Playing: Airbag,
 * Radiohead".
 */
function PlayingRow({ session, track, isOpen, onFocus, onBlur }: PlayingRowProps) {
  const styles = useStyles()
  const playing = useNowPlaying({ session, track })
  return (
    <Focusable
      focusedStyle={styles.lit}
      hasRing={false}
      label={PLAYER_COPY.open({ title: track.title, artists: playing.artists })}
      onBlur={onBlur}
      onFocus={onFocus}
      onPress={() => router.navigate(WREN_ROUTES.nowPlaying)}
      style={styles.row}
    >
      {({ isFocused }) => (
        <>
          <AlbumArt cover={playing.cover} radius={RADIUS.thumb} size={SIZE.icon * 1.6} />
          {isOpen && (
            <View style={styles.playingWords}>
              <Text numberOfLines={1} style={[styles.playingTitle, isFocused && styles.litText]}>
                {track.title}
              </Text>
              <Text numberOfLines={1} style={[styles.playingLine, isFocused && styles.litText]}>
                {playing.artists}
              </Text>
            </View>
          )}
        </>
      )}
    </Focusable>
  )
}

/**
 * The TV's sidebar, the phone's tab bar and mini player at the left edge: the lockup, the four
 * places, and the song playing. It folds to its drawings while the remote is on the page and
 * opens as the remote comes back to it; it gives the remote to the place showing as it does.
 */
export function Sidebar() {
  const styles = useStyles()
  const session = useWren()
  const track = useAudioQueue(playingTrackOf)
  const here = placeOf({ pathname: usePathname() })
  const [isOpen, setIsOpen] = useState(false)
  const row = { isOpen, onFocus: () => setIsOpen(true), onBlur: () => setIsOpen(false) }
  return (
    <TVFocusGuideView autoFocus style={[styles.sidebar, isOpen ? styles.open : styles.closed]}>
      <View style={styles.brand}>{isOpen && <WrenLockup />}</View>
      <View style={styles.places}>
        {PLACES.map((place) => (
          <PlaceRow {...row} isHere={here === place} key={place.route} place={place} />
        ))}
      </View>
      {session !== null && track !== null && (
        <PlayingRow {...row} session={session} track={track} />
      )}
    </TVFocusGuideView>
  )
}
