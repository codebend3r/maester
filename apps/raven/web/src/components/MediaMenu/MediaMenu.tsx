import { type UseMutationResult, useQuery } from '@tanstack/react-query'
import {
  type AiMatch,
  ITEM_TYPES,
  type ItemSummary,
  KEYS,
  MATCH_STATES,
  type MatchItemType,
  type MediaItem,
  mediaLabel,
} from '@raven/core'
import {
  Fragment,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { Button, Icon, type IconName } from '@raven/ui'
import { FixMatchDialog } from '@/components/FixMatchDialog/FixMatchDialog'
import { ImageEditorDialog } from '@/components/ImageEditor/ImageEditorDialog'
import { api } from '@/lib/api'
import { copyText } from '@/lib/clipboard'
import { itemQuery, mediaLocationQuery } from '@/lib/queries'
import { useCanFavourite } from '@/lib/useCanFavourite'
import { useMediaMutations } from '@/lib/useMediaMutations'
import styles from '@/components/MediaMenu/MediaMenu.module.scss'

/**
 * The class for a card, row or tile holding a menu: there the menu's button
 * stays out of sight until the pointer or focus comes in. Elsewhere, as on a
 * movie's page, it is always there.
 */
export const MENU_HOST = styles.host

/** Deleting is the one action here that cannot be undone, so it asks first. */
const ConfirmDelete = ({
  media,
  remove,
  onClose,
  onDeleted,
}: {
  media: MediaItem
  remove: UseMutationResult<void, Error, void>
  onClose: () => void
  onDeleted?: () => void
}) => {
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={id} onClose={onClose}>
      <div className={styles.dialogBody}>
        <h2 id={id} className={styles.dialogTitle}>
          Delete {mediaLabel(media)}?
        </h2>
        <p className={styles.hint}>This removes the file from disk. It cannot be undone.</p>
        {remove.isError && (
          <p role="alert" className={styles.error}>
            {remove.error.message}
          </p>
        )}
        <div className={styles.actions}>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            tone="danger"
            icon="trash"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(undefined, {
                onSuccess: () => {
                  onClose()
                  onDeleted?.()
                },
              })
            }
          >
            Delete for good
          </Button>
        </div>
      </div>
    </dialog>
  )
}

/**
 * Whose pictures Edit images changes: a movie's own, or an episode's show's;
 * none for a file matched to nothing.
 */
const artworkOf = (item: ItemSummary | null): { id: number; kind: MatchItemType } | null => {
  if (item?.type === ITEM_TYPES.movie) return { id: item.id, kind: 'movie' }
  if (item?.type === ITEM_TYPES.episode && item.show) return { id: item.show.id, kind: 'show' }
  return null
}

/** One entry in the menu. */
const MenuItem = ({
  icon,
  label,
  onClick,
}: {
  icon: IconName
  label: string
  onClick: () => void
}) => (
  <li role="none">
    <button type="button" role="menuitem" className={styles.item} onClick={onClick}>
      <Icon name={icon} size={16} />
      {label}
    </button>
  </li>
)

/** A path that wraps after a slash rather than in the middle of a name. */
const WrappingPath = ({ path }: { path: string }) =>
  path.split('/').map((part, index, parts) => (
    <Fragment key={parts.slice(0, index + 1).join('/')}>
      {index > 0 && (
        <>
          /<wbr />
        </>
      )}
      {part}
    </Fragment>
  ))

/**
 * Where the file lives, read each time the menu opens, since a rename moves
 * it; choosing it copies the path.
 */
const LocationItem = ({ media }: { media: MediaItem }) => {
  const [copied, setCopied] = useState(false)
  const location = useQuery(mediaLocationQuery(media.id))
  const path = location.data?.path ?? null
  const waiting = location.isError ? location.error.message : 'Finding the file'
  return (
    <li role="none" className={styles.location}>
      <button
        type="button"
        role="menuitem"
        className={`${styles.item} ${styles.locationItem}`}
        aria-disabled={path == null}
        onClick={async () => setCopied(path != null && (await copyText(path)))}
      >
        <Icon name="copy" size={16} />
        <span className={styles.locationLabel}>{copied ? 'Copied' : 'Copy file path'}</span>
        <span className={styles.path}>{path ? <WrappingPath path={path} /> : waiting}</span>
      </button>
    </li>
  )
}

type MenuProps = {
  media: MediaItem
  open: boolean
  onOpenChange: (open: boolean) => void
  /** In a row of its own (list, tiles) instead of over a card's thumbnail. */
  inline?: boolean
  /** Opens the list to the left of its button, over whatever is beside it, instead of under it. */
  beside?: boolean
  /** What the library matches its files to; null leaves Fix match and Refresh details out. */
  matchType?: MatchItemType | null
  /** Why the AI lookup matched the file's movie, shown in Fix match; null or left out when it did not. */
  aiMatch?: AiMatch | null
  /** Off where the page has its own favourite button. */
  withFavourite?: boolean
  /** Off where the page has its own Watched button. */
  withWatched?: boolean
  onMatched?: (updated: MediaItem) => void
  onDeleted?: () => void
}

/**
 * The menu's list and what it opens: the delete confirmation, Fix match,
 * and a failed refresh's message. It holds the video's mutations, so a grid
 * of cards whose menus were never opened holds none.
 */
