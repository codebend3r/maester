import type { StyleProp, TextStyle, ViewStyle } from 'react-native'
import { Image, StyleSheet, View } from 'react-native'

import type { ItemHero, PersonCard } from '@/queries/itemPage'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'

/** The styles the shared parts of an item's page wear, at each layout's own scale. */
export type ItemPartStyles = {
  heading: StyleProp<TextStyle>
  title: StyleProp<TextStyle>
  initials: StyleProp<TextStyle>
  progress: StyleProp<ViewStyle>
  track: StyleProp<ViewStyle>
  fill: StyleProp<ViewStyle>
  progressLabel: StyleProp<TextStyle>
}

type HeadingProps = { title: string }

type HeroTitleWordsProps = { hero: ItemHero }

type ProgressLineProps = { progress: NonNullable<ItemHero['progress']> }

type PersonProps = { person: PersonCard }

/** A person's photo, filling its circle; none where they have none. */
const PersonPicture = ({ person }: PersonProps) =>
  person.picture !== null && (
    <Image resizeMode="cover" source={person.picture} style={StyleSheet.absoluteFill} />
  )

type ItemPartsForProps = {
  /** The layout's styles for the parts, in the theme worn now. */
  useStyles: () => ItemPartStyles
}

/**
 * The parts an item's page draws the same on a TV and under the thumb: a row's heading, the
 * title in type, the line of where playback stopped, and a person's photo or initials. Each
 * layout hands its own styles, as `lockKitFor`'s callers do.
 */
export const itemPartsFor = ({ useStyles }: ItemPartsForProps) => {
  const Heading = ({ title }: HeadingProps) => {
    const styles = useStyles()
    return (
      <Text variant={TEXT_VARIANTS.display} accessibilityRole="header" style={styles.heading}>
        {title}
      </Text>
    )
  }

  const HeroTitleWords = ({ hero }: HeroTitleWordsProps) => {
    const styles = useStyles()
    return (
      <Text variant={TEXT_VARIANTS.display} accessibilityRole="header" style={styles.title}>
        {hero.title}
      </Text>
    )
  }

  /** Where playback stopped, or how much is watched, as a line with its words. */
  const ProgressLine = ({ progress }: ProgressLineProps) => {
    const styles = useStyles()
    return (
      <View style={styles.progress}>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${progress.fraction * 100}%` }]} />
        </View>
        <Text style={styles.progressLabel}>{progress.label}</Text>
      </View>
    )
  }

  const PersonInitials = ({ person }: PersonProps) => {
    const styles = useStyles()
    return (
      <Text variant={TEXT_VARIANTS.display} style={styles.initials}>
        {person.initials}
      </Text>
    )
  }

  return { Heading, HeroTitleWords, ProgressLine, PersonPicture, PersonInitials }
}
