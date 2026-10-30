import { THEMES, type ThemeId } from '@raven/core'
import { Icon } from '@raven/ui'
import { useId } from 'react'
import { THEME_PICKER_COPY } from '@/components/ThemePicker/copy'
import { useMenu } from '@/lib/useMenu'
import { useTheme } from '@/stores/theme'
import styles from '@/components/ThemePicker/ThemePicker.module.scss'

type PreviewProps = { theme: ThemeId }

/**
 * A theme in miniature, in its own colours: the ground, a poster, a line of
 * title and one of meta, and the bar Play wears.
 */
const Preview = ({ theme }: PreviewProps) => (
  <span className={styles.preview} data-theme={theme} aria-hidden="true">
    <span className={styles.poster} />
    <span className={styles.title} />
    <span className={styles.meta} />
    <span className={styles.play} />
  </span>
)

type ThemePickerProps = { className?: string }

/**
 * The round button in a page's corner, its swatch the current theme's play,
 * text and moss, and the menu it opens: every theme with a preview, its name
 * and note, a check on the one worn. Picking one wears it at once, keeps it
 * on this device and closes the menu. Escape, Tab or a click elsewhere
 * closes it too.
 */
export const ThemePicker = ({ className }: ThemePickerProps) => {
  const id = useId()
  const { isOpen, toggle, close, root, trigger, list, onKeyDown } = useMenu()
  const { theme, pick } = useTheme()

  return (
    <div ref={root} className={[styles.picker, className].filter(Boolean).join(' ')}>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-label={THEME_PICKER_COPY.theme}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={id}
        title={THEME_PICKER_COPY.theme}
        onClick={toggle}
      >
        <span className={styles.swatch} />
      </button>
      {isOpen && (
        <section className={styles.popover} aria-labelledby={`${id}-heading`}>
          <header className={styles.head}>
            <h2 id={`${id}-heading`} className={styles.heading}>
              {THEME_PICKER_COPY.theme}
            </h2>
            <p className={styles.saved}>{THEME_PICKER_COPY.saved}</p>
          </header>
          <ul
            ref={list}
            id={id}
            role="menu"
            aria-labelledby={`${id}-heading`}
            className={styles.list}
            onKeyDown={onKeyDown}
          >
            {THEMES.map((option) => (
              <li key={option.id} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={option.id === theme}
                  className={styles.option}
                  onClick={() => {
                    pick(option.id)
                    close({ refocus: true })
                  }}
                >
                  <Preview theme={option.id} />
                  <span className={styles.name}>{option.name}</span>
                  <span className={styles.note}>{option.note}</span>
                  {option.id === theme && (
                    <span className={styles.check}>
                      <Icon name="check" size={18} />
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
