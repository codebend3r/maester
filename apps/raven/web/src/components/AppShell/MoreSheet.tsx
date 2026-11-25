import { libraryPath } from '@raven/core'
import { Icon } from '@raven/ui'
import { useActiveServer } from '@raven/ui/headless'
import { type ReactNode, useEffect, useId } from 'react'
import { Link } from 'react-router-dom'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { APP_SHELL_COPY } from '@/components/AppShell/copy'
import { pinnedPages, useIsCurrent } from '@/components/AppShell/currentPage'
import styles from '@/components/AppShell/MoreSheet.module.scss'
import { LibraryIcon } from '@/components/LibraryIcon/LibraryIcon'
import { SEARCH_ASK } from '@/components/SiteSearch/SiteSearch'
import { APP_PATHS } from '@/lib/appPaths'
import { type PinnedLibrary, followPin } from '@/lib/pins'
import { type ServerEntry, isActiveEntry, isReachableFromPage, useOpenServer } from '@/lib/servers'
import type { TabTarget } from '@/components/TabStrip/TabStrip'
import { useModal } from '@/lib/useModal'

type SheetTileProps = {
  to: string
  /** What the link hands the page it opens, as Search's ask for the cursor. */
  state?: unknown
  icon: ReactNode
  label: string
  /** A line in very small type under the name: a pinned library's server, when there are several. */
  detail?: string
  isCurrent: boolean
  onChoose: () => void
}

/** A tile of the sheet: its icon over its name, marked while its page is open. */
const SheetTile = ({ to, state, icon, label, detail, isCurrent, onChoose }: SheetTileProps) => (
  <li className={styles.item}>
    <Link
      to={to}
      state={state}
      className={styles.tile}
      aria-current={isCurrent ? 'page' : undefined}
      onClick={onChoose}
    >
      {icon}
      <span className={styles.label}>
        {label}
        {!!detail && (
          <span className={styles.detail}>
            <span className="visually-hidden">{APP_SHELL_COPY.on}</span>
            {detail}
          </span>
        )}
      </span>
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

type PinnedTileProps = {
  pinned: PinnedLibrary
  onChoose: () => void
}

/**
 * A pinned library: its type's icon over its name, and its server's under that while the
 * account keeps several and has not turned that off, marked while one of its pages is open. One on another server switches
 * to it as it opens.
 */
const PinnedTile = ({ pinned, onChoose }: PinnedTileProps) => {
  const { library, serverNote } = pinned
  const isCurrent = useIsCurrent(pinnedPages(pinned))
  const choose = () => {
    followPin(pinned)
    onChoose()
  }
  return (
    <SheetTile
      to={libraryPath(library.id)}
      icon={<LibraryIcon settings={library.settings} size={24} />}
      label={library.name}
      detail={serverNote}
      isCurrent={isCurrent}
      onChoose={choose}
    />
  )
}

type ServerTileProps = { server: ServerEntry; onChoose: () => void }

/**
 * A server to switch to, marked while it is the one in use; choosing another opens its Home. One
 * this https page cannot call says it needs https and cannot be chosen.
 */
const ServerTile = ({ server, onChoose }: ServerTileProps) => {
  const open = useOpenServer()
  const isCurrent = useActiveServer((state) => isActiveEntry({ server, active: state.active }))
  const canReach = isReachableFromPage({ origin: server.origin })
  const choose = () => {
    onChoose()
    open(server)
  }
  return (
    <li className={styles.item}>
      <button
        type="button"
        className={styles.tile}
        aria-current={isCurrent}
        disabled={!canReach}
        onClick={choose}
      >
        <Icon name="globe" size={24} />
        <span className={styles.label}>
          {server.name}
          {!canReach && <span className={styles.detail}>{APP_SHELL_COPY.needsHttps}</span>}
        </span>
      </button>
    </li>
  )
}

type MoreSheetProps = {
  entries: readonly TabTarget[]
  /** The pinned libraries, under a Pinned label. */
  pinned: readonly PinnedLibrary[]
  /**
   * The servers to switch between, under a Servers label, and each pin then names its own; none
   * where there is nothing to switch.
   */
  servers: readonly ServerEntry[]
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
 * label, as the phone app's sheet has them, the servers to switch between under a
 * Servers label while there are several, and, for whoever may manage, a
 * last group under a Manage label.
 */
export const MoreSheet = ({
  entries,
  pinned,
  servers,
  manageEntries,
  onClose,
  onChoose,
}: MoreSheetProps) => {
  const hasServers = servers.length > 0
  const { dialog, close, keepKeys } = useModal()
  const titleId = useId()
  const pinnedId = useId()
  const serversId = useId()
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
              {pinned.map((entry) => (
                <PinnedTile key={entry.key} pinned={entry} onChoose={onChoose} />
              ))}
            </ul>
          </>
        )}
        {hasServers && (
          <>
            <h3 id={serversId} className={styles.eyebrow}>
              {APP_SHELL_COPY.servers}
            </h3>
            <ul className={styles.tiles} aria-labelledby={serversId}>
              {servers.map((server) => (
                <ServerTile key={server.key} server={server} onChoose={onChoose} />
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
