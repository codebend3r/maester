import { type ReactNode, useId } from 'react'
import { KEYS } from '@raven/core'
import styles from '@/components/Tabs/Tabs.module.scss'

type Tab<T extends string> = { value: T; label: string; count: number }

type TabsProps<T extends string> = {
  label: string
  tabs: readonly Tab<T>[]
  chosen: T
  onChoose: (value: T) => void
  children: ReactNode
}

/**
 * A row of tabs, each with how many it holds, over the chosen tab's panel,
 * `children`. Only the chosen tab is in the tab order; the arrow keys move
 * between the tabs, choosing as they go, and wrap round at either end.
 */
export const Tabs = <T extends string>({
  label,
  tabs,
  chosen,
  onChoose,
  children,
}: TabsProps<T>) => {
  const id = useId()
  const tabId = (value: T) => `${id}-${value}`
  const panelId = `${id}-panel`

  type StepProps = { from: number; by: number }

  const step = ({ from, by }: StepProps) => {
    const next = tabs[(from + by + tabs.length) % tabs.length]
    if (next === undefined) return
    onChoose(next.value)
    document.getElementById(tabId(next.value))?.focus()
  }

  return (
    <div className={styles.root}>
      <div role="tablist" aria-label={label} className={styles.tabs}>
        {tabs.map((tab, index) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            id={tabId(tab.value)}
            aria-selected={tab.value === chosen}
            aria-controls={panelId}
            tabIndex={tab.value === chosen ? 0 : -1}
            className={styles.tab}
            onClick={() => onChoose(tab.value)}
            onKeyDown={(event) => {
              if (event.key !== KEYS.arrowLeft && event.key !== KEYS.arrowRight) return
              event.preventDefault()
              step({ from: index, by: event.key === KEYS.arrowRight ? 1 : -1 })
            }}
          >
            {tab.label}
            <span className={styles.count}>{tab.count}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" id={panelId} aria-labelledby={tabId(chosen)} className={styles.panel}>
        {children}
      </div>
    </div>
  )
}
