import { useState } from 'react'
import { Image, StyleSheet, View } from 'react-native'

import { Text } from '@/layouts/Text'
import { CARD_SHAPES, type CardShape, type ShelfCard } from '@/queries/cards'
import { SIZES } from '@/theme/appTheme'
import { themedStyles } from '@/theme/useTheme'

const POSTER_RATIO = 3 / 2
const WIDE_RATIO = 9 / 16

/** How much of a card the title art may take, at its foot and to the left: wide and short, as title art runs. */
const LOGO_SHARE = { width: 0.6, height: 0.32 } as const

type PictureHeightOfProps = { shape: CardShape; width: number }

/** How tall a card's picture stands for its width: a poster at 2:3, a wide frame at 16:9. */
export const pictureHeightOf = ({ shape, width }: PictureHeightOfProps): number =>
  width * (shape === CARD_SHAPES.poster ? POSTER_RATIO : WIDE_RATIO)

type CardPictureProps = {
  card: Pick<ShelfCard, 'title' | 'shape' | 'picture' | 'progress' | 'logo'>
  width: number
  ring?: number
  radius?: number
}

/**
 * A card's picture: its poster, backdrop or frame grab, else its title's first letter, with
 * where playback stopped along its foot. `ring` draws the focus ring just outside it, as
 * the web's `:focus-visible` outline does, in the theme's focus colour. `radius` rounds its
 * corners: the web's `--radius-md`, which a TV sizes to its screen.
 */
export const CardPicture = ({ card, width, ring = 0, radius = SIZES.radius }: CardPictureProps) => {
  // What failed is the picture with those headers: with new cookies it is asked for again.
  const [failed, setFailed] = useState<string | null>(null)
  const [failedLogo, setFailedLogo] = useState<string | null>(null)
  const styles = useStyles()
  const logo =
    (card.logo ?? null) === null || card.logo?.uri === failedLogo ? null : (card.logo ?? null)
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
            // Android decodes the picture at the size it is drawn, not the size it was sent at.
            resizeMethod="resize"
            resizeMode="cover"
            source={picture}
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <Text style={[styles.initial, { fontSize: height / 3 }]}>{card.title.slice(0, 1)}</Text>
        )}
        {logo !== null && (
          <View pointerEvents="none" style={styles.logoSlot}>
            <Image
              onError={() => setFailedLogo(logo.uri)}
              resizeMethod="resize"
              resizeMode="contain"
              source={logo}
              style={{ width: width * LOGO_SHARE.width, height: height * LOGO_SHARE.height }}
            />
          </View>
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
    // The title art at the card's foot, clear of the progress line, flush left as the art reads.
    logoSlot: {
      position: 'absolute',
      left: SIZES.space2,
      right: SIZES.space2,
      bottom: SIZES.space2,
      alignItems: 'flex-start',
    },
  }),
)
