import { View } from 'react-native'

import { SPACE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { FocusButton } from '@/ui/FocusButton'
import { FOCUS_ROLES } from '@/ui/Focusable'

const useStyles = themedStyles(() => ({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.s2 },
}))

/** One choice of a row: what it is, what it is called aloud, and its words where they say less. */
type Choice<Key extends string | number> = { key: Key; label: string; text?: string }

type ChoiceRowProps<Key extends string | number> = {
  /** What the row chooses, said aloud before its choices. */
  label: string
  choices: readonly Choice<Key>[]
  selected: Key
  onSelect: (key: Key) => void
  /** Radio choices, or tabs where the choice shows a pane. */
  role?: typeof FOCUS_ROLES.radio | typeof FOCUS_ROLES.tab
}

/**
 * A row of choices, one picked, each a pill the remote moves along: Home's order, Search's
 * filters, Appearance's mode, Now Playing's panes. The phone draws these as its segmented control.
 */
export function ChoiceRow<Key extends string | number>({
  label,
  choices,
  selected,
  onSelect,
  role = FOCUS_ROLES.radio,
}: ChoiceRowProps<Key>) {
  const styles = useStyles()
  return (
    <View accessibilityLabel={label} style={styles.row}>
      {choices.map((choice) => (
        <FocusButton
          isSelected={choice.key === selected}
          key={choice.key}
          label={choice.label}
          onPress={() => onSelect(choice.key)}
          role={role}
          text={choice.text ?? choice.label}
        />
      ))}
    </View>
  )
}
