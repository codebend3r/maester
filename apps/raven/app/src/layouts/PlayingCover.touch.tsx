import { touchSideOf } from '@raven/core'
import { Pressable, StyleSheet, View } from 'react-native'

import { Equalizer } from '@/layouts/Equalizer'
import { Cover } from '@/layouts/MusicParts.touch'
import { coverLabelOf, equalizerBandOf, useEqualizerShown } from '@/layouts/playingCoverKit'
import { SkipMark } from '@/layouts/PlayerMark.touch'
import { type SkipTarget, useSkipMark } from '@/layouts/useSkipLadder'
import { useTapLadder } from '@/layouts/useTapLadder'
import type { Picture } from '@/queries/cards'
import { SIZES } from '@/theme/appTheme'
import { themedStyles } from '@/theme/useTheme'

/** How much of a cover the equalizer's skyline takes along its foot: half its height. */
const BAND_SHARE = 0.5

type PlayingCoverProps = SkipTarget & {
  cover: Picture | null
  title: string
  size: number
}

/** The cover's mark sits over the cover itself, which has no insets to keep clear of. */
const NO_SIDES = {} as const

/**
 * Now Playing's cover under the thumb, as the TV draws it: the equalizer over it, a band along
 * the cover's foot, or, for a track with no artwork, the whole square the cover would fill. A
 * press hides the equalizer or shows it again, which this device keeps. Its taps are the video
 * player's (`useTapLadder`): a double tap on its right half skips forward and on its left half
 * back, 10 seconds and then 20 and 30 as the taps go on, the pair leaving the equalizer as it
 * was, and how far it went shows in the middle of the cover.
 */
export const PlayingCover = ({ cover, title, size, position, onSeek }: PlayingCoverProps) => {
  const { isShown, toggle } = useEqualizerShown()
  const styles = useStyles()
  const hasCover = cover !== null
  const { skipped, skipBy } = useSkipMark({ transport: { position, onSeek } })
  const taps = useTapLadder({ onSkip: skipBy, onTap: toggle })
  return (
    <Pressable
      accessibilityLabel={coverLabelOf({ hasCover, isShown })}
      accessibilityRole="button"
      accessibilityState={{ selected: isShown }}
      onPress={({ nativeEvent }) =>
        taps.tap(touchSideOf({ x: nativeEvent.locationX, width: size }))
      }
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
      {skipped !== null && <SkipMark key={skipped.count} sides={NO_SIDES} step={skipped.step} />}
    </Pressable>
  )
}

const useStyles = themedStyles(() =>
  StyleSheet.create({
    plate: { borderRadius: SIZES.radius, overflow: 'hidden' },
    band: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  }),
)
