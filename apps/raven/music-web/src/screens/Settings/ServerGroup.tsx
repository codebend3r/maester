import { SETTINGS_COPY, STATUS_COPY } from '@raven/wren'
import { GroupedList } from '@/ui/GroupedList/GroupedList'
import { IconTile, TILE_TONES } from '@/ui/IconTile/IconTile'
import { ServerStatusChip } from '@/ui/ServerStatusChip/ServerStatusChip'
import { ICONS } from '@/ui/WrenIcon/icons'
import styles from '@/screens/Settings/ServerGroup.module.scss'

/** The server Wren plays from: its name, and whether it answers. The page's own origin, so it shows no address. */
export function ServerGroup() {
  return (
    <GroupedList heading={SETTINGS_COPY.server}>
      <div className={styles.row}>
        <IconTile icon={ICONS.server} tone={TILE_TONES.accent} />
        <p className={styles.name}>{STATUS_COPY.raven}</p>
        <ServerStatusChip />
      </div>
    </GroupedList>
  )
}
