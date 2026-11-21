import { KIT_COPY } from '@raven/wren'
import { type Press, Pressable } from '@/ui/Pressable/Pressable'
import { ICONS } from '@/ui/WrenIcon/icons'
import { WrenIcon } from '@/ui/WrenIcon/WrenIcon'
import styles from '@/ui/BackLink/BackLink.module.scss'

type BackLinkProps = Press & {
  /** The page it returns to, shown and said: "Back to Library". Left out, it reads "Back". */
  to?: string
}

/** "< Library" in red above a page opened from another: the way back to the page it came from. */
export function BackLink({ to, ...press }: BackLinkProps) {
  return (
    <Pressable
      {...press}
      className={styles.back}
      label={to === undefined ? KIT_COPY.backAlone : KIT_COPY.back(to)}
    >
      <WrenIcon name={ICONS.back} />
      <span>{to ?? KIT_COPY.backAlone}</span>
    </Pressable>
  )
}
