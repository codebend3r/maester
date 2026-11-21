import { SIZES } from '@/theme/tokens'
import type { IconAction } from '@/ui/WrenIcon/icons'
import { WrenIcon } from '@/ui/WrenIcon/WrenIcon'
import { Pressable } from '@/ui/Pressable/Pressable'
import styles from '@/ui/SheetActions/SheetActions.module.scss'

type SheetActionsProps = {
  /** The actions in groups, a line between each: the queue's, the library's, where to go. */
  groups: readonly (readonly IconAction[])[]
}

/** A sheet's actions, 52 tall each, grouped with a line between the groups. */
export function SheetActions({ groups }: SheetActionsProps) {
  return (
    <div className={styles.groups}>
      {groups
        .filter((group) => group.length > 0)
        .map((group, at) => (
          <ul className={styles.group} key={group[0]?.label ?? at}>
            {group.map(({ icon, label, onPress }) => (
              <li key={label}>
                <Pressable className={styles.action} onPress={onPress}>
                  <WrenIcon name={icon} size={SIZES.icon} />
                  <span className={styles.label}>{label}</span>
                </Pressable>
              </li>
            ))}
          </ul>
        ))}
    </div>
  )
}
