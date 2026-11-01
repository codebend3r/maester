import {
  DOWNLOAD_STATUS_KINDS,
  type DownloadStatus,
  type DownloadView,
  type MediaSort,
  MEDIA_SORTS,
  reversedDirection,
  reversedSort,
  SORT_DIRECTION_LABELS,
  SORT_FIELD_LABELS,
  isSortFieldName,
  sortParts,
  startingSort,
  formatBytes,
  DOWNLOAD_ARTWORK_KINDS,
} from '@raven/core'
import { Button } from '@raven/ui'
import { type ComponentType, useId, useState } from 'react'
import { DownloadActivity } from '@/desktop/DownloadsPage/DownloadActivity'
import { DownloadArtwork } from '@/desktop/DownloadsPage/DownloadArtwork'
import { DOWNLOAD_ROW_COPY, WATCH_COPY } from '@/desktop/DownloadsPage/copy'
import styles from '@/desktop/DownloadsPage/DownloadsWatch.module.scss'
import { sortDownloads } from '@/desktop/DownloadsPage/sortDownloads'
import { usePlayDownload } from '@/desktop/DownloadsPage/usePlayDownload'
import { handled } from '@/desktop/handled'
import { useDownloadSpeed } from '@/desktop/useDownloadSpeed'
import { POSTER_SIZES } from '@/lib/posters'
import { COMMON_COPY } from '@/lib/copy'

type TileProps = { view: DownloadView }

/** A title's second line: the episode or file, when it is not the title itself. */
const subtitleOf = ({ label, group }: DownloadView): string | null =>
  label === group.title ? null : label

type TileFaceProps = TileProps

const TileFace = ({ view }: TileFaceProps) => {
  const subtitle = subtitleOf(view)
  return (
    <>
      <span
        className={
          view.artwork.kind === DOWNLOAD_ARTWORK_KINDS.cover
            ? `${styles.poster} ${styles.square}`
            : styles.poster
        }
        aria-hidden="true"
      >
        <DownloadArtwork
          artwork={view.artwork}
          initial={view.group.title.slice(0, 1)}
          sizes={POSTER_SIZES.grid}
        />
      </span>
      <span className={styles.title}>{view.group.title}</span>
      {subtitle !== null && <span className={styles.subtitle}>{subtitle}</span>}
      <span className={styles.meta}>{formatBytes(view.size)}</span>
    </>
  )
}

const ReadyTile = ({ view }: TileProps) => {
  const play = usePlayDownload()
  return (
    <button
      type="button"
      className={styles.tile}
      aria-label={WATCH_COPY.playLabel(view.label)}
      onClick={() => handled(play(view.downloadId))}
    >
      <TileFace view={view} />
    </button>
  )
}

const PERCENT_OF = 100

type NoteProps = { view: DownloadView }

const DownloadingNote = ({ view }: NoteProps) => {
  const speed = useDownloadSpeed(view.downloadId)
  const { status } = view
  return (
    status.kind === DOWNLOAD_STATUS_KINDS.downloading && (
      <span className={styles.live}>
        <DownloadActivity
          value={status.bytes}
          max={view.size}
          label={DOWNLOAD_ROW_COPY.downloadedOf({ bytes: status.bytes, size: view.size })}
        />
        <span className={styles.speed}>
          {speed === null
            ? DOWNLOAD_ROW_COPY.starting
            : `${Math.floor((status.bytes / view.size) * PERCENT_OF)}% ${DOWNLOAD_ROW_COPY.speed(speed)}`}
        </span>
      </span>
    )
  )
}

const WaitingNote = () => <span>{DOWNLOAD_ROW_COPY.waiting}</span>

const PausedNote = ({ view }: NoteProps) =>
  view.status.kind === DOWNLOAD_STATUS_KINDS.paused && (
    <span>{view.status.message ?? DOWNLOAD_ROW_COPY.paused}</span>
  )

const FailedNote = ({ view }: NoteProps) =>
  view.status.kind === DOWNLOAD_STATUS_KINDS.failed && (
    <span>{DOWNLOAD_ROW_COPY.failed(view.status.message)}</span>
  )

const NoNote = () => null

