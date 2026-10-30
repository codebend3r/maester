import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { LoadingMark } from '@/layouts/LoadingMark'
import { Text } from '@/layouts/Text'
import { TitleArt } from '@/layouts/TitleArt'
import { PLAYER_COPY, type PlayerChromeProps } from '@/layouts/playerKit'
import { PlateButton } from '@/layouts/tvControls'
import { TV_GUTTER, TV_SIZES } from '@/theme/tvSizes'
import { pictureStyles } from '@/theme/useTheme'

type PlayerNoticeProps = Pick<PlayerChromeProps, 'heading' | 'notice' | 'isOpening' | 'onBack'>

/** How tall the title art stands over the line. */
const LOGO_HEIGHT = TV_SIZES.space8 * 2.5

/**
 * A TV player while there is nothing to play (opening, refused, or no way left): the title art,
 * or the name, over the line, centred on the screen with Back, which takes the remote's focus
 * as it appears and lets go once it has had it. Both TV chromes draw it until the video has a source. It is dark in every
 * theme, as the web's page for a video that cannot play, like the player it stands in for.
 */
export const PlayerNotice = ({ heading, notice, isOpening, onBack }: PlayerNoticeProps) => {
  const [isFirstFocus, setFirstFocus] = useState(true)
  const styles = useStyles()
  const name = heading.show ?? heading.title
  // Opening, the video is the mark and a spinner, as every page loads: no words.
  if (isOpening && notice === null) {
    return (
      <LoadingMark
        gap={TV_SIZES.space5}
        isOverPicture
        label={PLAYER_COPY.opening}
        markWidth={TV_SIZES.space8 * 2}
      />
    )
  }
  return (
    <View style={styles.page}>
      {name !== '' && (
        <View accessibilityRole="header" style={styles.heading}>
          <TitleArt
            height={LOGO_HEIGHT}
            logo={heading.logo}
            maxWidth={TV_SIZES.measure}
            name={name}
            textStyle={styles.title}
          />
          {heading.place !== null && <Text style={styles.place}>{heading.place}</Text>}
          {heading.show !== null && <Text style={styles.title}>{heading.title}</Text>}
        </View>
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
          isPreferred={isFirstFocus}
          label={PLAYER_COPY.leave}
          onFocused={() => setFirstFocus(false)}
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
      alignItems: 'center',
      gap: TV_SIZES.space4,
      paddingHorizontal: TV_GUTTER,
      backgroundColor: colours.ground,
    },
    heading: { alignItems: 'center', gap: TV_SIZES.space2 },
    title: {
      color: colours.text,
      fontSize: TV_SIZES.textXl,
      fontWeight: 'bold',
      textAlign: 'center',
    },
    place: { color: colours.muted, fontSize: TV_SIZES.textLg, fontWeight: '600' },
    notice: {
      maxWidth: TV_SIZES.measure,
      color: colours.text,
      fontSize: TV_SIZES.textLg,
      textAlign: 'center',
    },
    actions: { flexDirection: 'row' },
  }),
)
