import { type LibraryIconName, isLibraryIconName } from '@raven/core'
import { useId } from 'react'
import { Icon } from '@raven/ui'
import { LIBRARY_ICON_LABELS } from '@/lib/libraryKinds'
import styles from '@/components/LibraryDialog/IconPicker.module.scss'

/**
 * Every icon a library can wear, as a tile each: a radio kept out of sight,
 * its label the tile. The caller's fieldset names the group.
 */
export const IconPicker = ({
  value,
  onChange,
}: {
  value: LibraryIconName
  onChange: (icon: LibraryIconName) => void
}) => {
  const name = useId()
  return (
    <div className={styles.icons}>
      {isLibraryIconName.values.map((icon) => (
        <div key={icon} className={styles.choice}>
          <input
            id={`${name}-${icon}`}
            type="radio"
            name={name}
            value={icon}
            className="visually-hidden"
            checked={value === icon}
            onChange={() => onChange(icon)}
          />
          <label htmlFor={`${name}-${icon}`} title={LIBRARY_ICON_LABELS[icon]}>
            <Icon name={icon} size={24} />
            <span className="visually-hidden">{`${LIBRARY_ICON_LABELS[icon]} icon`}</span>
          </label>
        </div>
      ))}
    </div>
  )
}
