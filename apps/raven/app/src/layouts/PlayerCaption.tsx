import { type CueRun, cueRuns } from '@raven/core'
import { StyleSheet, Text } from 'react-native'

import { COLOURS, SIZES } from '@/theme/appTheme'

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
 * itself: WebVTT's italic, bold and underline runs on a dark plate. The chrome places it.
 */
export const CaptionText = ({ caption }: { caption: string }) => (
  <Text style={styles.caption}>
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

const styles = StyleSheet.create({
  caption: {
    maxWidth: SIZES.measure,
    paddingHorizontal: SIZES.space2,
    paddingVertical: SIZES.space1,
    borderRadius: SIZES.radius,
    overflow: 'hidden',
    backgroundColor: COLOURS.deep,
    color: COLOURS.onPicture,
    fontSize: SIZES.textLg,
    textAlign: 'center',
  },
  italic: { fontStyle: 'italic' },
  bold: { fontWeight: '700' },
  underline: { textDecorationLine: 'underline' },
})
