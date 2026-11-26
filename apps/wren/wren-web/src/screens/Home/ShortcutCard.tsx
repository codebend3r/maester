import { classNames } from '@raven/ui/headless'
import { KIT_COPY } from '@raven/wren'
import { SIZES } from '@/theme/tokens'
import { Card } from '@/ui/Card/Card'
import { type DisablablePress, Pressable } from '@/ui/Pressable/Pressable'
import type { WrenIconName } from '@/ui/WrenIcon/icons'
import { WrenIcon } from '@/ui/WrenIcon/WrenIcon'
import styles from '@/screens/Home/ShortcutCard.module.scss'

type ShortcutCardProps = DisablablePress & {
  icon: WrenIconName
  title: string
  /** What it holds: "4,812 songs", "2 playlists"; left out while it is not known. */
  value?: string
  /** Whether its icon sits on red: Shuffle all. */
  isAccent?: boolean
}

/** One of Home's shortcuts: an icon on a tile, its name and what it holds. */
export function ShortcutCard({
  icon,
  title,
  value,
  isAccent = false,
  ...press
}: ShortcutCardProps) {
  return (
    <Card className={styles.card}>
      <Pressable
        {...press}
        className={styles.press}
        label={value === undefined ? title : KIT_COPY.labelled({ label: title, value })}
      >
        <span className={classNames([styles.tile, isAccent && styles.accent])}>
          <WrenIcon name={icon} size={SIZES.icon} />
        </span>
        <span className={styles.text}>
          <span className={styles.title}>{title}</span>
          {/* The space keeps the visible text inside the spoken name, "Shuffle all, 3 songs". */}
          {value !== undefined && ' '}
          {value !== undefined && <span className={styles.value}>{value}</span>}
        </span>
      </Pressable>
    </Card>
  )
}
