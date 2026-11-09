import { type ComponentRef, useRef } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { Equalizer } from '@/layouts/Equalizer'
import { useOpeningFocus } from '@/layouts/focus'
import { Cover } from '@/layouts/MusicParts.focus'
import { coverLabelOf, equalizerBandOf, useEqualizerShown } from '@/layouts/playingCoverKit'
import { useLastFocus } from '@/stores/lastFocus'
import type { Picture } from '@/queries/cards'
import { TV_SIZES } from '@/theme/tvSizes'
import { themedStyles } from '@/theme/useTheme'

/** How much of a cover the equalizer's skyline takes along its foot. */
const BAND_SHARE = 0.31

type PlayingCoverProps = {
  cover: Picture | null
  title: string
  size: number
}

/**
 * Now Playing's cover on a TV, with the equalizer over it: a band along the cover's foot, or,
 * for a track with no artwork, the whole square the cover would fill. The remote reaches the
 * cover and a select hides the equalizer or shows it again, which this device keeps.
 */
export const PlayingCover = ({ cover, title, size }: PlayingCoverProps) => {
  const view = useRef<ComponentRef<typeof Pressable>>(null)
  const { settle } = useOpeningFocus()
  const note = useLastFocus((state) => state.note)
  const { isShown, toggle } = useEqualizerShown()
  const styles = useStyles()
  const hasCover = cover !== null
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
      onPress={toggle}
      style={({ focused }) => [styles.plate, focused && styles.focused]}
    >
      <Cover cover={cover} size={size} title={title} />
      {isShown && (
        <View pointerEvents="none" style={styles.band}>
          <Equalizer
            height={equalizerBandOf({ size, hasCover, bandShare: BAND_SHARE })}
            width={size}
          />
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
    focused: { borderColor: colours.text },
    band: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  }),
)
