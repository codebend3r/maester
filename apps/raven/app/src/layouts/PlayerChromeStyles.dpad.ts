import { StyleSheet } from 'react-native'

import { LINE_RATIO } from '@/layouts/textHeights'
import { TV_GUTTER, TV_SIZES, tvSize } from '@/theme/tvSizes'
import { pictureStyles } from '@/theme/useTheme'

// The d-pad chrome's styles, dark in every theme as the web player's, at the TV's scale.

/** How dark the ground is laid over the picture under the controls. */
const SCRIM_OPACITY = 0.45

/** How large the icon in the middle stands. */
export const CENTRE_ICON = TV_SIZES.textXl * 2

/** The thumb on the line, and how much it grows while the remote is on it. */
export const THUMB = TV_SIZES.space4
export const THUMB_FOCUSED = TV_SIZES.space6

/** How wide the cut in the line is where a chapter begins: a hairline, two points on a 1920 point screen. */
const CHAPTER_NOTCH = tvSize(2)

/** How much the chapter playing lightens the track under it: enough to see, never to compete with the played line. */
const CHAPTER_SPAN_OPACITY = 0.22

/** How tall a show's title art stands over the video; its width follows the art's own shape. */
export const LOGO_HEIGHT = TV_SIZES.space8 * 1.2

/** How much smaller than the page's type the episode's name and its line of facts stand. */
const HEADING_TYPE_SCALE = 0.6

/** How large the time of day stands in the corner: larger than any line of the page's type. */
const CLOCK_SIZE = TV_SIZES.textXl * 1.5

export const useDpadChromeStyles = pictureStyles((colours) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colours.ground },
    scrim: {
      ...StyleSheet.absoluteFill,
      backgroundColor: colours.ground,
      opacity: SCRIM_OPACITY,
    },
    frame: { flex: 1, justifyContent: 'space-between', padding: TV_GUTTER },
    top: { flexDirection: 'row', justifyContent: 'space-between', gap: TV_SIZES.space4 },
    topStart: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      flexShrink: 1,
      gap: TV_SIZES.space4,
    },
    heading: { gap: TV_SIZES.space2, maxWidth: TV_SIZES.measure },
    /*
     * Never squeezed by the heading beside it, which shrinks instead, and as wide as the clock
     * needs: the time is always whole on one line.
     */
    corner: { flexShrink: 0, alignItems: 'flex-end', gap: TV_SIZES.space2 },
    cornerChips: { flexDirection: 'row', alignItems: 'center', gap: TV_SIZES.space1 },
    clock: {
      flexShrink: 0,
      color: colours.text,
      fontSize: CLOCK_SIZE,
      lineHeight: CLOCK_SIZE * LINE_RATIO,
      fontVariant: ['tabular-nums'],
    },
    show: { color: colours.text, fontSize: TV_SIZES.textXl, fontWeight: 'bold' },
    // Its season and number, its length and its year.
    details: {
      color: colours.muted,
      fontSize: TV_SIZES.textLg * HEADING_TYPE_SCALE,
      fontVariant: ['tabular-nums'],
    },
    title: {
      flexShrink: 1,
      color: colours.text,
      fontSize: TV_SIZES.textXl * HEADING_TYPE_SCALE,
    },
    chip: {
      paddingHorizontal: TV_SIZES.space2,
      paddingVertical: TV_SIZES.space0,
      borderRadius: TV_SIZES.radius,
      backgroundColor: colours.quiet,
    },
    chipText: { color: colours.text, fontSize: TV_SIZES.text, fontVariant: ['tabular-nums'] },
    bottom: { gap: TV_SIZES.space3 },
    timeline: { flexDirection: 'row', alignItems: 'center', gap: TV_SIZES.space3 },
    time: { color: colours.text, fontSize: TV_SIZES.text, fontVariant: ['tabular-nums'] },
    /*
     * Room at each end for the focused thumb, which is centred on the line's end and would
     * otherwise sit over the time beside it.
     */
    scrubberSlot: { flex: 1, paddingHorizontal: THUMB_FOCUSED / 2 },
    scrubber: { height: TV_SIZES.controlLarge, justifyContent: 'center' },
    line: {
      height: TV_SIZES.space1,
      borderRadius: TV_SIZES.space1,
      backgroundColor: colours.track,
      overflow: 'hidden',
    },
    lineFocused: { height: TV_SIZES.space2 },
    played: { height: '100%', backgroundColor: colours.played },
    // The chapter playing, a shade over the track, so its length reads at a glance.
    chapterSpan: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      backgroundColor: colours.text,
      opacity: CHAPTER_SPAN_OPACITY,
    },
    // A slim cut in the line where a chapter begins, in the stage's dark.
    chapterNotch: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      width: CHAPTER_NOTCH,
      marginLeft: -CHAPTER_NOTCH / 2,
      backgroundColor: colours.ground,
    },
    thumb: {
      position: 'absolute',
      width: THUMB,
      height: THUMB,
      borderRadius: THUMB,
      backgroundColor: colours.text,
    },
    thumbFocused: {
      width: THUMB_FOCUSED,
      height: THUMB_FOCUSED,
      borderRadius: THUMB_FOCUSED,
      borderWidth: TV_SIZES.tvFocusRing,
      borderColor: colours.played,
    },
    // The transport at the left, the track pickers at the right.
    buttons: { flexDirection: 'row', justifyContent: 'space-between', gap: TV_SIZES.space3 },
    buttonGroup: { flexDirection: 'row', gap: TV_SIZES.space3 },
    captionSlot: {
      ...StyleSheet.absoluteFill,
      alignItems: 'center',
      justifyContent: 'flex-end',
      paddingHorizontal: TV_GUTTER,
    },
    noticeSlot: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
    centreSlot: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
    centre: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TV_SIZES.space2,
      paddingVertical: TV_SIZES.space4,
      paddingHorizontal: TV_SIZES.space5,
      borderRadius: TV_SIZES.radius * 3,
      backgroundColor: colours.raised,
    },
    centreText: {
      color: colours.text,
      fontSize: TV_SIZES.textXl,
      fontWeight: 'bold',
      fontVariant: ['tabular-nums'],
    },
    notice: {
      maxWidth: TV_SIZES.measure,
      color: colours.text,
      fontSize: TV_SIZES.textLg,
      textAlign: 'center',
    },
  }),
)
