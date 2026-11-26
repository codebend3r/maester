import type { ArtistCredit } from '@raven/core'
import { ALBUM_COPY } from '@raven/wren'
import { router } from 'expo-router'
import { Text, View } from 'react-native'

import { WREN_PAGES, pageHref } from '@raven/wren-native/headless'
import { RADIUS, SPACE, TYPE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { FOCUS_ROLES, Focusable } from '@/ui/Focusable'

const useStyles = themedStyles(({ colors }) => ({
  links: { columnGap: SPACE.s2, flexDirection: 'row', flexWrap: 'wrap' },
  link: { borderRadius: RADIUS.thumb, paddingHorizontal: SPACE.s1 },
  name: { ...TYPE.row, color: colors.accentText },
}))

type ArtistLinksProps = { artists: readonly ArtistCredit[] }

/** An album's artists in the accent under its title, each opening the artist's page. */
export function ArtistLinks({ artists }: ArtistLinksProps) {
  const styles = useStyles()
  return (
    <View style={styles.links}>
      {artists.map((artist) => (
        <Focusable
          key={artist.id}
          label={ALBUM_COPY.openArtist(artist.name)}
          onPress={() => router.push(pageHref({ page: WREN_PAGES.artist, id: artist.id }))}
          role={FOCUS_ROLES.link}
          style={styles.link}
        >
          <Text style={styles.name}>{artist.name}</Text>
        </Focusable>
      ))}
    </View>
  )
}
