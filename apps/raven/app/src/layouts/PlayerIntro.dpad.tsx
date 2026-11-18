import { StyleSheet, View } from 'react-native'

import type { IntroOffer } from '@/layouts/introOffer'
import { PlateButton } from '@/layouts/tvControls'
import { TV_GUTTER } from '@/theme/tvSizes'

type IntroCardProps = {
  offer: IntroOffer
  /** How far the card stands up from the bottom of the screen, clear of the controls while they show. */
  lift: number
}

/**
 * Skip intro, or Undo skip, at the bottom right over the video while the intro prompts, whether
 * or not the controls show, as the web player's does. It takes the remote as it appears, so one
 * press skips; once the prompt is over the controls carry it while the intro lasts.
 */
export const IntroCard = ({ offer, lift }: IntroCardProps) => (
  <View pointerEvents="box-none" style={[styles.slot, { paddingBottom: TV_GUTTER + lift }]}>
    <PlateButton
      isOverPicture
      label={offer.label}
      onPress={offer.onPress}
      shouldFocusOnMount
      text={offer.label}
    />
  </View>
)

const styles = StyleSheet.create({
  slot: {
    ...StyleSheet.absoluteFill,
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    paddingHorizontal: TV_GUTTER,
  },
})
