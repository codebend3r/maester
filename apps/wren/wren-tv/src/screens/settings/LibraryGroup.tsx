import { SETTINGS_COPY } from '@raven/wren'

import { SettingsGroup } from '@/screens/settings/parts'
import { useWrenPrefs } from '@/stores/wrenPrefs'
import { FOCUS_ROLES } from '@/ui/Focusable'
import { ListRow } from '@/ui/ListRow'
import { ICONS } from '@/ui/WrenIcon'
import { type WrenSession, useMusicLibraries } from '@raven/wren-native'

type LibraryGroupProps = { session: WrenSession }

/**
 * The server's music libraries, one of them worn: Home, Search and the collection show the one
 * picked. It draws nothing until the server has named a music library.
 */
export function LibraryGroup({ session }: LibraryGroupProps) {
  const music = useMusicLibraries(session)
  const change = useWrenPrefs((state) => state.change)
  const [worn] = music.libraries
  return (
    worn !== undefined && (
      <SettingsGroup heading={SETTINGS_COPY.library} note={SETTINGS_COPY.libraryNote}>
        {music.all.map(({ id, name }) => (
          <ListRow
            icon={id === worn.id ? ICONS.check : ICONS.library}
            isSelected={id === worn.id}
            key={id}
            onPress={() => change({ libraryId: id })}
            role={FOCUS_ROLES.radio}
            title={name}
          />
        ))}
      </SettingsGroup>
    )
  )
}
