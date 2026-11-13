import { StyleSheet } from 'react-native'

import { OPACITIES, SEEK_LINE_HEIGHT, SIZES } from '@/theme/appTheme'
import { pictureStyles } from '@/theme/useTheme'

// The touch chrome's styles, dark in every theme as the web player's.

/** How dark the ground is laid over the picture under the controls. */
const SCRIM_OPACITY = 0.45

/** The web's icon sizes: its transport, its play and its glass pills. */
export const ICON_SIZES = { transport: 24, play: 28, pill: 20, skip: 32 } as const

/** The vertical volume slider's track: a field wide, six fields tall, standing over its speaker. */
const VOLUME_TRACK = { width: SIZES.fieldHeight, height: SIZES.fieldHeight * 6 } as const

/** How tall the title art in the corner stands, and the share of the screen's width it may take. */
export const LOGO_HEIGHT = SIZES.space6 * 1.5
export const LOGO_WIDTH_SHARE = 0.4

export const useTouchChromeStyles = pictureStyles((colours) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colours.ground },
    scrim: {
      ...StyleSheet.absoluteFill,
      backgroundColor: colours.ground,
      opacity: SCRIM_OPACITY,
    },
    frame: { flex: 1, justifyContent: 'space-between' },
    top: { flexDirection: 'row', alignItems: 'flex-start', gap: SIZES.space3 },
    // Beside Back, its art centred on the button's height until the art stands taller.
    logoSlot: { flexShrink: 1, minHeight: SIZES.controlLarge, justifyContent: 'center' },
    logo: { gap: SIZES.space1 },
    // Pushed to the right edge, never squeezed by the title, which shrinks instead.
    cornerSlot: { flex: 1, alignItems: 'flex-end' },
    corner: { flexShrink: 0, alignItems: 'flex-end', gap: SIZES.space1 },
    // The time of day over any picture, so a shadow keeps it readable unfaded.
    clock: {
      color: colours.text,
      fontSize: SIZES.textXl,
      fontVariant: ['tabular-nums'],
      textShadowColor: colours.ground,
      textShadowRadius: SIZES.space2,
    },
    // Direct play, Remux or Transcode, on the player's glass.
    wayChip: {
      paddingHorizontal: SIZES.space2,
      paddingVertical: SIZES.space0,
      borderRadius: SIZES.radiusSm,
      backgroundColor: colours.quiet,
    },
    wayText: { color: colours.text, fontSize: SIZES.textXs, fontWeight: 'bold' },
    // The name where there is no art, over any picture, so a shadow keeps it readable unfaded.
    title: {
      color: colours.text,
      fontSize: SIZES.textLg,
      fontWeight: '600',
      textShadowColor: colours.ground,
      textShadowRadius: SIZES.space2,
    },
    place: {
      color: colours.text,
      fontSize: SIZES.textSm,
      textShadowColor: colours.ground,
      textShadowRadius: SIZES.space2,
    },
    bottom: { gap: SIZES.space1 },
    timeline: { flexDirection: 'row', alignItems: 'center', gap: SIZES.space3 },
    bar: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: SIZES.space2,
    },
    run: { flexDirection: 'row', alignItems: 'center', gap: SIZES.space1 },
    skipIcon: {
      width: ICON_SIZES.skip,
      height: ICON_SIZES.skip,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The circle's centre sits a little below the icon's, so the seconds do too.
    skipSeconds: {
      position: 'absolute',
      color: colours.text,
      fontSize: SIZES.textXs,
      fontWeight: 'bold',
      marginTop: SIZES.space0,
    },
    // The speaker's slot: one control wide, so the slider over it never lies over a neighbour.
    volumeSlot: {
      width: SIZES.controlLarge,
      height: SIZES.controlLarge,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The slider's glass plate, standing over the speaker with a gap between them.
    volumePlate: {
      position: 'absolute',
      bottom: SIZES.controlLarge + SIZES.space2,
      padding: SIZES.space2,
      borderRadius: SIZES.space3,
      backgroundColor: colours.quiet,
    },
    volumeSlider: { ...VOLUME_TRACK, alignItems: 'center', justifyContent: 'flex-end' },
    upright: {
      width: SIZES.space1,
      height: '100%',
      borderRadius: SIZES.space1,
      backgroundColor: colours.track,
      overflow: 'hidden',
      justifyContent: 'flex-end',
    },
    filled: { width: '100%', backgroundColor: colours.played },
    uprightThumb: {
      position: 'absolute',
      width: SIZES.space4,
      height: SIZES.space4,
      marginBottom: -SIZES.space4 / 2,
      borderRadius: SIZES.space4,
      backgroundColor: colours.text,
    },
    time: { color: colours.text, fontSize: SIZES.textSm, fontVariant: ['tabular-nums'] },
    scrubberSlot: { flex: 1 },
    scrubber: { height: SEEK_LINE_HEIGHT, justifyContent: 'center' },
    line: {
      height: SIZES.space1,
      borderRadius: SIZES.space1,
      backgroundColor: colours.track,
      overflow: 'hidden',
    },
    played: { height: '100%', backgroundColor: colours.played },
    thumb: {
      position: 'absolute',
      width: SIZES.space4,
      height: SIZES.space4,
      marginLeft: -SIZES.space4 / 2,
      borderRadius: SIZES.space4,
      backgroundColor: colours.text,
    },
    round: {
      width: SIZES.controlLarge,
      height: SIZES.controlLarge,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: SIZES.controlLarge,
    },
    // The web's pills and back: dark glass, the same in every theme.
    glass: { backgroundColor: colours.quiet },
    pressed: { opacity: OPACITIES.pressed },
    captionSlot: {
      ...StyleSheet.absoluteFill,
      alignItems: 'center',
      justifyContent: 'flex-end',
      // Clear of the time and the scrubber along the bottom.
      marginBottom: SIZES.controlLarge + SIZES.space4,
    },
    noticeSlot: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
    notice: {
      maxWidth: SIZES.measure,
      color: colours.text,
      fontSize: SIZES.text,
      textAlign: 'center',
    },
  }),
)
