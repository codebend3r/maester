import { SETTINGS_COPY, THEME_SCHEMES, WREN_THEMES, type WrenThemeName } from '@raven/wren'
import { type Choice, RadioChoices } from '@/ui/RadioChoices/RadioChoices'
import { WrenIcon } from '@/ui/WrenIcon/WrenIcon'
import { ICONS } from '@/ui/WrenIcon/icons'
import styles from '@/screens/Settings/ThemePicker.module.scss'

const CLASSES = { group: styles.grid, choice: styles.choice, label: styles.tile } as const

const THEME_CHOICES = Object.values(WREN_THEMES).map((key) => ({
  key,
  label: SETTINGS_COPY.themeNames[key],
}))

/** A theme's tile: a small picture of the theme in its own colours, over its name and scheme. */
const tileOf = ({ key, label }: Choice<WrenThemeName>) => (
  <>
    <span aria-hidden="true" className={styles.preview} data-theme={key}>
      <span className={styles.rail} />
      <span className={styles.lines}>
        <span className={styles.title} />
        <span className={styles.meta} />
        <span className={styles.pill} />
      </span>
    </span>
    <span className={styles.caption}>
      <span className={styles.words}>
        <span className={styles.name}>{label}</span>
        <span className={styles.scheme}>{SETTINGS_COPY.schemeNames[THEME_SCHEMES[key]]}</span>
      </span>
      <span className={styles.check}>
        <WrenIcon name={ICONS.check} />
      </span>
    </span>
  </>
)

type ThemePickerProps = {
  /** What the pick sets, said aloud before the themes: "Theme when dark". */
  label: string
  selected: WrenThemeName
  onSelect: (theme: WrenThemeName) => void
}

/** Every theme as a tile, one of them picked. */
export function ThemePicker({ label, selected, onSelect }: ThemePickerProps) {
  return (
    <RadioChoices
      choices={THEME_CHOICES}
      classes={CLASSES}
      content={tileOf}
      label={label}
      onSelect={onSelect}
      selected={selected}
    />
  )
}
