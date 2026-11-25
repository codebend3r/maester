import { classNames } from '@raven/ui/headless'
import { TAB_COPY } from '@raven/wren'
import { Pressable } from '@/ui/Pressable/Pressable'
import type { WrenIconName } from '@/ui/WrenIcon/icons'
import { STROKES, WrenIcon } from '@/ui/WrenIcon/WrenIcon'
import styles from '@/ui/TabBar/TabBar.module.scss'

/** One tab on the bar: its name, its drawing, whether it shows, and where a press goes. */
type TabItem = {
  key: string
  label: string
  icon: WrenIconName
  isActive: boolean
  href: string
}

type TabBarProps = { items: readonly TabItem[] }

/** How a tab is drawn while it shows and while it does not: its pill, its icon's line and its name. */
const TAB_LOOKS = {
  active: {
    pill: classNames([styles.pill, styles.activePill]),
    stroke: STROKES.active,
    label: styles.activeLabel,
  },
  idle: { pill: styles.pill, stroke: STROKES.regular, label: styles.label },
} as const

/**
 * The narrow layout's tab bar: each tab's icon in a pill over its name, the one showing in red
 * on a soft red pill. It sits over the home indicator and counts it in its height.
 */
export function TabBar({ items }: TabBarProps) {
  return (
    <nav className={styles.bar}>
      {items.map((item, at) => {
        const look = item.isActive ? TAB_LOOKS.active : TAB_LOOKS.idle
        return (
          <Pressable
            className={styles.item}
            href={item.href}
            isCurrent={item.isActive}
            key={item.key}
            label={TAB_COPY.label({ label: item.label, at, count: items.length })}
          >
            <span className={look.pill}>
              <WrenIcon name={item.icon} strokeWidth={look.stroke} />
            </span>
            <span className={look.label}>{item.label}</span>
          </Pressable>
        )
      })}
    </nav>
  )
}