const MenuBody = ({
  media,
  open,
  onOpenChange,
  matchType = null,
  aiMatch = null,
  withFavourite = true,
  withWatched = true,
  onMatched,
  onDeleted,
  id,
  label,
  root,
  trigger,
}: MenuProps & {
  id: string
  label: string
  root: RefObject<HTMLDivElement | null>
  trigger: RefObject<HTMLButtonElement | null>
}) => {
  const list = useRef<HTMLUListElement>(null)
  const [confirming, setConfirming] = useState(false)
  const [fixing, setFixing] = useState(false)
  const [editingImages, setEditingImages] = useState(false)
  const { favourite, watched, remove, refresh } = useMediaMutations({ media })
  // A locked library's videos are never marked, but one marked before it locked can be unmarked.
  const canFavourite = useCanFavourite(media.libraryId) || media.favourite
  const matchable = matchType != null && media.match !== MATCH_STATES.off
  const item = media.item
  // Only a movie's details carry an AI note: an episode's never do.
  const itemDetails = useQuery(
    itemQuery(fixing && matchType === ITEM_TYPES.movie ? (item?.id ?? null) : null),
  )
  const artwork = artworkOf(item)

  const items = (): HTMLButtonElement[] =>
    Array.from(list.current?.querySelectorAll('button') ?? [])

  const close = ({ refocus }: { refocus: boolean }) => {
    onOpenChange(false)
    if (refocus) trigger.current?.focus()
  }
  // Focus lands on the first item whichever way the menu opened.
  useEffect(() => {
    if (open) list.current?.querySelector('button')?.focus()
  }, [open])

  // A click or tap anywhere else closes it.
  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !root.current?.contains(event.target)) {
        onOpenChange(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, onOpenChange, root])

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const buttons = items()
    const index = buttons.findIndex((button) => button === document.activeElement)
    if (event.key === KEYS.escape) {
      event.preventDefault()
      close({ refocus: true })
    } else if (event.key === KEYS.arrowDown) {
      event.preventDefault()
      buttons[(index + 1) % buttons.length]?.focus()
    } else if (event.key === KEYS.arrowUp) {
      event.preventDefault()
      buttons[index <= 0 ? buttons.length - 1 : index - 1]?.focus()
    } else if (event.key === KEYS.tab) {
      onOpenChange(false)
    }
  }

  return (
    <>
      {open && (
        <ul
          ref={list}
          id={id}
          role="menu"
          aria-label={label}
          className={styles.list}
          onKeyDown={onKeyDown}
        >
          {withFavourite && canFavourite && (
            <MenuItem
              icon="heart"
              label={media.favourite ? 'Remove favourite' : 'Favourite'}
              onClick={() => {
                favourite.mutate(!media.favourite)
                close({ refocus: true })
              }}
            />
          )}
          {withWatched && (
            <MenuItem
              icon="check"
              label={media.watched ? 'Mark as unwatched' : 'Mark as watched'}
              onClick={() => {
                watched.mutate(!media.watched)
                close({ refocus: true })
              }}
            />
          )}
          <AdminOnly>
            {matchable && (
              <MenuItem
                icon="search"
                label="Fix match"
                onClick={() => {
                  close({ refocus: false })
                  setFixing(true)
                }}
              />
            )}
            {matchable && item != null && (
              <MenuItem
                icon="rescan"
                label="Refresh details"
                onClick={() => {
                  refresh.mutate(item.id)
                  close({ refocus: true })
                }}
              />
            )}
            {artwork && (
              <MenuItem
                icon="image"
                label="Edit images"
                onClick={() => {
                  close({ refocus: false })
                  setEditingImages(true)
                }}
              />
            )}
            <MenuItem
              icon="trash"
              label="Delete"
              onClick={() => {
                close({ refocus: false })
                setConfirming(true)
              }}
            />
            <LocationItem media={media} />
          </AdminOnly>
        </ul>
      )}

      {refresh.isError && (
        <p role="alert" className={styles.failure}>
          Could not refresh: {refresh.error.message}
        </p>
      )}

      {confirming && (
        <ConfirmDelete
          media={media}
          remove={remove}
          onDeleted={onDeleted}
          onClose={() => {
            setConfirming(false)
            trigger.current?.focus()
          }}
        />
      )}

      {editingImages && artwork && (
        <ImageEditorDialog
          itemId={artwork.id}
          itemKind={artwork.kind}
          onClose={() => {
            setEditingImages(false)
            trigger.current?.focus()
          }}
        />
      )}

      {fixing && matchType != null && (
        <FixMatchDialog
          type={matchType}
          title={media.title}
          year={media.year}
          fileName={media.fileName}
          aiMatch={aiMatch ?? itemDetails.data?.aiMatch ?? null}
          libraryId={media.libraryId}
          subject={{ kind: 'media', id: media.id }}
          match={(tmdbId) => api.setMatch({ mediaId: media.id, tmdbId })}
          onMatched={onMatched}
          onClose={() => {
            setFixing(false)
            trigger.current?.focus()
          }}
        />
      )}
    </>
  )
}

/**
 * A card's context menu: mark or unmark a favourite, mark it watched or
 * unwatched and, with the admin lock
 * off, fix the match or fetch the details again where the library matches
 * its files, change the pictures of its movie or show, delete the video, or
 * see and copy where its file lives. The card owns `open`, so a right
 * click anywhere on it opens this same menu; the button here is the
 * discoverable way in for touch and keyboard. Until it first opens it is
 * only that button.
 */
export const MediaMenu = (props: MenuProps) => {
  const { media, open, onOpenChange, inline = false, beside = false } = props
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [woken, setWoken] = useState(open)
  if (open && !woken) setWoken(true)
  const label = `Options for ${mediaLabel(media)}`

  return (
    <div
      ref={root}
      className={[styles.root, inline && styles.inline, beside && styles.beside]
        .filter((name): name is string => !!name)
        .join(' ')}
    >
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => onOpenChange(!open)}
      >
        <Icon name="more" size={18} />
      </button>
      {woken && <MenuBody {...props} id={id} label={label} root={root} trigger={trigger} />}
    </div>
  )
}
