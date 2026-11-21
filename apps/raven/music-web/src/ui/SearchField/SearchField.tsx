import { classNames } from '@raven/ui/headless'
import { KIT_COPY } from '@raven/wren'
import { type FormEvent, type MouseEvent, useRef } from 'react'
import { COLORS, SIZES } from '@/theme/tokens'
import { IconButton } from '@/ui/IconButton/IconButton'
import { ICONS } from '@/ui/WrenIcon/icons'
import { WrenIcon } from '@/ui/WrenIcon/WrenIcon'
import styles from '@/ui/SearchField/SearchField.module.scss'

type SearchFieldProps = {
  value: string
  onChangeText: (text: string) => void
  /** Enter: search at once, without waiting for the typing to pause. */
  onSubmit?: () => void
  /** Cancel: leave the search. Shown while the field holds the focus. */
  onCancel?: () => void
  /** The field inside a list, 42 tall rather than 46. */
  isCompact?: boolean
  placeholder?: string
  label?: string
}

/**
 * A search box: a field with its magnifier, and while the search holds the focus a clear button
 * and a Cancel link, which the stylesheet shows through `:focus-within`, so the focus moving
 * from the field to either keeps both. It only holds what is typed: a screen pairs it with
 * `useSearch`, so a search runs once typing pauses, never on each keystroke.
 */
export function SearchField({
  value,
  onChangeText,
  onSubmit,
  onCancel,
  isCompact = false,
  placeholder = KIT_COPY.searchPlaceholder,
  label = KIT_COPY.search,
}: SearchFieldProps) {
  const input = useRef<HTMLInputElement>(null)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit?.()
  }
  // The button goes with what it cleared, so the focus goes back to the field.
  const clear = () => {
    onChangeText('')
    input.current?.focus()
  }
  const cancel = (event: MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.blur()
    onCancel?.()
  }
  return (
    <search>
      <form className={styles.row} onSubmit={submit}>
        <div className={classNames([styles.box, isCompact && styles.compact])}>
          <WrenIcon color={COLORS.text3} name={ICONS.search} size={SIZES.navIcon} />
          <input
            aria-label={label}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            className={styles.input}
            enterKeyHint="search"
            onChange={(event) => onChangeText(event.target.value)}
            placeholder={placeholder}
            ref={input}
            spellCheck={false}
            type="search"
            value={value}
          />
          {value !== '' && (
            <span className={styles.clear}>
              <IconButton
                color={COLORS.text3}
                icon={ICONS.close}
                label={KIT_COPY.clearSearch}
                onPress={clear}
                size={SIZES.smallButton}
              />
            </span>
          )}
        </div>
        {onCancel !== undefined && (
          <button className={styles.cancel} onClick={cancel} type="button">
            {KIT_COPY.cancel}
          </button>
        )}
      </form>
    </search>
  )
}
