import type { ComponentProps } from 'react'
import { GroupedList } from '@/ui/GroupedList/GroupedList'
import styles from '@/screens/Settings/NotedGroup.module.scss'

type NotedGroupProps = ComponentProps<typeof GroupedList> & {
  /** The line under the card: the server's is read only, the library's pick changes every list. */
  note: string
}

/** A Settings group with a line of its own under the card. */
export function NotedGroup({ note, ...group }: NotedGroupProps) {
  return (
    <div className={styles.group}>
      <GroupedList {...group} />
      <p className={styles.note}>{note}</p>
    </div>
  )
}
