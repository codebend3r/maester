import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import type { PlayerChromeProps } from '@/layouts/playerKit'
import { PlateButton } from '@/layouts/tvControls'
import { COLOURS, SIZES } from '@/theme/appTheme'

const GUTTER = SIZES.space8

const BACK = 'Back'

/**
 * A TV player while there is nothing to play (opening, refused, or no way left): the title and
 * the line stand alone with Back, which takes the remote's focus as it appears and lets go once
 * it has had it. Both TV chromes draw it until the video has a source.
 */
export const PlayerNotice = ({
  title,
  notice,
  onBack,
}: Pick<PlayerChromeProps, 'title' | 'notice' | 'onBack'>) => {
  const [isOpening, setOpening] = useState(true)
  return (
    <View style={styles.page}>
      {title !== '' && (
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
      )}
      {notice !== null && (
        <Text accessibilityLiveRegion="polite" style={styles.notice}>
          {notice}
        </Text>
      )}
      <View style={styles.actions}>
        <PlateButton
          accessibilityRole="button"
          isPreferred={isOpening}
          label={BACK}
          onFocused={() => setOpening(false)}
          onPress={onBack}
          text={BACK}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    justifyContent: 'center',
    gap: SIZES.space4,
    paddingHorizontal: GUTTER,
    backgroundColor: COLOURS.ground,
  },
  title: { color: COLOURS.text, fontSize: SIZES.textXl, fontWeight: 'bold' },
  notice: {
    maxWidth: SIZES.measure,
    color: COLOURS.text,
    fontSize: SIZES.textLg,
  },
  actions: { flexDirection: 'row' },
})
