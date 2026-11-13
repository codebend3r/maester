import { type ComponentType, useState } from 'react'
import { Image, type StyleProp, type TextStyle, View } from 'react-native'

import { Text, TEXT_VARIANTS } from '@/layouts/Text'
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
  /** One colour to draw every visible pixel of the art in, so it reads on its ground; null keeps its own colours. */
  tint?: string | null
}

/** What stands for a title: its art, or its name in type where it has none or the art failed. */
const TITLE_FACES = { art: 'art', words: 'words' } as const

type TitleFace = (typeof TITLE_FACES)[keyof typeof TITLE_FACES]

type TitleFaceProps = Omit<TitleArtProps, 'logo' | 'tint'> & {
  logo: Picture | null
  tint: string | null
  /** Says the art failed to load, so the name stands in its place. */
  onFailed: (uri: string) => void
}

const TitleWords = ({ name, textStyle }: TitleFaceProps) => (
  <Text variant={TEXT_VARIANTS.display} numberOfLines={2} style={textStyle}>
    {name}
  </Text>
)

const TitlePicture = ({ name, logo, height, maxWidth, tint, onFailed }: TitleFaceProps) => {
  const [ratio, setRatio] = useState<number>(LOGO_RATIO)
  return (
    logo !== null && (
      <View accessibilityLabel={name} accessibilityRole="image" accessible>
        <Image
          onError={() => onFailed(logo.uri)}
          onLoad={({ nativeEvent: { source } }) => {
            if (source.width > 0 && source.height > 0) setRatio(source.width / source.height)
          }}
          resizeMode="contain"
          source={logo}
          style={{
            height,
            width: Math.min(maxWidth, height * ratio),
            maxWidth,
            ...(tint === null ? {} : { tintColor: tint }),
          }}
        />
      </View>
    )
  )
}

const TITLE_FACE_VIEWS = {
  [TITLE_FACES.art]: TitlePicture,
  [TITLE_FACES.words]: TitleWords,
} as const satisfies Record<TitleFace, ComponentType<TitleFaceProps>>

/**
 * A title's art where it has some, at the art's own width and flush left, said as its name; its
 * name in type where it has none, or the art fails to load. The name is the view's round the
 * art, never the art's own: on Android an accessible image is one the remote can focus, and the
 * player's title art took the focus from the scrubber on a press of left.
 */
export const TitleArt = ({ tint = null, ...props }: TitleArtProps) => {
  const [failed, setFailed] = useState<string | null>(null)
  const { logo } = props
  const face = logo === null || failed === logo.uri ? TITLE_FACES.words : TITLE_FACES.art
  const Face = TITLE_FACE_VIEWS[face]
  return <Face {...props} tint={tint} onFailed={setFailed} />
}
