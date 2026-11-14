import { type ComponentRef, type RefObject, useState } from 'react'
import { Animated, Pressable, TVFocusGuideView, View } from 'react-native'

import { Icon } from '@raven/native'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { TitleArt } from '@/layouts/TitleArt'
import { CENTRE_MARK_LOOKS, type ShownMark } from '@/layouts/centreMark'
import { chapterMarksOf } from '@/layouts/chapterMarks'
import { FocusFactChips } from '@/layouts/FactChips'
import { PickerList, usePickerList } from '@/layouts/Picker.focus'
import {
  PLAYER_COPY,
  type PlayerChromeProps,
  type Transport,
  type TrackPicker,
  cornerFactsOf,
  playedShareOf,
  scrubberAccessibilityOf,
} from '@/layouts/playerKit'
import { PlateButton } from '@/layouts/tvControls'
import type { IconName } from '@raven/ui/iconDrawings'
import { useClock } from '@raven/ui/headless'
import { useMarkFade } from '@/layouts/useMarkFade'
import { TV_SIZES } from '@/theme/tvSizes'
import { useTheme } from '@/theme/useTheme'
import {
  CENTRE_ICON,
  THUMB,
  THUMB_FOCUSED,
  LOGO_HEIGHT,
  useDpadChromeStyles,
} from '@/layouts/PlayerChromeStyles.dpad'

// The d-pad chrome's parts: the line, a track picker, the corner, the mark in the middle and the title.

export type Focusable = RefObject<ComponentRef<typeof Pressable> | null>

type ScrubberProps = {
  view: Focusable
  transport: Transport
  /** The file's chapters, notched along the line, the one playing a shade lighter than the rest. */
  chapters: PlayerChromeProps['chapters']
  onScrubbing: (isScrubbing: boolean) => void
}

/**
 * Where the video is, as a line the remote stands on: while it has the focus, left and right
 * skip ten seconds (the chrome hears them) and a press plays or pauses. It asks for the focus as
 * it appears and lets go once it has had it; on the player's first appearance the screen is
 * still sliding in, when only the preferred focus, set with the view, takes. TalkBack reads it as
 * the time of the length and skips by its own gesture.
 */
export const Scrubber = ({ view, transport, chapters, onScrubbing }: ScrubberProps) => {
  const [isOpening, setOpening] = useState(true)
  const { position, onSeek, onTogglePlay } = transport
  const styles = useDpadChromeStyles()
  const duration = transport.duration ?? 0
  const share = playedShareOf({ at: position, duration })
  const marks = chapterMarksOf({ chapters, duration, at: position })
  return (
    /*
     * Left and right are the scrubber's own: they seek, and a hold runs the playhead. Without the
     * trap the system moves the focus on the key going down, before the press reaches the player,
     * and left carried it off to Back, up and to the left, so it never skipped back.
     */
    <TVFocusGuideView trapFocusLeft trapFocusRight>
      <Pressable
        ref={view}
        {...scrubberAccessibilityOf({ position, shown: position, duration, onSeek })}
        hasTVPreferredFocus={isOpening}
        onBlur={() => onScrubbing(false)}
        onFocus={() => {
          setOpening(false)
          onScrubbing(true)
        }}
        onPress={onTogglePlay}
        style={styles.scrubber}
      >
        {({ focused }) => (
          <>
            <View style={[styles.line, focused && styles.lineFocused]}>
              {marks.current !== null && <View style={[styles.chapterSpan, marks.current]} />}
              <View style={[styles.played, { width: share }]} />
              {marks.notches.map((notch) => (
                <View key={notch.key} style={[styles.chapterNotch, { left: notch.left }]} />
              ))}
            </View>
            <View
              style={[
                styles.thumb,
                focused && styles.thumbFocused,
                { left: share, marginLeft: -(focused ? THUMB_FOCUSED : THUMB) / 2 },
              ]}
            />
          </>
        )}
      </Pressable>
    </TVFocusGuideView>
  )
}

