import type { StyleProp, TextStyle, ViewStyle } from 'react-native'
import { View } from 'react-native'

import type { SettingsLineProps, SettingsSectionProps } from '@/layouts/settingsKit'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'

/** The styles the shared parts of Settings wear, at each layout's own scale. */
export type SettingsPartStyles = {
  section: StyleProp<ViewStyle>
  heading: StyleProp<TextStyle>
  note: StyleProp<TextStyle>
  line: StyleProp<TextStyle>
}

type SettingsPartsForProps = {
  /** The layout's styles for the parts, in the theme worn now. */
  useStyles: () => SettingsPartStyles
}

/** What a line is to a screen reader: an alert it says at once, or plain text. */
const LINE_ROLES = { alert: 'alert', text: 'text' } as const

/**
 * The parts Settings draws the same on a TV and under the thumb: a section under its heading
 * with its note, and a line of words. Each layout hands its own styles.
 */
export const settingsPartsFor = ({ useStyles }: SettingsPartsForProps) => {
  const SettingsSection = ({ title, note, children }: SettingsSectionProps) => {
    const styles = useStyles()
    return (
      <View style={styles.section}>
        <Text variant={TEXT_VARIANTS.display} accessibilityRole="header" style={styles.heading}>
          {title}
        </Text>
        {children}
        {note !== null && <Text style={styles.note}>{note}</Text>}
      </View>
    )
  }

  const SettingsLine = ({ text, isAlert = false }: SettingsLineProps) => {
    const styles = useStyles()
    return (
      <Text accessibilityRole={isAlert ? LINE_ROLES.alert : LINE_ROLES.text} style={styles.line}>
        {text}
      </Text>
    )
  }

  return { SettingsSection, SettingsLine }
}
