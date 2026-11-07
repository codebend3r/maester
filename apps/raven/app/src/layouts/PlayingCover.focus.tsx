import { type ComponentRef, useRef } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { MUSIC_COPY } from '@/layouts/copy'
import { FOCUS_FRONT } from '@/layouts/focusFront'
import { Equalizer } from '@/layouts/Equalizer.focus'
import { useOpeningFocus } from '@/layouts/focus'
import { Cover } from '@/layouts/MusicParts.focus'
import { useLastFocus } from '@/stores/lastFocus'
import type { Picture } from '@/queries/cards'
import { useAppPrefs } from '@/stores/appPrefs'
import { TV_SIZES } from '@/theme/tvSizes'
import { themedStyles } from '@/theme/useTheme'

/** How much of a cover the equalizer's band takes along its foot, and how much of a coverless square the bars fill. */
const BAND_SHARE = 0.31
const SQUARE_SHARE = 0.84

/** How dark the band under the bars is over a cover. */
const BAND_OPACITY = 0.6

type CoverLabelOfProps = { hasCover: boolean; isShown: boolean }

/** What the cover says aloud: whether it has artwork, and what a select does to the equalizer. */
const coverLabelOf = ({ hasCover, isShown }: CoverLabelOfProps): string => {
  if (hasCover) return isShown ? MUSIC_COPY.coverEqualizerOn : MUSIC_COPY.coverEqualizerOff
  return isShown ? MUSIC_COPY.equalizerOn : MUSIC_COPY.equalizerOff
}

type PlayingCoverProps = {
  cover: Picture | null
  title: string
  size: number
  isPlaying: boolean
}

/**
 * Now Playing's cover on a TV, with the equalizer over it: a band along the cover's foot, or,
 * for a track with no artwork, the whole square the cover would fill. The remote reaches the
 * cover and a select hides the equalizer or shows it again, which this device keeps.
 */
export const PlayingCover = ({ cover, title, size, isPlaying }: PlayingCoverProps) => {
  const view = useRef<ComponentRef<typeof Pressable>>(null)
  const { settle } = useOpeningFocus()
  const note = useLastFocus((state) => state.note)
  const isShown = useAppPrefs((prefs) => prefs.isEqualizerShown)
  const change = useAppPrefs((prefs) => prefs.change)
  const styles = useStyles()
  const hasCover = cover !== null
  const bandHeight = Math.round(size * (hasCover ? BAND_SHARE : SQUARE_SHARE))
  return (
    <Pressable
      ref={view}
      accessibilityLabel={coverLabelOf({ hasCover, isShown })}
      accessibilityRole="button"
      accessibilityState={{ selected: isShown }}
      onFocus={() => {
        note(view.current)
        settle()
      }}
      onPress={() => change({ isEqualizerShown: !isShown })}
      style={({ focused }) => [styles.plate, focused && styles.focused]}
    >
      <Cover cover={cover} size={size} title={title} />
      {isShown && (
        <View pointerEvents="none" style={[styles.band, { height: bandHeight }]}>
          {hasCover && <View style={[StyleSheet.absoluteFill, styles.shade]} />}
          <Equalizer height={bandHeight - TV_SIZES.space3} isPlaying={isPlaying} width={size} />
        </View>
      )}
    </Pressable>
  )
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    plate: {
      alignSelf: 'flex-start',
      borderRadius: TV_SIZES.radius,
      borderWidth: TV_SIZES.tvFocusRing,
      borderColor: 'transparent',
      overflow: 'hidden',
    },
    focused: { ...FOCUS_FRONT, borderColor: colours.text },
    band: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      justifyContent: 'flex-end',
      paddingBottom: TV_SIZES.space2,
    },
    shade: { backgroundColor: colours.deep, opacity: BAND_OPACITY },
  }),
)
