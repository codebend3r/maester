import type { ArtistCredit } from '@raven/core'
import { useRouter } from 'expo-router'
import { Pressable, Text, View } from 'react-native'

import { WREN_PAGES, pageHref } from '@/routes'
import { ALBUM_COPY } from '@/screens/copy'
import { type WrenTheme, themedStyles, useFormFactor } from '@/theme/wrenTheme'
import { SIZE, SPACE, TYPE, FORM_FACTORS } from '@/theme/wrenTokens'
import { pressedStyleOf } from '@/ui/press'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  links: { columnGap: SPACE.s2, flexDirection: 'row', flexWrap: 'wrap' },
  link: { justifyContent: 'center', minHeight: SIZE.touchTarget },
  name: { ...TYPE.rowLarge, color: colors.accentText },
}))

// Centred under a phone's centred title; from the start of a tablet's column.
const useAlignStyles = themedStyles(() => ({
  [FORM_FACTORS.phone]: { justifyContent: 'center' },
  [FORM_FACTORS.tablet]: {},
}))

type ArtistLinksProps = { artists: readonly ArtistCredit[] }

/** An album's artists in red under its title, each opening the artist's page. */
export function ArtistLinks({ artists }: ArtistLinksProps) {
  const styles = useStyles()
  const router = useRouter()
  const alignStyles = useAlignStyles()
  const formFactor = useFormFactor()
  return (
    <View style={[styles.links, alignStyles[formFactor]]}>
      {artists.map((artist) => (
        <Pressable
          accessibilityLabel={ALBUM_COPY.openArtist(artist.name)}
          accessibilityRole="link"
          key={artist.id}
          onPress={() => router.push(pageHref({ page: WREN_PAGES.artist, id: artist.id }))}
          style={pressedStyleOf({ style: styles.link })}
        >
          <Text style={styles.name}>{artist.name}</Text>
        </Pressable>
      ))}
    </View>
  )
}
