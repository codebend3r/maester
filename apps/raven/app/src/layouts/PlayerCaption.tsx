import { CAPTION_COLOUR_VALUES, type CaptionStyle, type CueRun, cueRuns } from '@raven/core'
import { StyleSheet } from 'react-native'

import { TEXT_VARIANTS, Text } from '@/layouts/Text'
import { captionSizeOf } from '@/player/captionLook'
import { SIZES } from '@/theme/appTheme'
import { pictureStyles } from '@/theme/useTheme'

/** How far the dark edge behind the letters spreads, which keeps any colour legible on any picture. */
const EDGE_RADIUS = 4

/** A cue's styled runs, each keyed by where it starts in the cue's text. */
const keyedRuns = (text: string): (CueRun & { key: string })[] =>
  cueRuns(text)
    .filter((run) => run.text !== '')
    .reduce<{ at: number; runs: (CueRun & { key: string })[] }>(
      ({ at, runs }, run) => ({
        at: at + run.text.length,
        runs: [...runs, { ...run, key: String(at) }],
      }),
      { at: 0, runs: [] },
    ).runs

type CaptionTextProps = {
  caption: string
  /** The account's subtitle size and colour, the same for every video on every device. */
  look: CaptionStyle
  /** The size a medium caption stands at on this screen; a TV's is sized to it. */
  baseSize?: number
}

/**
 * The subtitle cues showing now, as raven draws them over the video wherever it draws them
 * itself: the display face in the account's colour and size behind a dark edge, with WebVTT's
 * italic and underline runs. The face has one weight, so a bold run is drawn as the rest. The
 * chrome places it.
 */
export const CaptionText = ({ caption, look, baseSize = SIZES.textLg }: CaptionTextProps) => {
  const styles = useStyles()
  return (
    <Text
      variant={TEXT_VARIANTS.display}
      style={[
        styles.caption,
        {
          color: CAPTION_COLOUR_VALUES[look.colour],
          fontSize: captionSizeOf({ base: baseSize, style: look }),
        },
      ]}
    >
      {keyedRuns(caption).map((run) => (
        <Text
          key={run.key}
          variant={TEXT_VARIANTS.display}
          style={[run.italic && styles.italic, run.underline && styles.underline]}
        >
          {run.text}
        </Text>
      ))}
    </Text>
  )
}

const useStyles = pictureStyles((colours) =>
  StyleSheet.create({
    caption: {
      maxWidth: SIZES.measure,
      paddingHorizontal: SIZES.space2,
      paddingVertical: SIZES.space1,
      textAlign: 'center',
      textShadowColor: colours.ground,
      textShadowRadius: EDGE_RADIUS,
    },
    italic: { fontStyle: 'italic' },
    underline: { textDecorationLine: 'underline' },
  }),
)
