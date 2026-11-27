import { KIT_COPY, WREN_ICONS } from '@raven/wren'
import { type Press, Pressable } from '@/ui/Pressable/Pressable'
import { WrenIcon } from '@/ui/WrenIcon/WrenIcon'
import styles from '@/ui/BackLink/BackLink.module.scss'

/** Where a back link goes, and the page it names on the way. */
export type BackTarget = Press & {
  /** The page it returns to, shown and said: "Back to Library". Left out, it reads "Back". */
  to?: string
}

/** "< Library" in red above a page opened from another: the way back to the page it came from. */
export function BackLink({ to, ...press }: BackTarget) {
  return (
    <Pressable
      {...press}
      className={styles.back}
      label={to === undefined ? KIT_COPY.backAlone : KIT_COPY.back(to)}
    >
      <WrenIcon name={WREN_ICONS.back} />
      <span>{to ?? KIT_COPY.backAlone}</span>
    </Pressable>
  )
}
