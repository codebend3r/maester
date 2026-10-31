import type { IconName } from '@raven/ui/iconDrawings'
import { type ComponentRef, type ComponentType, type ReactNode, useRef } from 'react'
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { PICTURE_STATES, type PictureState, pictureStateOf } from '@/layouts/Card'
import { useFocusOnMount, useOpeningFocus } from '@/layouts/focus'
import { BUTTON_TONES, type ButtonTone } from '@/layouts/formKit'
import { useToneStyles } from '@/layouts/formStyles'
import { Icon } from '@raven/native'
import { MUSIC_COPY } from '@/layouts/copy'
import { type FavouriteButtonProps } from '@/layouts/musicKit'
import { Text } from '@/layouts/Text'
import { LINE_RATIO } from '@/layouts/textHeights'
import type { Picture } from '@/queries/cards'
import { TV_GUTTER, TV_SIZES, tvSize } from '@/theme/tvSizes'
import { themedStyles, useTheme } from '@/theme/useTheme'

/** How wide the words beside a cover run. */
const WORDS_WIDTH = tvSize(1040)

/** What the TV's music pages share of their look: the page, the words, the plates and the rows. */
export const useMusicStyles = themedStyles((colours) =>
  StyleSheet.create({
    ground: { flex: 1, backgroundColor: colours.ground },
    page: {
      gap: TV_SIZES.space5,
      paddingTop: TV_SIZES.space6,
      paddingBottom: TV_SIZES.space6,
      paddingHorizontal: TV_GUTTER,
    },
    hero: { flexDirection: 'row', alignItems: 'flex-start', gap: TV_SIZES.space6 },
    words: { flex: 1, maxWidth: WORDS_WIDTH, gap: TV_SIZES.space2 },
    cover: {
      borderRadius: TV_SIZES.radius,
      backgroundColor: colours.raised,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    initial: { color: colours.muted, fontSize: TV_SIZES.textXl, fontWeight: 'bold' },
    eyebrow: { color: colours.muted, fontSize: TV_SIZES.textLg, fontWeight: '600' },
    title: {
      color: colours.text,
      fontSize: TV_SIZES.textXl,
      lineHeight: TV_SIZES.textXl * LINE_RATIO,
      fontWeight: 'bold',
    },
    line: { color: colours.text, fontSize: TV_SIZES.textLg },
    muted: { color: colours.muted, fontSize: TV_SIZES.text },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: TV_SIZES.space3,
      paddingVertical: TV_SIZES.space1,
    },
    action: {
      minWidth: TV_SIZES.controlLarge,
      minHeight: TV_SIZES.controlLarge,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: TV_SIZES.space2,
      paddingHorizontal: TV_SIZES.space4,
      borderRadius: TV_SIZES.radius,
      borderWidth: TV_SIZES.tvFocusRing,
    },
    actionLabel: { fontSize: TV_SIZES.textLg, fontWeight: 'bold' },
    focused: { borderColor: colours.text },
    section: { gap: TV_SIZES.space1 },
    heading: { color: colours.text, fontSize: TV_SIZES.textXl, fontWeight: 'bold' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TV_SIZES.space4,
      paddingVertical: TV_SIZES.space2,
      paddingHorizontal: TV_SIZES.space3,
      borderRadius: TV_SIZES.radius,
      borderWidth: TV_SIZES.tvFocusRing,
      borderColor: 'transparent',
    },
    focusedRow: { borderColor: colours.text, backgroundColor: colours.quiet },
    number: {
      color: colours.muted,
      fontSize: TV_SIZES.text,
      width: TV_SIZES.space8,
      textAlign: 'right',
    },
    rowTitle: { flex: 1, color: colours.text, fontSize: TV_SIZES.textLg, fontWeight: '600' },
    on: { color: colours.accent },
  }),
)

type FocusPageProps = { children: ReactNode }

/** A music page on a TV: one column scrolled as the remote moves down it, over the ground. */
export const FocusPage = ({ children }: FocusPageProps) => {
  const styles = useMusicStyles()
  return (
    <ScrollView contentContainerStyle={styles.page} style={styles.ground}>
      {children}
    </ScrollView>
  )
}

