import { Pressable, StyleSheet, View } from 'react-native'

import { Equalizer } from '@/layouts/Equalizer'
import { Cover } from '@/layouts/MusicParts.touch'
import { coverLabelOf, equalizerBandOf, useEqualizerShown } from '@/layouts/playingCoverKit'
import type { Picture } from '@/queries/cards'
import { SIZES } from '@/theme/appTheme'
import { themedStyles } from '@/theme/useTheme'

/** How much of a cover the equalizer's skyline takes along its foot: half its height. */
const BAND_SHARE = 0.5

type PlayingCoverProps = {
  cover: Picture | null
  title: string
  size: number
}

/**
 * Now Playing's cover under the thumb, as the TV draws it: the equalizer over it, a band along
 * the cover's foot, or, for a track with no artwork, the whole square the cover would fill. A
 * press hides the equalizer or shows it again, which this device keeps.
 */
export const PlayingCover = ({ cover, title, size }: PlayingCoverProps) => {
  const { isShown, toggle } = useEqualizerShown()
  const styles = useStyles()
  const hasCover = cover !== null
  return (
    <Pressable
      accessibilityLabel={coverLabelOf({ hasCover, isShown })}
      accessibilityRole="button"
      accessibilityState={{ selected: isShown }}
      onPress={toggle}
      style={styles.plate}
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

const useStyles = themedStyles(() =>
  StyleSheet.create({
    plate: { borderRadius: SIZES.radius, overflow: 'hidden' },
    band: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  }),
)
