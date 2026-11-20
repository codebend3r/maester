import { Icon } from '@raven/native'
import { type ComponentRef, useRef } from 'react'
import { Image, Pressable, StyleSheet, View } from 'react-native'

import { useTvCard } from '@/cardMenu/useTvCard'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { LINE_RATIO } from '@/layouts/textHeights'
import { BINGE_COPY, type BingeCard, seenShareOf, seenWordsOf } from '@/queries/bingeCards'
import { cardLabelOf } from '@/queries/cards'
import { APP_ICONS } from '@/theme/icons'
import { TV_SIZES, tvSize } from '@/theme/tvSizes'
import { themedStyles, useTheme } from '@/theme/useTheme'

/** The poster's width, and its height over it: a poster stands two wide to three tall. */
const POSTER = { width: tvSize(132), ratio: 3 / 2 } as const

/** How much of the row the watched bar and its count take, at the right of the words. */
const SEEN_SHARE = 0.28

const PLAY_SIZE = tvSize(36)

type BingeRowFocusProps = {
  card: BingeCard
  place: string
  /** The band the row sits in, for the page to bring into view as it takes the focus back. */
  shelf: string
  isPreferred: boolean
  onPress: () => void
}

/**
 * A binged show on a TV as a row of the web's Binge page: its poster, its title, its year and
 * length, the episode it is on and what is left of it, then how much of the show is watched as a
 * bar with its count. The row is one stop for the remote: focused, it takes the ring and shows
 * Play at its right; pressed, it plays the episode, or opens the show's page with none left, and
 * select held down opens the show's menu of marks.
 */
export const BingeRowFocus = ({ card, place, shelf, isPreferred, onPress }: BingeRowFocusProps) => {
  const pressable = useRef<ComponentRef<typeof Pressable>>(null)
  const tvCard = useTvCard({ card, place, shelf, view: pressable, onPress })
  const { isFocused } = tvCard
  const styles = useStyles()
  const ring = useTheme((theme) => theme.palette.text)
  const onAccent = useTheme((theme) => theme.palette.onAccent)
  const { seen } = card
  return (
    <Pressable
      ref={pressable}
      accessibilityLabel={cardLabelOf({ card })}
      accessibilityRole="button"
      hasTVPreferredFocus={isPreferred}
      onBlur={tvCard.onBlur}
      onFocus={tvCard.onFocus}
      onPress={tvCard.onPress}
      style={styles.row}
    >
      <View style={styles.poster}>
        {card.poster !== null && (
          <Image
            accessibilityElementsHidden
            resizeMethod="resize"
            resizeMode="cover"
            source={card.poster}
            style={StyleSheet.absoluteFill}
          />
        )}
      </View>
      <View style={styles.copy}>
        <Text variant={TEXT_VARIANTS.display} numberOfLines={1} style={styles.title}>
          {card.title}
        </Text>
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
      </View>
      {seen !== null && (
        <View style={styles.seen}>
          <View accessibilityLabel={BINGE_COPY.seenLabel(seen)} style={styles.bar}>
            <View style={[styles.fill, { width: `${seenShareOf(seen) * 100}%` }]} />
          </View>
          <Text numberOfLines={1} style={styles.meta}>
            {seenWordsOf(seen)}
          </Text>
        </View>
      )}
      <View style={[styles.mark, !isFocused && styles.hidden]}>
        <Icon colour={onAccent} name={APP_ICONS.play} size={PLAY_SIZE} />
      </View>
      {isFocused && <View pointerEvents="none" style={[styles.ring, { borderColor: ring }]} />}
      {tvCard.menu}
    </Pressable>
  )
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TV_SIZES.space5,
      padding: TV_SIZES.space4,
      borderRadius: TV_SIZES.radiusLg,
      backgroundColor: colours.raised,
    },
    poster: {
      width: POSTER.width,
      height: POSTER.width * POSTER.ratio,
      borderRadius: TV_SIZES.radius,
      overflow: 'hidden',
      backgroundColor: colours.quiet,
    },
    copy: { flex: 1, gap: TV_SIZES.space1 },
    title: {
      color: colours.text,
      fontSize: TV_SIZES.textXl,
      lineHeight: TV_SIZES.textXl * LINE_RATIO,
    },
    meta: { color: colours.muted, fontSize: TV_SIZES.text, lineHeight: TV_SIZES.text * LINE_RATIO },
    episode: {
      color: colours.text,
      fontSize: TV_SIZES.text,
      lineHeight: TV_SIZES.text * LINE_RATIO,
    },
    seen: { width: `${SEEN_SHARE * 100}%`, gap: TV_SIZES.space2 },
    bar: {
      height: TV_SIZES.space1,
      borderRadius: TV_SIZES.radiusPill,
      overflow: 'hidden',
      backgroundColor: colours.track,
    },
    fill: { height: '100%', borderRadius: TV_SIZES.radiusPill, backgroundColor: colours.played },
    // Kept in the row's layout while hidden, so the words and the bar never shift as the remote moves.
    mark: {
      width: TV_SIZES.controlLarge,
      height: TV_SIZES.controlLarge,
      borderRadius: TV_SIZES.radiusPill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colours.accent,
    },
    hidden: { opacity: 0 },
    ring: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      borderWidth: TV_SIZES.tvFocusRing,
      borderRadius: TV_SIZES.radiusLg,
    },
  }),
)