type TrackButtonProps = {
  icon: IconName
  label: string
  picker: TrackPicker
  onPicking: (isPicking: boolean) => void
}

/** A track picker as an icon on the player's glass, said with its choice, opening its list over the video. */
export const TrackButton = ({ icon, label, picker, onPicking }: TrackButtonProps) => {
  const {
    open,
    label: said,
    list,
  } = usePickerList({
    ...picker,
    label,
    isOverPicture: true,
    onOpenChange: onPicking,
  })
  return (
    <>
      <PlateButton icon={icon} isOverPicture label={said} onPress={open} />
      <PickerList {...list} />
    </>
  )
}

type CornerProps = Pick<PlayerChromeProps, 'mode' | 'heading'>

/**
 * The top right corner, one thing under another: the time of day, the picture's chips, then how
 * the video plays on a line of its own, read out together.
 */
export const Corner = ({ mode, heading }: CornerProps) => {
  const styles = useDpadChromeStyles()
  const { clock, chips, way, label } = cornerFactsOf({ mode, heading, clock: useClock() })
  return (
    <View accessibilityLabel={label} accessible style={styles.corner}>
      <Text variant={TEXT_VARIANTS.display} numberOfLines={1} style={styles.clock}>
        {clock}
      </Text>
      {chips.length > 0 && (
        <View style={styles.cornerChips}>
          <FocusFactChips parts={chips} />
        </View>
      )}
      {way !== null && (
        <View style={styles.chip}>
          <Text style={styles.chipText}>{way}</Text>
        </View>
      )}
    </View>
  )
}

type CentreProps = ShownMark

/**
 * What just happened, in the middle of the picture: a skip's way and how far it went, a play, or
 * the pause, on the player's glass. A flash stands for a moment and fades, or goes at once when
 * the system asks for less motion; a pause or a hold stays until it ends. Said aloud as it
 * appears.
 */
export const Centre = ({ mark, seconds, isFading }: CentreProps) => {
  const styles = useDpadChromeStyles()
  const colour = useTheme((theme) => theme.overPicture.text)
  const { opacity, isGone } = useMarkFade({ isFading })
  const look = CENTRE_MARK_LOOKS[mark]
  return (
    !isGone && (
      <View pointerEvents="none" style={styles.centreSlot}>
        <Animated.View
          accessibilityLabel={look.label(seconds)}
          accessibilityLiveRegion="polite"
          accessible
          style={[styles.centre, { opacity }]}
        >
          <Icon colour={colour} name={look.icon} size={CENTRE_ICON} />
          {look.text !== null && <Text style={styles.centreText}>{look.text(seconds)}</Text>}
        </Animated.View>
      </View>
    )
  )
}

type HeadingLinesProps = Pick<PlayerChromeProps, 'heading'>

/**
 * The title along the top as lines, as the web player's: the show's art (or a film's) on a row
 * of its own, an episode's own name, then the line of what it is (its season and number, its
 * length and its year). A title is marked a favourite on its own page, never here.
 */
export const Heading = ({ heading }: HeadingLinesProps) => {
  const styles = useDpadChromeStyles()
  const details = [heading.place, heading.length, heading.year]
    .filter((part): part is string => part !== null)
    .join(PLAYER_COPY.separator)
  // A film's art is its own name; an episode's is its show's, with its own name under it.
  const episodeName = heading.show === null ? null : heading.title
  return (
    <View style={styles.heading}>
      <View accessibilityRole="header">
        <TitleArt
          height={LOGO_HEIGHT}
          logo={heading.logo}
          maxWidth={TV_SIZES.measure}
          name={heading.show ?? heading.title}
          textStyle={styles.show}
        />
      </View>
      {episodeName !== null && (
        <Text variant={TEXT_VARIANTS.display} numberOfLines={2} style={styles.title}>
          {episodeName}
        </Text>
      )}
      {details !== '' && <Text style={styles.details}>{details}</Text>}
    </View>
  )
}
