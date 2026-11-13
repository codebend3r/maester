import { Icon } from '@raven/native'
import { type ComponentType, useState } from 'react'
import { Image, StyleSheet, View } from 'react-native'

import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { CARD_SHAPES, type CardShape, type Picture, type ShelfCard } from '@/queries/cards'
import { SIZES } from '@/theme/appTheme'
import { themedStyles, useTheme } from '@/theme/useTheme'
import { APP_ICONS } from '@/theme/icons'

/** A picture's height over its width: a poster at 2:3, a wide frame at 16:9, an album's cover square. */
const SHAPE_RATIOS = {
  [CARD_SHAPES.poster]: 3 / 2,
  [CARD_SHAPES.wide]: 9 / 16,
  [CARD_SHAPES.square]: 1,
} as const satisfies Record<CardShape, number>

/** How much of a card the title art may take, at its foot and to the left: wide and short, as title art runs. */
const LOGO_SHARE = { width: 0.6, height: 0.32 } as const

/** The check on a watched title's picture: a share of the width, between a thumb's and a hand's, and its share taken by the icon. */
const WATCHED_BADGE = { share: 0.12, icon: 0.6 } as const

/** How a watched check is sized: the least and most it stands, and its inset from the picture's corner. */
export type WatchedBadge = { least: number; most: number; inset: number }

/** The steps of a size scale a watched check is sized from: touch's `SIZES`, or a TV's, sized to its screen. */
type BadgeSizes = Pick<typeof SIZES, 'space2' | 'space5' | 'space6'>

/** The sizes a watched check takes from a scale. */
export const watchedBadgeOf = (sizes: BadgeSizes): WatchedBadge => ({
  least: sizes.space5,
  most: sizes.space6,
  inset: sizes.space2,
})

const TOUCH_WATCHED_BADGE = watchedBadgeOf(SIZES)

type WatchedBadgeSizeOfProps = { width: number; badge: WatchedBadge }

const watchedBadgeSizeOf = ({ width, badge }: WatchedBadgeSizeOfProps): number =>
  Math.min(badge.most, Math.max(badge.least, width * WATCHED_BADGE.share))

type PictureHeightOfProps = {
  shape: CardShape
  width: number
  /** The height over the width a layout asks for in place of the shape's own. */
  ratio?: number
}

/** How tall a card's picture stands for its width. */
export const pictureHeightOf = ({ shape, width, ratio }: PictureHeightOfProps): number =>
  width * (ratio ?? SHAPE_RATIOS[shape])

/** Whether a picture is drawn, or a stand-in for it in its place. */
export const PICTURE_STATES = { shown: 'shown', missing: 'missing' } as const

export type PictureState = (typeof PICTURE_STATES)[keyof typeof PICTURE_STATES]

/** Whether `picture` is there to draw. */
export const pictureStateOf = (picture: Picture | null): PictureState =>
  picture === null ? PICTURE_STATES.missing : PICTURE_STATES.shown

type CardFaceProps = {
  title: string
  picture: Picture | null
  height: number
  onError: () => void
}

type CardInitialProps = CardFaceProps

const CardInitial = ({ title, height }: CardInitialProps) => {
  const styles = useStyles()
  return (
    <Text variant={TEXT_VARIANTS.display} style={[styles.initial, { fontSize: height / 3 }]}>
      {title.slice(0, 1)}
    </Text>
  )
}

type CardImageProps = CardFaceProps

/** The picture over its title's first letter, which shows while it loads and when it fails. */
const CardImage = ({ picture, onError, title, height }: CardImageProps) =>
  picture !== null && (
    <>
      <CardInitial title={title} height={height} picture={picture} onError={onError} />
      <Image
        onError={onError}
        // Android decodes the picture at the size it is drawn, not the size it was sent at.
        resizeMethod="resize"
        resizeMode="cover"
        source={picture}
        style={StyleSheet.absoluteFill}
      />
    </>
  )

/** A card's face: its picture, else its title's first letter. */
const CARD_FACES = {
  [PICTURE_STATES.shown]: CardImage,
  [PICTURE_STATES.missing]: CardInitial,
} as const satisfies Record<PictureState, ComponentType<CardFaceProps>>

type CardPictureProps = {
  card: Pick<ShelfCard, 'title' | 'shape' | 'picture' | 'progress' | 'logo' | 'isWatched'>
  width: number
  /** The picture's height over its width where a layout frames it otherwise than its shape. */
  ratio?: number
  ring?: number
  radius?: number
  /** How the watched check is sized: touch's sizes unless a TV passes its own, as it does for the radius. */
  badge?: WatchedBadge
  /** Hears the title art fail to load, so the card can put its title's words back. */
  onLogoError?: () => void
}

/**
 * A card's picture: its poster, backdrop or frame grab, else its title's first letter, with
 * where playback stopped along its foot and, once all of it is watched, a check in its bottom
 * right corner. `ring` draws the focus ring just outside it, as the web's `:focus-visible`
 * outline does, in the theme's focus colour. `radius` rounds its corners: the web's
 * `--radius-md`, which a TV sizes to its screen.
 */
export const CardPicture = ({
  card,
  width,
  ratio,
  ring = 0,
  radius = SIZES.radius,
  badge = TOUCH_WATCHED_BADGE,
  onLogoError,
}: CardPictureProps) => {
  // What failed is the picture with those headers: with new cookies it is asked for again.
  const [failed, setFailed] = useState<string | null>(null)
  const [failedLogo, setFailedLogo] = useState<string | null>(null)
  const styles = useStyles()
  const onAccent = useTheme((theme) => theme.palette.onAccent)
  const badgeSize = watchedBadgeSizeOf({ width, badge })
  const cardLogo = card.logo ?? null
  const logo = cardLogo === null || cardLogo.uri === failedLogo ? null : cardLogo
  const height = pictureHeightOf({ shape: card.shape, width, ratio })
  const pictureKey = card.picture === null ? null : JSON.stringify(card.picture)
  const picture = pictureKey === failed ? null : card.picture
  const outset = -2 * ring
  const Face = CARD_FACES[pictureStateOf(picture)]
  return (
    <View style={{ width, height }}>
      <View style={[styles.frame, { borderRadius: radius }]}>
        <Face
          key={pictureKey}
          height={height}
          onError={() => setFailed(pictureKey)}
          picture={picture}
          title={card.title}
        />
        {logo !== null && (
          <View pointerEvents="none" style={styles.logoSlot}>
            <Image
              onError={() => {
                setFailedLogo(logo.uri)
                onLogoError?.()
              }}
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
        {!!card.isWatched && (
          <View
            pointerEvents="none"
            style={[
              styles.watched,
              {
                width: badgeSize,
                height: badgeSize,
                borderRadius: badgeSize / 2,
                right: badge.inset,
                bottom: badge.inset,
              },
            ]}
          >
            <Icon colour={onAccent} name={APP_ICONS.check} size={badgeSize * WATCHED_BADGE.icon} />
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
    // The watched check, in the primary tone a mark that is on wears, clear of the progress line.
    watched: {
      position: 'absolute',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colours.accent,
    },
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
