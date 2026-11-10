import { formatDuration } from '@raven/core'
import { Icon } from '@raven/native'
import type { IconName } from '@raven/ui/iconDrawings'
import type { ComponentType, ReactNode } from 'react'
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { PICTURE_STATES, type PictureState, pictureStateOf } from '@/layouts/Card'
import { MUSIC_COPY } from '@/layouts/copy'
import { type FavouriteButtonProps } from '@/layouts/musicKit'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { TouchNav } from '@/layouts/TouchNav'
import { useScrub } from '@/layouts/useScrub'
import type { Picture } from '@/queries/cards'
import { OPACITIES, SIZES } from '@/theme/appTheme'
import { themedStyles, useTheme } from '@/theme/useTheme'

/** The seek bar's height: a finger's, though the line it draws is thin. */
const SEEK_HEIGHT = 44

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
    iconPlate: {
      width: SIZES.controlLarge,
      height: SIZES.controlLarge,
      borderRadius: SIZES.radiusPill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colours.quiet,
    },
    iconPlateOn: { backgroundColor: colours.accent },
    iconPlateDisabled: { opacity: OPACITIES.disabled },
    seekBar: { alignSelf: 'stretch', gap: SIZES.space1 },
    seekLine: { height: SEEK_HEIGHT, justifyContent: 'center' },
    // The line stands in from each end by half the thumb, so the thumb at 0:00 or the end is whole.
    seekRail: { marginHorizontal: SIZES.space4 / 2, justifyContent: 'center' },
    seekTrack: {
      height: SIZES.space1,
      borderRadius: SIZES.space1,
      backgroundColor: colours.quiet,
      overflow: 'hidden',
    },
    seekPlayed: { height: '100%', backgroundColor: colours.accent },
    seekThumb: {
      position: 'absolute',
      width: SIZES.space4,
      height: SIZES.space4,
      marginLeft: -SIZES.space4 / 2,
      borderRadius: SIZES.space4,
      backgroundColor: colours.text,
    },
    seekTimes: { flexDirection: 'row', justifyContent: 'space-between' },
    seekTime: { color: colours.muted, fontSize: SIZES.textSm, fontVariant: ['tabular-nums'] },
  }),
)

type SeekBarProps = {
  position: number
  /** The track's length, or null until the player knows it: the bar stands empty until then. */
  duration: number | null
  onSeek: (seconds: number) => void
}

/**
 * Where the track is, as a line to drag along with the time played and the length under it, as
 * the film player's scrubber: the finger's spot shows as it moves and is sought on letting go.
 */
export const SeekBar = ({ position, duration, onSeek }: SeekBarProps) => {
  const styles = useMusicStyles()
  const length = duration ?? 0
  // The line stands in by half the thumb at each end, so the thumb at 0:00 or the end is whole.
  const { shown, share, lineProps } = useScrub({
    position,
    duration: length,
    onSeek,
    inset: SIZES.space4 / 2,
    canDrag: length > 0,
  })
  return (
    <View style={styles.seekBar}>
      <View {...lineProps} style={styles.seekLine}>
        <View pointerEvents="none" style={styles.seekRail}>
          <View style={styles.seekTrack}>
            <View style={[styles.seekPlayed, { width: share }]} />
          </View>
          <View style={[styles.seekThumb, { left: share }]} />
        </View>
      </View>
      <View style={styles.seekTimes}>
        <Text style={styles.seekTime}>{formatDuration(shown)}</Text>
        <Text style={styles.seekTime}>{formatDuration(duration)}</Text>
      </View>
    </View>
  )
}

type IconPlateProps = {
  /** What it says aloud, since it shows no words. */
  label: string
  icon: IconName
  /** Drawn in the accent: Play or Pause, and a mark that is on. */
  isOn: boolean
  /** Drawn faint, its press doing nothing: a download on its way. */
  isDisabled?: boolean
  onPress: () => void
}

/** A round control that shows only its icon, as the TV's Now Playing controls do. */
export const IconPlate = ({ label, icon, isOn, isDisabled = false, onPress }: IconPlateProps) => {
  const styles = useMusicStyles()
  const palette = useTheme((theme) => theme.palette)
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: isOn, disabled: isDisabled }}
      disabled={isDisabled}
      hitSlop={SIZES.space1}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconPlate,
        isOn && styles.iconPlateOn,
        isDisabled && styles.iconPlateDisabled,
        pressed && styles.pressed,
      ]}
    >
      <Icon colour={isOn ? palette.onAccent : palette.text} name={icon} size={SIZES.textXl} />
    </Pressable>
  )
}

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

type CoverProps = {
  cover: Picture | null
  title: string
  /** How wide the square stands; the shared scale's cover size unless told. */
  size?: number
}

type CoverPictureProps = CoverProps

const CoverPicture = ({ cover, size = SIZES.cover }: CoverPictureProps) => {
  const styles = useMusicStyles()
  return (
    cover !== null && (
      <Image source={cover} style={[styles.coverPicture, { width: size, height: size }]} />
    )
  )
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

/** The cover, `size` wide or the shared scale's size, or the title's first letter while there is none. */
export const Cover = ({ cover, title, size = SIZES.cover }: CoverProps) => {
  const styles = useMusicStyles()
  const Face = COVER_FACES[pictureStateOf(cover)]
  return (
    <View style={[styles.cover, { width: size, height: size }]}>
      <Face cover={cover} size={size} title={title} />
    </View>
  )
}

/** A favourite mark on a plate: the heart, filled in the accent while it is on, said as Favourite. */
export const FavouriteButton = ({ isFavourite, onToggle }: FavouriteButtonProps) => (
  <IconPlate icon="heart" isOn={isFavourite} label={MUSIC_COPY.favourite} onPress={onToggle} />
)

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