/** What a tile that cannot be watched yet says of where its download stands. */
const NOTES = {
  [DOWNLOAD_STATUS_KINDS.downloading]: DownloadingNote,
  [DOWNLOAD_STATUS_KINDS.queued]: WaitingNote,
  [DOWNLOAD_STATUS_KINDS.paused]: PausedNote,
  [DOWNLOAD_STATUS_KINDS.failed]: FailedNote,
  [DOWNLOAD_STATUS_KINDS.ready]: NoNote,
} as const satisfies Record<DownloadStatus['kind'], ComponentType<NoteProps>>

const PendingTile = ({ view }: TileProps) => {
  const Note = NOTES[view.status.kind]
  return (
    <div className={`${styles.tile} ${styles.pending}`} title={WATCH_COPY.notReady}>
      <TileFace view={view} />
      <span className={styles.note}>
        <Note view={view} />
      </span>
    </div>
  )
}

/** A file that is ready plays on a click; one still on its way shows how far it is. */
const TILES = {
  [DOWNLOAD_STATUS_KINDS.ready]: ReadyTile,
  [DOWNLOAD_STATUS_KINDS.downloading]: PendingTile,
  [DOWNLOAD_STATUS_KINDS.queued]: PendingTile,
  [DOWNLOAD_STATUS_KINDS.paused]: PendingTile,
  [DOWNLOAD_STATUS_KINDS.failed]: PendingTile,
} as const satisfies Record<DownloadStatus['kind'], ComponentType<TileProps>>

type SortBarProps = {
  sort: MediaSort
  onSort: (sort: MediaSort) => void
  onShuffle: () => void
}

type DirectionProps = Pick<SortBarProps, 'sort' | 'onSort'>

/** The button beside the sort that turns the order around; Random has no way to turn. */
const Direction = ({ sort, onSort }: DirectionProps) => {
  const { field, direction } = sortParts(sort)
  return (
    direction !== null && (
      <Button
        tone="ghost"
        icon={direction}
        title={WATCH_COPY.sortInstead(SORT_DIRECTION_LABELS[field][reversedDirection(direction)])}
        onClick={() => onSort(reversedSort(sort))}
      >
        <span className="visually-hidden">{WATCH_COPY.order}</span>
        {SORT_DIRECTION_LABELS[field][direction]}
      </Button>
    )
  )
}

/** Every field a library sorts on, since a download keeps the facts each needs. */
const SORT_FIELDS = isSortFieldName.values

const SortBar = ({ sort, onSort, onShuffle }: SortBarProps) => {
  const id = useId()
  const { field } = sortParts(sort)
  return (
    <div className={styles.sortBar}>
      <label htmlFor={id} className={styles.sortLabel}>
        {COMMON_COPY.sort}
      </label>
      <select
        id={id}
        className={styles.select}
        value={field}
        onChange={(event) =>
          isSortFieldName(event.target.value) && onSort(startingSort(event.target.value))
        }
      >
        {SORT_FIELDS.map((name) => (
          <option key={name} value={name}>
            {SORT_FIELD_LABELS[name]}
          </option>
        ))}
      </select>
      <Direction sort={sort} onSort={onSort} />
      {sort === MEDIA_SORTS.random && (
        <Button tone="ghost" icon="shuffle" onClick={onShuffle}>
          {WATCH_COPY.shuffle}
        </Button>
      )}
    </div>
  )
}

type DownloadsWatchProps = { downloads: DownloadView[] }

/** Every download as a poster in a grid, to play or to see how far it is, in any order a library has. */
export const DownloadsWatch = ({ downloads }: DownloadsWatchProps) => {
  const [sort, setSort] = useState<MediaSort>(MEDIA_SORTS.title)
  const [seed, setSeed] = useState(() => Math.random())
  const sorted = sortDownloads({ downloads, sort, seed })
  return (
    <div className={styles.watch}>
      <SortBar sort={sort} onSort={setSort} onShuffle={() => setSeed(Math.random())} />
      <ul className={styles.grid} aria-label={WATCH_COPY.gridLabel}>
        {sorted.map((view) => {
          const Tile = TILES[view.status.kind]
          return (
            <li key={view.downloadId} className={styles.cell}>
              <Tile view={view} />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
