import {
  COLOR_SCHEMES,
  type ColorScheme,
  SETTINGS_COPY,
  type ThemeChoice,
  themeFor,
  themeSlotLabelOf,
} from '@raven/wren'
import { useSystemScheme } from '@/theme/systemScheme'
import { type Choice, RadioChoices } from '@/ui/RadioChoices/RadioChoices'
import styles from '@/screens/Settings/ThemeSlots.module.scss'

const CLASSES = { group: styles.slots, choice: styles.choice, label: styles.slot } as const

const SLOTS = [COLOR_SCHEMES.light, COLOR_SCHEMES.dark] as const

type ThemeSlotsProps = {
  choice: ThemeChoice
  /** The slot whose theme the picker under it sets. */
  slot: ColorScheme
  onSelect: (slot: ColorScheme) => void
}

/**
 * The two themes of the Match device mode, one for each of the device's schemes: each slot
 * shows its theme in three of that theme's colours and, for the scheme the device is in, that
 * it is the one showing. Picking a slot hands it to the theme picker.
 */
export function ThemeSlots({ choice, slot, onSelect }: ThemeSlotsProps) {
  const system = useSystemScheme()
  const choices = SLOTS.map((key) => ({ key, label: themeSlotLabelOf({ choice, slot: key }) }))
  const slotOf = ({ key }: Choice<ColorScheme>) => {
    const theme = themeFor({ choice, scheme: key })
    return (
      <>
        <span className={styles.when}>{SETTINGS_COPY.themeSlotNames[key]}</span>
        <span className={styles.theme}>
          <span aria-hidden="true" className={styles.dots} data-theme={theme}>
            <span className={styles.ground} />
            <span className={styles.surface} />
            <span className={styles.accent} />
          </span>
          <span className={styles.name}>{SETTINGS_COPY.themeNames[theme]}</span>
        </span>
        {key === system && <span className={styles.now}>{SETTINGS_COPY.showingNow}</span>}
      </>
    )
  }
  return (
    <RadioChoices
      choices={choices}
      classes={CLASSES}
      content={slotOf}
      label={SETTINGS_COPY.themeSlots}
      onSelect={onSelect}
      selected={slot}
    />
  )
}
