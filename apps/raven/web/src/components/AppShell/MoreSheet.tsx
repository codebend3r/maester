import { type Library, libraryPath } from '@raven/core'
import { Icon } from '@raven/ui'
import { type ReactNode, useEffect, useId } from 'react'
import { Link } from 'react-router-dom'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { APP_SHELL_COPY } from '@/components/AppShell/copy'
import { libraryPages, useIsCurrent } from '@/components/AppShell/currentPage'
import styles from '@/components/AppShell/MoreSheet.module.scss'
import { LibraryIcon } from '@/components/LibraryIcon/LibraryIcon'
import { SEARCH_ASK } from '@/components/SiteSearch/SiteSearch'
import { APP_PATHS } from '@/lib/appPaths'
import type { TabTarget } from '@/components/TabStrip/TabStrip'
import { useModal } from '@/lib/useModal'

type SheetTileProps = {
  to: string
  /** What the link hands the page it opens, as Search's ask for the cursor. */
  state?: unknown
  icon: ReactNode
  label: string
  isCurrent: boolean
  onChoose: () => void
}

/** A tile of the sheet: its icon over its name, marked while its page is open. */
const SheetTile = ({ to, state, icon, label, isCurrent, onChoose }: SheetTileProps) => (
  <li className={styles.item}>
    <Link
      to={to}
      state={state}
      className={styles.tile}
      aria-current={isCurrent ? 'page' : undefined}
      onClick={onChoose}
    >
      {icon}
      <span className={styles.label}>{label}</span>
    </Link>
  </li>
)

type MoreTileProps = TabTarget & { onChoose: () => void }

/** One of the sheet's pages. */
const MoreTile = ({ to, patterns, icon, label, onChoose }: MoreTileProps) => {
  const isCurrent = useIsCurrent(patterns)
  return (
    <SheetTile
      to={to}
      icon={<Icon name={icon} size={24} />}
      label={label}
      isCurrent={isCurrent}
      onChoose={onChoose}
    />
  )
}

type SearchTileProps = { onChoose: () => void }

/**
 * Search, first, as the phone app's sheet has it: the web's search lives on
 * Home, so it opens Home with the cursor in the search.
 */
const SearchTile = ({ onChoose }: SearchTileProps) => (
  <SheetTile
    to={APP_PATHS.home}
    state={SEARCH_ASK}
    icon={<Icon name="search" size={24} />}
    label={APP_SHELL_COPY.search}
    isCurrent={false}
    onChoose={onChoose}
  />
)

type PinnedTileProps = { library: Library; onChoose: () => void }

/** A pinned library: its type's icon over its name, marked while one of its pages is open. */
const PinnedTile = ({ library, onChoose }: PinnedTileProps) => {
  const isCurrent = useIsCurrent(libraryPages(library.id))
  return (
    <SheetTile
      to={libraryPath(library.id)}
      icon={<LibraryIcon settings={library.settings} size={24} />}
      label={library.name}
      isCurrent={isCurrent}
      onChoose={onChoose}
    />
  )
}

type MoreSheetProps = {
  entries: readonly TabTarget[]
  /** The pinned libraries, under a Pinned label. */
  pinned: readonly Library[]
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
 * are tiles in rows of three, Search first, then the pinned libraries under a Pinned
 * label, as the phone app's sheet has them, and, for whoever may manage, a
 * last group under a Manage label.
 */
export const MoreSheet = ({
  entries,
  pinned,
  manageEntries,
  onClose,
  onChoose,
}: MoreSheetProps) => {
  const { dialog, close, keepKeys } = useModal()
  const titleId = useId()
  const pinnedId = useId()
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
          <SearchTile onChoose={onChoose} />
          {entries.map((entry) => (
            <MoreTile key={entry.to} {...entry} onChoose={onChoose} />
          ))}
        </ul>
        {pinned.length > 0 && (
          <>
            <h3 id={pinnedId} className={styles.eyebrow}>
              {APP_SHELL_COPY.pinned}
            </h3>
            <ul className={styles.tiles} aria-labelledby={pinnedId}>
              {pinned.map((library) => (
                <PinnedTile key={library.id} library={library} onChoose={onChoose} />
              ))}
            </ul>
          </>
        )}
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
