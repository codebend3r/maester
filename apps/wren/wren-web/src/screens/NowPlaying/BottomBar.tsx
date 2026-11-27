import { classNames } from '@raven/ui/headless'
import { PANES, type Pane, barWordsOf, WREN_ICONS, type WrenIconName } from '@raven/wren'
import { Pressable } from '@/ui/Pressable/Pressable'
import { WrenIcon } from '@/ui/WrenIcon/WrenIcon'
import styles from '@/screens/NowPlaying/BottomBar.module.scss'

type BarItemProps = {
  icon: WrenIconName
  pane: Pane
  current: Pane
  onPane: (pane: Pane) => void
  /** "raven · This browser", the Output pill's words. */
  output: string
}

/** One of the bar's buttons, on a soft red pill while its pane shows. */
function BarItem({ icon, pane, current, onPane, output }: BarItemProps) {
  const isActive = pane === current
  const { label, text } = barWordsOf({ pane, output })
  return (
    <Pressable
      className={classNames([styles.item, isActive && styles.active])}
      isPressed={isActive}
      label={label}
      onPress={() => onPane(pane)}
    >
      <WrenIcon name={icon} />
      {text !== null && <span className={styles.label}>{text}</span>}
    </Pressable>
  )
}

// The bar's buttons in the order they sit; the Output pill in the middle shows the player itself.
const BAR_ITEMS = [
  { pane: PANES.lyrics, icon: WREN_ICONS.lyrics },
  { pane: PANES.player, icon: WREN_ICONS.output },
  { pane: PANES.upNext, icon: WREN_ICONS.upNext },
] as const

type BottomBarProps = {
  pane: Pane
  onPane: (pane: Pane) => void
  /** "raven · This browser". */
  output: string
}

/**
 * The foot of the narrow Now Playing: Lyrics, the Output pill, which shows the player itself,
 * and Up next. The pane showing gets a soft red pill.
 */
export function BottomBar({ pane, onPane, output }: BottomBarProps) {
  return (
    <div className={styles.bar}>
      {BAR_ITEMS.map((item) => (
        <BarItem
          current={pane}
          icon={item.icon}
          key={item.pane}
          onPane={onPane}
          output={output}
          pane={item.pane}
        />
      ))}
    </div>
  )
}
