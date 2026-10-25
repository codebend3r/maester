import { useState } from 'react'
import { Image, StyleSheet, View } from 'react-native'

import { Text } from '@/layouts/Text'
import { CARD_SHAPES, type CardShape, type ShelfCard } from '@/queries/cards'
import { SIZES } from '@/theme/appTheme'
import { themedStyles } from '@/theme/useTheme'

const POSTER_RATIO = 3 / 2
const WIDE_RATIO = 9 / 16

/** How tall a card's picture stands for its width: a poster at 2:3, a wide frame at 16:9. */
export const pictureHeightOf = ({ shape, width }: { shape: CardShape; width: number }): number =>
  width * (shape === CARD_SHAPES.poster ? POSTER_RATIO : WIDE_RATIO)

/**
 * A card's picture: its poster, backdrop or frame grab, else its title's first letter, with
 * where playback stopped along its foot. `ring` draws the focus ring just outside it, as
 * the web's `:focus-visible` outline does, in the theme's focus colour. `radius` rounds its
 * corners: the web's `--radius-md`, which a TV sizes to its screen.
 */
export const CardPicture = ({
  card,
  width,
  ring = 0,
  radius = SIZES.radius,
}: {
  card: Pick<ShelfCard, 'title' | 'shape' | 'picture' | 'progress'>
  width: number
  ring?: number
  radius?: number
}) => {
  // What failed is the picture with those headers: with new cookies it is asked for again.
  const [failed, setFailed] = useState<string | null>(null)
  const styles = useStyles()
  const height = pictureHeightOf({ shape: card.shape, width })
  const pictureKey = card.picture === null ? null : JSON.stringify(card.picture)
  const picture = pictureKey === failed ? null : card.picture
  const outset = -2 * ring
  return (
    <View style={{ width, height }}>
      <View style={[styles.frame, { borderRadius: radius }]}>
        {picture !== null ? (
          <Image
            key={pictureKey}
            onError={() => setFailed(pictureKey)}
            resizeMode="cover"
            source={picture}
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <Text style={[styles.initial, { fontSize: height / 3 }]}>{card.title.slice(0, 1)}</Text>
        )}
        {card.progress > 0 && (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${card.progress * 100}%` }]} />
          </View>
        )}
      </View>
      {ring > 0 && (
        <View
          style={[
            styles.ring,
            {
              borderWidth: ring,
              borderRadius: radius - outset,
              top: outset,
              right: outset,
              bottom: outset,
              left: outset,
            },
          ]}
        />
      )}
    </View>
  )
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    frame: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colours.raised,
      overflow: 'hidden',
    },
    initial: { color: colours.muted, fontWeight: 'bold' },
    track: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: SIZES.space0,
      backgroundColor: colours.track,
    },
    fill: { height: '100%', backgroundColor: colours.accent },
    ring: { position: 'absolute', borderColor: colours.text },
  }),
)
