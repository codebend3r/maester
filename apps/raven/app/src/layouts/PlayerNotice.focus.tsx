import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { Text } from '@/layouts/Text'
import { PLAYER_COPY, type PlayerChromeProps } from '@/layouts/playerKit'
import { PlateButton } from '@/layouts/tvControls'
import { TV_SIZES } from '@/theme/tvSizes'
import { pictureStyles } from '@/theme/useTheme'

const GUTTER = TV_SIZES.space8

type PlayerNoticeProps = Pick<PlayerChromeProps, 'title' | 'notice' | 'onBack'>

/**
 * A TV player while there is nothing to play (opening, refused, or no way left): the title and
 * the line stand alone with Back, which takes the remote's focus as it appears and lets go once
 * it has had it. Both TV chromes draw it until the video has a source. It is dark in every
 * theme, as the web's page for a video that cannot play, like the player it stands in for.
 */
export const PlayerNotice = ({ title, notice, onBack }: PlayerNoticeProps) => {
  const [isOpening, setOpening] = useState(true)
  const styles = useStyles()
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
          isOverPicture
          isPreferred={isOpening}
          label={PLAYER_COPY.leave}
          onFocused={() => setOpening(false)}
          onPress={onBack}
          text={PLAYER_COPY.leave}
        />
      </View>
    </View>
  )
}

const useStyles = pictureStyles((colours) =>
  StyleSheet.create({
    page: {
      flex: 1,
      justifyContent: 'center',
      gap: TV_SIZES.space4,
      paddingHorizontal: GUTTER,
      backgroundColor: colours.ground,
    },
    title: { color: colours.text, fontSize: TV_SIZES.textXl, fontWeight: 'bold' },
    notice: {
      maxWidth: TV_SIZES.measure,
      color: colours.text,
      fontSize: TV_SIZES.textLg,
    },
    actions: { flexDirection: 'row' },
  }),
)
