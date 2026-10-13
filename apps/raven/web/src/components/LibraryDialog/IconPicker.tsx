import { LIBRARY_ICON_NAMES, type LibraryKind, type LibrarySettings } from '@raven/core'
import { useId } from 'react'
import { Icon } from '@/components/Icon/Icon'
import { LIBRARY_ICON_LABELS, libraryIconOf, pickedIcon } from '@/lib/libraryKinds'
import styles from '@/components/LibraryDialog/IconPicker.module.scss'

/**
 * Every icon a library can wear, as a tile each: a radio kept out of sight,
 * its label the tile. The icon worn is checked, the type's until another is
 * picked. The caller's fieldset names the group.
 */
export const IconPicker = ({
  kind,
  icon,
  onChange,
}: {
  kind: LibraryKind
  icon: LibrarySettings['icon']
  onChange: (icon: LibrarySettings['icon']) => void
}) => {
  const name = useId()
  const worn = libraryIconOf({ kind, icon })
  return (
    <div className={styles.icons}>
      {LIBRARY_ICON_NAMES.map((choice) => (
        <div key={choice} className={styles.choice}>
          <input
            id={`${name}-${choice}`}
            type="radio"
            name={name}
            value={choice}
            className="visually-hidden"
            checked={worn === choice}
            onChange={() => onChange(pickedIcon({ kind, icon: choice }))}
          />
          <label htmlFor={`${name}-${choice}`} title={LIBRARY_ICON_LABELS[choice]}>
            <Icon name={choice} size={24} />
            <span className="visually-hidden">{`${LIBRARY_ICON_LABELS[choice]} icon`}</span>
          </label>
        </div>
      ))}
    </div>
  )
}
