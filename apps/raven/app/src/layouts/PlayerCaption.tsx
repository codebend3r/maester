import { CAPTION_COLOUR_VALUES, type CaptionStyle, type CueRun, cueRuns } from '@raven/core'
import { type DimensionValue, StyleSheet, View } from 'react-native'

import { TEXT_VARIANTS, Text } from '@/layouts/Text'
import { captionSizeOf } from '@/player/captionLook'
import { SIZES } from '@/theme/appTheme'
import { pictureStyles } from '@/theme/useTheme'

/** How thick the dark outline around the letters is, as a share of the caption's size. */
const OUTLINE_SHARE = 0.06

/** The thinnest outline drawn, so a small caption still reads on a bright picture. */
const OUTLINE_MIN = 1.5

/*
 * React Native's Text has no stroke, so the outline is the caption drawn again in the edge
 * colour, nudged one outline width each way round the compass, behind the coloured letters.
 * Android TV's ExoPlayer draws the same outline natively.
 */
const OUTLINE_DIRECTIONS = [
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: -1, y: 1 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
] as const

/** A styled run of a cue with a key of its own among the cue's runs. */
type KeyedRun = CueRun & { key: string }

/** A cue's styled runs, each keyed by where it starts in the cue's text. */
const keyedRuns = (text: string): KeyedRun[] =>
  cueRuns(text)
    .filter((run) => run.text !== '')
    .reduce<{ at: number; runs: KeyedRun[] }>(
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
  /** How wide a line runs before it wraps; a TV's spans the picture, as ExoPlayer's does. */
  maxWidth?: DimensionValue
}

type CaptionRunsProps = {
  runs: KeyedRun[]
}

const CaptionRuns = ({ runs }: CaptionRunsProps) => {
  const styles = useStyles()
  return runs.map((run) => (
    <Text
      key={run.key}
      variant={TEXT_VARIANTS.display}
      style={[run.italic && styles.italic, run.underline && styles.underline]}
    >
      {run.text}
    </Text>
  ))
}

/**
 * The subtitle cues showing now, as raven draws them over the video wherever it draws them
 * itself: the display face in the account's colour and size inside a dark outline, with
 * WebVTT's italic and underline runs. The face has one weight, so a bold run is drawn as the
 * rest. The chrome places it.
 */
export const CaptionText = ({
  caption,
  look,
  baseSize = SIZES.textLg,
  maxWidth = SIZES.measure,
}: CaptionTextProps) => {
  const styles = useStyles()
  const fontSize = captionSizeOf({ base: baseSize, style: look })
  const outline = Math.max(OUTLINE_MIN, fontSize * OUTLINE_SHARE)
  const runs = keyedRuns(caption)
  return (
    <View style={[styles.block, { maxWidth }]}>
      {OUTLINE_DIRECTIONS.map(({ x, y }) => (
        <Text
          key={`${String(x)}:${String(y)}`}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          variant={TEXT_VARIANTS.display}
          style={[
            styles.caption,
            styles.edge,
            {
              fontSize,
              transform: [{ translateX: x * outline }, { translateY: y * outline }],
            },
          ]}
        >
          <CaptionRuns runs={runs} />
        </Text>
      ))}
      <Text
        variant={TEXT_VARIANTS.display}
        style={[styles.caption, { color: CAPTION_COLOUR_VALUES[look.colour], fontSize }]}
      >
        <CaptionRuns runs={runs} />
      </Text>
    </View>
  )
}

const useStyles = pictureStyles((colours) =>
  StyleSheet.create({
    block: {
      paddingHorizontal: SIZES.space2,
      paddingVertical: SIZES.space1,
    },
    caption: { textAlign: 'center' },
    // Laid over the coloured caption inside the same padding, so its lines wrap the same.
    edge: {
      position: 'absolute',
      top: SIZES.space1,
      bottom: SIZES.space1,
      left: SIZES.space2,
      right: SIZES.space2,
      color: colours.ground,
    },
    italic: { fontStyle: 'italic' },
    underline: { textDecorationLine: 'underline' },
  }),
)
