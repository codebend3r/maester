import { Icon } from '@raven/ui'
import { useEffect, useId } from 'react'
import { Link } from 'react-router-dom'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { APP_SHELL_COPY } from '@/components/AppShell/copy'
import { useIsCurrent } from '@/components/AppShell/currentPage'
import styles from '@/components/AppShell/MoreSheet.module.scss'
import type { TabTarget } from '@/components/TabStrip/TabStrip'
import { useModal } from '@/lib/useModal'

type MoreTileProps = TabTarget & { onChoose: () => void }

/** A tile of the sheet: its icon over its name, marked while its page is open. */
const MoreTile = ({ to, patterns, icon, label, onChoose }: MoreTileProps) => {
  const isCurrent = useIsCurrent(patterns)
  return (
    <li className={styles.item}>
      <Link
        to={to}
        className={styles.tile}
        aria-current={isCurrent ? 'page' : undefined}
        onClick={onChoose}
      >
        <Icon name={icon} size={24} />
        <span className={styles.label}>{label}</span>
      </Link>
    </li>
  )
}

type MoreSheetProps = {
  entries: readonly TabTarget[]
  /** Only for whoever may manage, under a Manage label. */
  manageEntries: readonly TabTarget[]
  /** Heard when the sheet closes: Escape, the scrim or its close event. */
  onClose: () => void
  /** Heard when a tile is chosen, which leaves for its page. */
  onChoose: () => void
}

/**
 * The tab bar's More: a sheet rising from above the bar, which stays in view
 * beneath it, with a scrim over the page that closes it on a tap. Its pages
 * are tiles in rows of three, then, for whoever may manage, a second group
 * under a Manage label.
 */
export const MoreSheet = ({ entries, manageEntries, onClose, onChoose }: MoreSheetProps) => {
  const { dialog, close, keepKeys } = useModal()
  const titleId = useId()
  const manageId = useId()
  // Not every browser moves focus into a dialog it opens, so the first tile takes it here.
  useEffect(() => {
    dialog.current?.querySelector('a')?.focus()
  }, [dialog])
  return (
    <dialog
      ref={dialog}
      className={styles.sheet}
      aria-labelledby={titleId}
      onClose={onClose}
      onKeyDown={keepKeys}
    >
      <section className={styles.panel}>
        <span className={styles.handle} aria-hidden="true" />
        <h2 id={titleId} className={styles.title}>
          {APP_SHELL_COPY.more}
        </h2>
        <ul className={styles.tiles}>
          {entries.map((entry) => (
            <MoreTile key={entry.to} {...entry} onChoose={onChoose} />
          ))}
        </ul>
        <AdminOnly>
          <h3 id={manageId} className={styles.eyebrow}>
            {APP_SHELL_COPY.manage}
          </h3>
          <ul className={styles.tiles} aria-labelledby={manageId}>
            {manageEntries.map((entry) => (
              <MoreTile key={entry.to} {...entry} onChoose={onChoose} />
            ))}
          </ul>
        </AdminOnly>
      </section>
      <button
        type="button"
        className={styles.scrim}
        aria-label={APP_SHELL_COPY.closeMore}
        onClick={close}
      />
    </dialog>
  )
}
