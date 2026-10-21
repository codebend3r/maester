import { type CueRun, cueRuns } from '@raven/core'
import { StyleSheet, Text } from 'react-native'

import { SIZES } from '@/theme/appTheme'
import { pictureStyles } from '@/theme/useTheme'

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

/**
 * The subtitle cues showing now, as raven draws them over the video wherever it draws them
 * itself: WebVTT's italic, bold and underline runs on the picture's dark glass in every theme. The chrome places it, and a
 * TV's sizes the text to its screen (`fontSize`).
 */
export const CaptionText = ({
  caption,
  fontSize = SIZES.textLg,
}: {
  caption: string
  fontSize?: number
}) => {
  const styles = useStyles()
  return (
    <Text style={[styles.caption, { fontSize }]}>
      {keyedRuns(caption).map((run) => (
        <Text
          key={run.key}
          style={[
            run.italic && styles.italic,
            run.bold && styles.bold,
            run.underline && styles.underline,
          ]}
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
      borderRadius: SIZES.radius,
      overflow: 'hidden',
      backgroundColor: colours.raised,
      color: colours.text,
      textAlign: 'center',
    },
    italic: { fontStyle: 'italic' },
    bold: { fontWeight: '700' },
    underline: { textDecorationLine: 'underline' },
  }),
)