type CoverProps = { cover: Picture | null; title: string; size: number }

type CoverPictureProps = CoverProps

const CoverPicture = ({ cover, size }: CoverPictureProps) =>
  cover !== null && <Image source={cover} style={{ width: size, height: size }} />

type CoverInitialProps = CoverProps

const CoverInitial = ({ title }: CoverInitialProps) => {
  const styles = useMusicStyles()
  return <Text style={styles.initial}>{title.slice(0, 1)}</Text>
}

/** A cover's face: its picture, else its title's first letter. */
const COVER_FACES = {
  [PICTURE_STATES.shown]: CoverPicture,
  [PICTURE_STATES.missing]: CoverInitial,
} as const satisfies Record<PictureState, ComponentType<CoverProps>>

/** A square cover, or the title's first letter while there is none. */
export const Cover = ({ cover, title, size }: CoverProps) => {
  const styles = useMusicStyles()
  const Face = COVER_FACES[pictureStateOf(cover)]
  return (
    <View style={[styles.cover, { width: size, height: size }]}>
      <Face cover={cover} size={size} title={title} />
    </View>
  )
}

type ActionPlateProps = {
  label: string
  icon: IconName | null
  text: string | null
  tone: ButtonTone
  /** Asks the remote's focus as the page opens. */
  isPreferred: boolean
  /** Said as selected, for a mark that is on. */
  isOn?: boolean
  onPress: () => void
}

/**
 * A page's action on a plate: its icon, its few words, or both, ringed while focused. The one the
 * page opens on asks for the focus as it is drawn, through `hasTVPreferredFocus` and again once
 * mounted, since Android TV can open with nothing focused otherwise.
 */
export const ActionPlate = ({
  label,
  icon,
  text,
  tone,
  isPreferred,
  isOn = false,
  onPress,
}: ActionPlateProps) => {
  const view = useRef<ComponentRef<typeof Pressable>>(null)
  const { settle } = useOpeningFocus()
  const styles = useMusicStyles()
  const toneStyles = useToneStyles()
  const palette = useTheme((theme) => theme.palette)
  const colour = tone === BUTTON_TONES.primary ? palette.onAccent : palette.text
  useFocusOnMount({ view, isAsked: isPreferred })
  return (
    <Pressable
      ref={view}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: isOn }}
      hasTVPreferredFocus={isPreferred}
      onFocus={settle}
      onPress={onPress}
      style={({ focused }) => [styles.action, toneStyles[tone].button, focused && styles.focused]}
    >
      {({ focused }) => (
        <>
          {icon !== null && (
            <Icon colour={colour} isFocused={focused} name={icon} size={TV_SIZES.textXl} />
          )}
          {text !== null && (
            <Text style={[styles.actionLabel, toneStyles[tone].label]}>{text}</Text>
          )}
        </>
      )}
    </Pressable>
  )
}

/** A favourite mark on a plate: the heart, filled in the primary tone while it is on. */
export const FavouriteButton = ({ isFavourite, onToggle }: FavouriteButtonProps) => (
  <ActionPlate
    icon="heart"
    isOn={isFavourite}
    isPreferred={false}
    label={MUSIC_COPY.favourite}
    onPress={onToggle}
    text={null}
    tone={isFavourite ? BUTTON_TONES.primary : BUTTON_TONES.quiet}
  />
)

type FocusRowProps = {
  /** What it is called aloud. */
  label: string
  /** Said as selected: the track or chapter playing. */
  isSelected: boolean
  onPress: () => void
  children: ReactNode
}

/** A row the remote moves down to and presses, ringed and lifted while focused. */
export const FocusRow = ({ label, isSelected, onPress, children }: FocusRowProps) => {
  const { settle } = useOpeningFocus()
  const styles = useMusicStyles()
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      onFocus={settle}
      onPress={onPress}
      style={({ focused }) => [styles.row, focused && styles.focusedRow]}
    >
      {children}
    </Pressable>
  )
}
