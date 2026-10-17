import { Icon, KEYS, THEMES, type ThemeId } from '@raven/ui'
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import { useTheme } from '@/stores/theme'
import styles from '@/components/ThemePicker/ThemePicker.module.scss'

/**
 * A theme in miniature, in its own colours: the ground, a poster, a line of
 * title and one of meta, and the bar Play wears.
 */
const Preview = ({ theme }: { theme: ThemeId }) => (
  <span className={styles.preview} data-theme={theme} aria-hidden="true">
    <span className={styles.poster} />
    <span className={styles.title} />
    <span className={styles.meta} />
    <span className={styles.play} />
  </span>
)

/**
 * The round button in a page's corner, its swatch the current theme's play,
 * text and moss, and the menu it opens: every theme with a preview, its name
 * and note, a check on the one worn. Picking one wears it at once, keeps it
 * on this device and closes the menu. Escape, Tab or a click elsewhere
 * closes it too.
 */
export const ThemePicker = ({ className }: { className?: string }) => {
  const id = useId()
  const [isOpen, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const { theme, pick } = useTheme()

  const close = ({ refocus }: { refocus: boolean }) => {
    setOpen(false)
    if (refocus) trigger.current?.focus()
  }

  // Focus lands on the theme worn, so the arrows start from it.
  useEffect(() => {
    if (isOpen) list.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return undefined
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [isOpen])

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const items = Array.from(list.current?.querySelectorAll('button') ?? [])
    const index = items.findIndex((item) => item === document.activeElement)
    if (event.key === KEYS.escape) {
      event.preventDefault()
      close({ refocus: true })
    } else if (event.key === KEYS.arrowDown) {
      event.preventDefault()
      items[(index + 1) % items.length]?.focus()
    } else if (event.key === KEYS.arrowUp) {
      event.preventDefault()
      items[index <= 0 ? items.length - 1 : index - 1]?.focus()
    } else if (event.key === KEYS.tab) {
      setOpen(false)
    }
  }

  return (
    <div ref={root} className={[styles.picker, className].filter(Boolean).join(' ')}>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-label="Theme"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={id}
        title="Theme"
        onClick={() => setOpen((now) => !now)}
      >
        <span className={styles.swatch} />
      </button>
      {isOpen && (
        <section className={styles.popover} aria-labelledby={`${id}-heading`}>
          <header className={styles.head}>
            <h2 id={`${id}-heading`} className={styles.heading}>
              Theme
            </h2>
            <p className={styles.saved}>Saved on this device</p>
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
