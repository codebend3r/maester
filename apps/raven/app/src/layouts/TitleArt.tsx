import { useState } from 'react'
import { Image, type StyleProp, type TextStyle, View } from 'react-native'

import { Text } from '@/layouts/Text'
import type { Picture } from '@/queries/cards'

/** A logo's width for its height until the art says its own: title art runs wide. */
const LOGO_RATIO = 3

type TitleArtProps = {
  name: string
  logo: Picture | null
  /** How tall the art stands; its width follows the art's own shape. */
  height: number
  maxWidth: number
  /** How the name is set when there is no art, or it fails to load. */
  textStyle: StyleProp<TextStyle>
}

/**
 * A title's art where it has some, at the art's own width and flush left, said as its name; its
 * name in type where it has none, or the art fails to load. The name is the view's round the
 * art, never the art's own: on Android an accessible image is one the remote can focus, and the
 * player's title art took the focus from the scrubber on a press of left.
 */
export const TitleArt = ({ name, logo, height, maxWidth, textStyle }: TitleArtProps) => {
  const [ratio, setRatio] = useState<number>(LOGO_RATIO)
  const [failed, setFailed] = useState<string | null>(null)
  if (logo === null || failed === logo.uri) {
    return (
      <Text numberOfLines={2} style={textStyle}>
        {name}
      </Text>
    )
  }
  return (
    <View accessibilityLabel={name} accessibilityRole="image" accessible>
      <Image
        onError={() => setFailed(logo.uri)}
        onLoad={({ nativeEvent: { source } }) => {
          if (source.width > 0 && source.height > 0) setRatio(source.width / source.height)
        }}
        resizeMode="contain"
        source={logo}
        style={{ height, width: Math.min(maxWidth, height * ratio), maxWidth }}
      />
    </View>
  )
}
