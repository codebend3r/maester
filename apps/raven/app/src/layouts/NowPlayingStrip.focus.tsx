import type { IconName } from '@raven/ui/iconDrawings'
import { useRootNavigationState } from 'expo-router'
import { type ComponentRef, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, type TVRemoteEvent, View, useTVEventHandler } from 'react-native'

import { BUTTON_TONES } from '@/layouts/formKit'
import { useToneStyles } from '@/layouts/formStyles'
import { useAskedAgain } from '@/layouts/focus'
import { frontRouteKeyOf } from '@/layouts/frontRoute'
import { Icon } from '@raven/native'
import { MUSIC_COPY } from '@/layouts/copy'
import { type NowPlayingStripProps, toggleLabelOf } from '@/layouts/musicKit'
import { Cover, useMusicStyles } from '@/layouts/MusicParts.focus'
import { Text } from '@/layouts/Text'
import { REMOTE_KEYS, pressedKeyOf } from '@/layouts/remoteKeys'
import { requestTVFocus } from '@/layouts/tvFocus'
import { useLastFocus } from '@/stores/lastFocus'
import { useMusicStarts } from '@/stores/musicStarts'
import { isOpeningIn, rememberOpener, takeOpener, useScreenFocus } from '@/stores/screenFocus'
import { TV_GUTTER, TV_SIZES, tvSize } from '@/theme/tvSizes'
import { themedStyles, useTheme } from '@/theme/useTheme'

/** The cover in the strip under the screens. */
const STRIP_COVER = tvSize(88)

/** The strip's place, as the screen in front remembers what opened Now Playing. */
const STRIP_PLACE = 'now-playing-strip'

type StripRemoteProps = { isOn: () => boolean }

/**
 * Up while the remote is on the strip goes back to where it was before the strip took it, the
 * control that started the music; with none noted, the platform moves it as it would. One
 * listener for the strip's life, as the player's chrome keeps.
 */
const useBackUp = ({ isOn }: StripRemoteProps) => {
  const latest = useRef(isOn)
  useEffect(() => {
    latest.current = isOn
  })
  const [listener] = useState(() => (event: TVRemoteEvent) => {
    if (!latest.current() || pressedKeyOf(event) !== REMOTE_KEYS.up) return
    const back = useLastFocus.getState().view
    if (back !== null) requestTVFocus(back)
  })
  useTVEventHandler(listener)
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    strip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TV_SIZES.space3,
      paddingHorizontal: TV_GUTTER,
      paddingVertical: TV_SIZES.space2,
      backgroundColor: colours.raised,
    },
    stripMain: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: TV_SIZES.space3,
      padding: TV_SIZES.space1,
      borderRadius: TV_SIZES.radius,
      borderWidth: TV_SIZES.tvFocusRing,
      borderColor: 'transparent',
    },
    stripWords: { flex: 1 },
    stripTitle: { color: colours.text, fontSize: TV_SIZES.textLg, fontWeight: '600' },
  }),
)

/**
 * Whether the strip may take the remote's focus, and the key of the screen in front. The strip
 * sits outside the screens, so it stays out of reach while the screen in front still gives its
 * opening focus: tvOS would otherwise be free to open a screen on it.
 */
const useStripFocus = (): { canFocus: boolean; front: string | null } => {
  const front = frontRouteKeyOf({ state: useRootNavigationState() })
  const canFocus = useScreenFocus(
    (state) => front !== null && !isOpeningIn({ state, screen: front }),
  )
  return { canFocus, front }
}

type StripButtonProps = {
  label: string
  icon: IconName
  canFocus: boolean
  onPress: () => void
  onFocus: () => void
  onBlur: () => void
}

/** Play or Pause, or Next, on a quiet plate beside the strip's words. */
const StripButton = ({ label, icon, canFocus, onPress, onFocus, onBlur }: StripButtonProps) => {
  const music = useMusicStyles()
  const plateStyles = useToneStyles()
  const text = useTheme((theme) => theme.palette.text)
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      focusable={canFocus}
      onBlur={onBlur}
      onFocus={onFocus}
      onPress={onPress}
      style={({ focused }) => [
        music.action,
        plateStyles[BUTTON_TONES.quiet].button,
        focused && music.focused,
      ]}
    >
      {({ focused }) => (
        <Icon colour={text} isFocused={focused} name={icon} size={TV_SIZES.textXl} />
      )}
    </Pressable>
  )
}

/**
 * The strip under the screens on a TV while a track plays: the cover, the title and artists,
 * pressed to open Now Playing, beside Play or Pause and Next. Back from Now Playing lands on it
 * again, as a card's screen lands on the card.
 */
export const NowPlayingStrip = ({
  title,
  artists,
  cover,
  isPlaying,
  onOpen,
  onToggle,
  onNext,
}: NowPlayingStripProps) => {
  const view = useRef<ComponentRef<typeof Pressable>>(null)
  // Whether the remote is on one of the strip's controls.
  const focusedOn = useRef(0)
  const music = useMusicStyles()
  const styles = useStyles()
  const { canFocus, front } = useStripFocus()
  // The strip is gone while Now Playing is in front, so it is drawn afresh on the way back.
  useEffect(() => {
    if (front !== null && takeOpener({ screen: front, card: STRIP_PLACE })) {
      requestTVFocus(view.current)
    }
  }, [front])
  useAskedAgain({ screen: front, card: STRIP_PLACE, view })
  // Music started: the remote comes down to the strip, to pause or skip at once.
  const startCount = useMusicStarts((starts) => starts.started)
  const met = useMusicStarts((starts) => starts.met)
  const meet = useMusicStarts((starts) => starts.meet)
  useEffect(() => {
    if (startCount <= met || !canFocus) return
    meet(startCount)
    requestTVFocus(view.current)
  }, [startCount, met, meet, canFocus])
  useBackUp({ isOn: () => focusedOn.current > 0 })
  const heard = {
    onFocus: () => {
      focusedOn.current += 1
    },
    onBlur: () => {
      focusedOn.current = Math.max(0, focusedOn.current - 1)
    },
  }
  return (
    <View style={styles.strip}>
      <Pressable
        ref={view}
        {...heard}
        accessibilityLabel={MUSIC_COPY.openNowPlaying}
        accessibilityRole="button"
        focusable={canFocus}
        onPress={() => {
          if (front !== null) rememberOpener({ screen: front, card: STRIP_PLACE })
          onOpen()
        }}
        style={({ focused }) => [styles.stripMain, focused && music.focused]}
      >
        <Cover cover={cover} size={STRIP_COVER} title={title} />
        <View style={styles.stripWords}>
          <Text numberOfLines={1} style={styles.stripTitle}>
            {title}
          </Text>
          <Text numberOfLines={1} style={music.muted}>
            {artists}
          </Text>
        </View>
      </Pressable>
      <StripButton
        {...heard}
        canFocus={canFocus}
        icon={isPlaying ? 'pause' : 'play'}
        label={toggleLabelOf(isPlaying)}
        onPress={onToggle}
      />
      <StripButton
        {...heard}
        canFocus={canFocus}
        icon="skipNext"
        label={MUSIC_COPY.next}
        onPress={onNext}
      />
    </View>
  )
}
