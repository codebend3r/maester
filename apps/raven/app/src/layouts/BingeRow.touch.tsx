import { Icon } from '@raven/native'
import { Image, Pressable, StyleSheet, View } from 'react-native'

import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { LINE_RATIO } from '@/layouts/textHeights'
import { BINGE_COPY, type BingeCard, seenShareOf, seenWordsOf } from '@/queries/bingeCards'
import type { RouteTarget } from '@/routes'
import { OPACITIES, SIZES } from '@/theme/appTheme'
import { APP_ICONS } from '@/theme/icons'
import { themedStyles, useTheme } from '@/theme/useTheme'

/** The poster's width, and its height over it: a poster stands two wide to three tall. */
const POSTER = { width: SIZES.space8 + SIZES.space4, ratio: 3 / 2 } as const

const PLAY_SIZE = 20

type BingeRowViewProps = {
  card: BingeCard
  onOpen: (target: RouteTarget) => void
}

/**
 * A binged show as a row of the Binge page's list, as the web's: its poster and its title, which
 * open its page, its year and length, the episode it is on and what is left of it, then how much
 * of the show is watched as a bar with its count, and a button that resumes it. A show with no
 * episode left has no button.
 */
export const BingeRowView = ({ card, onOpen }: BingeRowViewProps) => {
  const styles = useStyles()
  const onAccent = useTheme((theme) => theme.palette.onAccent)
  const { seen } = card
  return (
    <View accessibilityRole="listitem" style={styles.row}>
      <Pressable
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        onPress={() => onOpen(card.page)}
        style={({ pressed }) => [styles.poster, pressed && styles.pressed]}
      >
        {card.poster !== null && (
          <Image
            resizeMethod="resize"
            resizeMode="cover"
            source={card.poster}
            style={StyleSheet.absoluteFill}
          />
        )}
      </Pressable>
      <View style={styles.copy}>
        <Pressable
          accessibilityRole="link"
          hitSlop={SIZES.space1}
          onPress={() => onOpen(card.page)}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Text variant={TEXT_VARIANTS.display} numberOfLines={2} style={styles.title}>
            {card.title}
          </Text>
        </Pressable>
        {card.meta !== null && (
          <Text numberOfLines={1} style={styles.meta}>
            {card.meta}
          </Text>
        )}
        {card.episodeLine !== null && (
          <Text numberOfLines={1} style={styles.episode}>
            {card.episodeLine}
          </Text>
        )}
        {card.rowStatus !== null && (
          <Text numberOfLines={1} style={styles.meta}>
            {card.rowStatus}
          </Text>
        )}
        {seen !== null && (
          <View style={styles.seen}>
            <View
              accessibilityLabel={BINGE_COPY.seenLabel(seen)}
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: seen.total, now: seen.watched }}
              style={styles.bar}
            >
              <View style={[styles.fill, { width: `${seenShareOf(seen) * 100}%` }]} />
            </View>
            <Text numberOfLines={1} style={styles.count}>
              {seenWordsOf(seen)}
            </Text>
          </View>
        )}
      </View>
      {card.playLabel !== null && (
        <Pressable
          accessibilityLabel={card.playLabel}
          accessibilityRole="button"
          hitSlop={SIZES.space2}
          onPress={() => onOpen(card.target)}
          style={({ pressed }) => [styles.play, pressed && styles.pressed]}
        >
          <Icon colour={onAccent} name={APP_ICONS.play} size={PLAY_SIZE} />
        </Pressable>
      )}
    </View>
  )
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SIZES.space3,
      padding: SIZES.space3,
      borderRadius: SIZES.radiusLg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colours.line,
      backgroundColor: colours.raised,
    },
    pressed: { opacity: OPACITIES.pressed },
    poster: {
      width: POSTER.width,
      height: POSTER.width * POSTER.ratio,
      borderRadius: SIZES.radius,
      overflow: 'hidden',
      backgroundColor: colours.quiet,
    },
    copy: { flex: 1, gap: SIZES.space1 },
    title: { color: colours.text, fontSize: SIZES.textLg, lineHeight: SIZES.textLg * LINE_RATIO },
    meta: { color: colours.muted, fontSize: SIZES.textSm, lineHeight: SIZES.textSm * LINE_RATIO },
    episode: { color: colours.text, fontSize: SIZES.textSm, lineHeight: SIZES.textSm * LINE_RATIO },
    seen: { gap: SIZES.space1, paddingTop: SIZES.space1 },
    bar: {
      height: SIZES.space1,
      borderRadius: SIZES.radiusPill,
      overflow: 'hidden',
      backgroundColor: colours.track,
    },
    fill: { height: '100%', borderRadius: SIZES.radiusPill, backgroundColor: colours.played },
    count: { color: colours.muted, fontSize: SIZES.textXs, lineHeight: SIZES.textXs * LINE_RATIO },
    play: {
      width: SIZES.fieldHeight,
      height: SIZES.fieldHeight,
      borderRadius: SIZES.radiusPill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colours.accent,
    },
  }),
)
