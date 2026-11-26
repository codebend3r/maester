import type { Library } from '@raven/core'
import { SETTINGS_COPY, WREN_ICONS } from '@raven/wren'
import { useMusicLibraries } from '@/music/musicLibraries'
import { NotedGroup } from '@/screens/Settings/NotedGroup'
import { useWrenPrefs } from '@/stores/wrenPrefs'
import { SIZES } from '@/theme/tokens'
import { type Choice, RadioChoices } from '@/ui/RadioChoices/RadioChoices'
import { WrenIcon } from '@/ui/WrenIcon/WrenIcon'
import styles from '@/screens/Settings/LibraryGroup.module.scss'

const CLASSES = { group: styles.rows, choice: styles.choice, label: styles.row } as const

/** A library's row: its name, and a check on the one worn. */
const rowOf = ({ label }: Choice<number>) => (
  <>
    <span className={styles.name}>{label}</span>
    <span className={styles.check}>
      <WrenIcon name={WREN_ICONS.check} size={SIZES.smallIcon} />
    </span>
  </>
)

type LibraryChoicesProps = {
  libraries: readonly Library[]
  /** The library Wren shows now. */
  worn: Library
}

function LibraryChoices({ libraries, worn }: LibraryChoicesProps) {
  const change = useWrenPrefs((state) => state.change)
  return (
    <NotedGroup heading={SETTINGS_COPY.library} note={SETTINGS_COPY.libraryNote}>
      <RadioChoices
        choices={libraries.map(({ id, name }) => ({ key: id, label: name }))}
        classes={CLASSES}
        content={rowOf}
        label={SETTINGS_COPY.library}
        onSelect={(libraryId) => change({ libraryId })}
        selected={worn.id}
      />
    </NotedGroup>
  )
}

/**
 * The server's music libraries, one of them worn: Home, Search and the collection show the one
 * picked. It draws nothing until the server has named a music library.
 */
export function LibraryGroup() {
  const music = useMusicLibraries()
  const [worn] = music.libraries
  return worn !== undefined && <LibraryChoices libraries={music.all} worn={worn} />
}
