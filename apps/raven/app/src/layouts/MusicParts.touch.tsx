import type { ComponentType, ReactNode } from 'react'
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { PICTURE_STATES, type PictureState, pictureStateOf } from '@/layouts/Card'
import { MUSIC_COPY } from '@/layouts/copy'
import { type FavouriteButtonProps } from '@/layouts/musicKit'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { TouchNav } from '@/layouts/TouchNav'
import type { Picture } from '@/queries/cards'
import { OPACITIES, SIZES } from '@/theme/appTheme'
import { themedStyles } from '@/theme/useTheme'

/** What the music pages under the thumb share of their look: the page, the words and the rows. */
export const useMusicStyles = themedStyles((colours) =>
  StyleSheet.create({
    ground: { flex: 1, backgroundColor: colours.ground },
    page: { paddingHorizontal: SIZES.space4, gap: SIZES.space5 },
    stage: { alignItems: 'center', gap: SIZES.space2 },
    cover: {
      width: SIZES.cover,
      height: SIZES.cover,
      borderRadius: SIZES.radius,
      backgroundColor: colours.raised,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    coverPicture: { width: SIZES.cover, height: SIZES.cover },
    initial: { color: colours.muted, fontSize: SIZES.controlLarge },
    title: { color: colours.text, fontSize: SIZES.textXl, fontWeight: '600', textAlign: 'center' },
    heading: { color: colours.text, fontSize: SIZES.textLg, fontWeight: '600' },
    muted: { color: colours.muted, fontSize: SIZES.textSm },
    error: { color: colours.error, fontSize: SIZES.textSm },
    controls: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: SIZES.space2,
      justifyContent: 'center',
    },
    list: { gap: SIZES.space1 },
    section: { gap: SIZES.space2 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SIZES.space3,
      paddingVertical: SIZES.space2,
    },
    rowTitle: { color: colours.text, fontSize: SIZES.text },
    grow: { flex: 1 },
    length: { color: colours.muted, fontSize: SIZES.textSm },
    on: { color: colours.accent },
    entry: { flexDirection: 'row', alignItems: 'center', gap: SIZES.space3 },
    entryMain: { flex: 1, paddingVertical: SIZES.space2 },
    pressed: { opacity: OPACITIES.pressed },
    chip: {
      minHeight: SIZES.fieldHeight,
      justifyContent: 'center',
      paddingHorizontal: SIZES.space2,
      borderRadius: SIZES.radius,
      backgroundColor: colours.quiet,
    },
    chipOn: { backgroundColor: colours.accent },
    chipLabel: { color: colours.text, fontSize: SIZES.textSm, fontWeight: '600' },
    chipLabelOn: { color: colours.onAccent },
  }),
)

type TouchPageProps = { onBack: () => void; children: ReactNode }

/** A music page under the thumb: one page scrolled clear of the notch and the home bar, Back first. */
export const TouchPage = ({ onBack, children }: TouchPageProps) => {
  const insets = useSafeAreaInsets()
  const styles = useMusicStyles()
  return (
    <ScrollView
      contentContainerStyle={[
        styles.page,
        { paddingTop: insets.top + SIZES.space3, paddingBottom: insets.bottom + SIZES.space8 },
      ]}
      style={styles.ground}
    >
      <TouchNav onBack={onBack} />
      {children}
    </ScrollView>
  )
}

type CoverProps = { cover: Picture | null; title: string }

type CoverPictureProps = CoverProps

const CoverPicture = ({ cover }: CoverPictureProps) => {
  const styles = useMusicStyles()
  return cover !== null && <Image source={cover} style={styles.coverPicture} />
}

type CoverInitialProps = CoverProps

const CoverInitial = ({ title }: CoverInitialProps) => {
  const styles = useMusicStyles()
  return (
    <Text variant={TEXT_VARIANTS.display} style={styles.initial}>
      {title.slice(0, 1)}
    </Text>
  )
}

/** A cover's face: its picture, else its title's first letter. */
const COVER_FACES = {
  [PICTURE_STATES.shown]: CoverPicture,
  [PICTURE_STATES.missing]: CoverInitial,
} as const satisfies Record<PictureState, ComponentType<CoverProps>>

/** The cover at the shared scale's size, or the title's first letter while there is none. */
export const Cover = ({ cover, title }: CoverProps) => {
  const styles = useMusicStyles()
  const Face = COVER_FACES[pictureStateOf(cover)]
  return (
    <View style={styles.cover}>
      <Face cover={cover} title={title} />
    </View>
  )
}

/** A favourite mark in a toolbar: said as Favourite, and marked selected while it is on. */
export const FavouriteButton = ({ isFavourite, onToggle }: FavouriteButtonProps) => {
  const styles = useMusicStyles()
  return (
    <Pressable
      accessibilityLabel={MUSIC_COPY.favourite}
      accessibilityRole="button"
      accessibilityState={{ selected: isFavourite }}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.chip,
        isFavourite && styles.chipOn,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.chipLabel, isFavourite && styles.chipLabelOn]}>
        {MUSIC_COPY.favourite}
      </Text>
    </Pressable>
  )
}

type ListEntryProps = {
  /** What its press is called aloud. */
  label: string
  /** Said as selected and drawn in the accent: the track playing. */
  isSelected: boolean
  title: string
  line: string
  onPress: () => void
  /** The buttons beside it: Up, Remove. */
  children: ReactNode
}

/** A track in a list, its title over its line, pressed to play from it, beside its own buttons. */
export const ListEntry = ({
  label,
  isSelected,
  title,
  line,
  onPress,
  children,
}: ListEntryProps) => {
  const styles = useMusicStyles()
  return (
    <View style={styles.entry}>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected }}
        onPress={onPress}
        style={({ pressed }) => [styles.entryMain, pressed && styles.pressed]}
      >
        <Text numberOfLines={1} style={[styles.rowTitle, isSelected && styles.on]}>
          {title}
        </Text>
        <Text numberOfLines={1} style={styles.muted}>
          {line}
        </Text>
      </Pressable>
      {children}
    </View>
  )
}
