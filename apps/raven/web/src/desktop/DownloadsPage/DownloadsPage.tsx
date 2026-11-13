import {
  DESKTOP_REQUESTS,
  DOWNLOAD_ARTWORK_KINDS,
  DOWNLOAD_KINDS,
  DOWNLOAD_STATUS_KINDS,
  type DownloadArtwork as Artwork,
  type DownloadCover,
  type DownloadGroup,
  type DownloadKind,
  type DownloadView,
  isMusicGroup,
  type SpaceView,
} from '@raven/core'
import { BUTTON_TONES, Button, type IconName } from '@raven/ui'
import { useAudioQueue, QueryView, keptRead } from '@raven/ui/headless'
import { type ComponentType, useId, useRef, useState } from 'react'
import { isInProgress, useChangeDownloads, useDownloads, useSpace } from '@/desktop/downloadsApi'
import { handled } from '@/lib/handled'
import { DOWNLOAD_ROW_COPY, DOWNLOADS_PAGE_COPY } from '@/desktop/DownloadsPage/copy'
import { DownloadActivity } from '@/desktop/DownloadsPage/DownloadActivity'
import { DownloadArtwork } from '@/desktop/DownloadsPage/DownloadArtwork'
import { DownloadRow, ROW_PLAYS, type RowPlay } from '@/desktop/DownloadsPage/DownloadRow'
import { LibrarySection, ShowBar } from '@/desktop/DownloadsPage/DownloadsShow'
import { DownloadsWatch } from '@/desktop/DownloadsPage/DownloadsWatch'
import {
  type DownloadsSection,
  sectionsOf,
  visibleDownloadsOf,
} from '@/desktop/DownloadsPage/libraries'
import { type MusicQueue, musicQueueOf } from '@/desktop/DownloadsPage/musicQueue'
import { useDownloadsUnlocked } from '@/desktop/DownloadsPage/useDownloadsUnlocked'
import { useTotalSpeed } from '@/desktop/useDownloadSpeed'
import type { DownloadsChange } from '@/downloads/host'
import { Tabs } from '@/components/Tabs/Tabs'
import styles from '@/desktop/DownloadsPage/DownloadsPage.module.scss'
import { PageTitle } from '@/components/PageTitle/PageTitle'
import { COMMON_COPY } from '@/lib/copy'
import { POSTER_SIZES } from '@/lib/posters'
import { useDownloadsHost } from '@/stores/downloadsHost'
import { useDownloadsShow } from '@/stores/downloadsShow'

/** The header's buttons for every download at once. */
const BULKS = { pauseAll: 'pauseAll', resumeAll: 'resumeAll' } as const

type Bulk = (typeof BULKS)[keyof typeof BULKS]

const BULK_BUTTONS = {
  pauseAll: {
    label: DOWNLOADS_PAGE_COPY.pauseAll,
    icon: 'pause',
    request: { type: DESKTOP_REQUESTS.pauseAllDownloads },
  },
  resumeAll: {
    label: DOWNLOADS_PAGE_COPY.resumeAll,
    icon: 'download',
    request: { type: DESKTOP_REQUESTS.resumeAllDownloads },
  },
} as const satisfies Record<Bulk, { label: string; icon: IconName; request: DownloadsChange }>

/** Pause all while anything is queued or downloading, and Resume all while anything waits paused. */
const bulksOf = (downloads: DownloadView[]): Bulk[] => [
  ...(downloads.some(isInProgress) ? [BULKS.pauseAll] : []),
  ...(downloads.some((view) => view.status.kind === DOWNLOAD_STATUS_KINDS.paused)
    ? [BULKS.resumeAll]
    : []),
]

type Grouped = { group: DownloadGroup; views: DownloadView[] }

/** The downloads by title, in the order main lists them, each title's files in play order. */
const groupsOf = (downloads: DownloadView[]): Grouped[] =>
  [...new Set(downloads.map((view) => view.group.key))].flatMap((key) => {
    const views = downloads
      .filter((view) => view.group.key === key)
      .toSorted((left, right) => left.group.order - right.group.order)
    const first = views[0]
    return first === undefined ? [] : [{ group: first.group, views }]
  })

type GroupHeadProps = {
  grouped: Grouped
  headingId: string
  /** The album cover a music group heads with; null for a video group, or a music one with none. */
  cover: DownloadCover | null
  /** The id of the title art every file of the group shares, saved on disk; null for none. */
  logo: string | null
  /** Plays the group's downloaded tracks from the first; null for a group with none. */
  onPlay: (() => void) | null
}

type TitleHeadProps = GroupHeadProps

/** A title's name, as its own art when that is saved and loads, else spelled out. */
const TitleHead = ({ grouped, headingId, logo }: TitleHeadProps) => {
  const host = useDownloadsHost()
  const [failed, setFailed] = useState<string | null>(null)
  const shown = logo === null || logo === failed ? null : host.pictureUrl(logo)
  const { title } = grouped.group
  return (
    <h2 id={headingId} className={styles.groupTitle}>
      {shown !== null && (
        <img className={styles.groupLogo} src={shown} alt={title} onError={() => setFailed(logo)} />
      )}
      {shown === null && title}
    </h2>
  )
}

/** The album cover a music group heads with, as the server addresses it. */
const coverArtworkOf = (cover: DownloadCover): Artwork =>
  cover.coverVersion === null
    ? { kind: DOWNLOAD_ARTWORK_KINDS.none }
    : { kind: DOWNLOAD_ARTWORK_KINDS.cover, albumId: cover.albumId, version: cover.coverVersion }

/** The cover saved with a group's tracks, which they share; null while none is. */
const savedArtOf = (views: readonly DownloadView[]): string | null =>
  views.find((view) => view.pictures.art !== null)?.pictures.art ?? null

/** The title art every file of a group shares; none when they differ, as a saga's films' do. */
const sharedLogoOf = (views: readonly DownloadView[]): string | null => {
  const logo = views[0]?.pictures.logo ?? null
  return views.every((view) => view.pictures.logo === logo) ? logo : null
}

type MusicHeadProps = GroupHeadProps

/** An album or playlist: the album cover beside its name and how many of its tracks are here. */
const MusicHead = ({ grouped, headingId, cover, onPlay }: MusicHeadProps) => {
  const { group, views } = grouped
  return (
    <header className={styles.musicHead}>
      <div className={styles.cover}>
        {cover !== null && (
          <DownloadArtwork
            artwork={coverArtworkOf(cover)}
            saved={savedArtOf(views)}
            initial={group.title.slice(0, 1)}
            sizes={POSTER_SIZES.download}
          />
        )}
      </div>
      <h2 id={headingId} className={styles.musicTitle}>
        {group.title}
      </h2>
      <p className={styles.trackCount}>{COMMON_COPY.tracks(views.length)}</p>
      {onPlay !== null && (
        <Button
          className={styles.headPlay}
          tone={BUTTON_TONES.primary}
          icon="play"
          aria-label={DOWNLOAD_ROW_COPY.actionLabel({
            action: COMMON_COPY.play,
            label: group.title,
          })}
          onClick={onPlay}
        >
          {COMMON_COPY.play}
        </Button>
      )}
    </header>
  )
}

/** How a group heads its downloads; a video one leaves a lone file named as its title unheaded. */
type GroupHead = { Head: ComponentType<GroupHeadProps>; isAlwaysHeaded: boolean }

const VIDEO_HEAD = { Head: TitleHead, isAlwaysHeaded: false } as const satisfies GroupHead
const MUSIC_HEAD = { Head: MusicHead, isAlwaysHeaded: true } as const satisfies GroupHead

const GROUP_HEADS = {
  [DOWNLOAD_KINDS.movie]: VIDEO_HEAD,
  [DOWNLOAD_KINDS.episode]: VIDEO_HEAD,
  [DOWNLOAD_KINDS.season]: VIDEO_HEAD,
  [DOWNLOAD_KINDS.show]: VIDEO_HEAD,
  [DOWNLOAD_KINDS.saga]: VIDEO_HEAD,
  [DOWNLOAD_KINDS.album]: MUSIC_HEAD,
  [DOWNLOAD_KINDS.playlist]: MUSIC_HEAD,
} as const satisfies Record<DownloadKind, GroupHead>

type GroupProps = { grouped: Grouped; onDeleted: () => void }

type PlayFromProps = { queue: MusicQueue; startAt: number }

const PLAYS_IN_PLAYER = { kind: ROW_PLAYS.player } as const satisfies RowPlay
const PLAYS_NOTHING = { kind: ROW_PLAYS.none } as const satisfies RowPlay

/** A title's downloads under its name; a movie on its own is its own heading. */
const Group = ({ grouped, onDeleted }: GroupProps) => {
  const headingId = useId()
  const { group, views } = grouped
  const { Head, isAlwaysHeaded } = GROUP_HEADS[group.kind]
  const playTracks = useAudioQueue((store) => store.playTracks)
  const queue = musicQueueOf(grouped)
  const cover = isMusicGroup(group) ? group.cover : null
  const playFrom = ({ queue: { source, playable }, startAt }: PlayFromProps) =>
    playTracks({ tracks: playable.map(({ track }) => track), startAt, source })
  type PlayOfProps = DownloadView

  // A video opens in the player; a track queues its group's downloaded tracks from it.
  const playOf = ({ downloadId }: PlayOfProps): RowPlay => {
    if (!isMusicGroup(group)) return PLAYS_IN_PLAYER
    const startAt = queue?.playable.findIndex((each) => each.downloadId === downloadId) ?? -1
    if (queue === null || startAt < 0) return PLAYS_NOTHING
    return { kind: ROW_PLAYS.queue, play: () => playFrom({ queue, startAt }) }
  }
  const isOwnTitle = views.length === 1 && (views[0]?.label ?? null) === group.title
  const isHeaded = isAlwaysHeaded || !isOwnTitle
  return (
    <li className={styles.group}>
      <section aria-labelledby={isHeaded ? headingId : undefined} className={styles.groupBody}>
        {isHeaded && (
          <Head
            grouped={grouped}
            headingId={headingId}
            cover={cover}
            logo={sharedLogoOf(views)}
            onPlay={queue === null ? null : () => playFrom({ queue, startAt: 0 })}
          />
        )}
        <ul className={styles.rows}>
          {views.map((view) => (
            <DownloadRow
              key={view.downloadId}
              view={view}
              play={playOf(view)}
              onDeleted={onDeleted}
            />
          ))}
        </ul>
      </section>
    </li>
  )
}

type ListedProps = {
  /** The downloads a viewer may see, as the Show choice lays them out. */
  sections: DownloadsSection[]
  onDeleted: () => void
}

const Listed = ({ sections, onDeleted }: ListedProps) => (
  <div className={styles.sections}>
    {sections.map(({ key, name, downloads }) => (
      <LibrarySection key={key} name={name}>
        <ul className={styles.groups}>
          {groupsOf(downloads).map((grouped) => (
            <Group key={grouped.group.key} grouped={grouped} onDeleted={onDeleted} />
          ))}
        </ul>
      </LibrarySection>
    ))}
  </div>
)

type WatchListedProps = ListedProps

/** Tracks play in the music queue, not from a poster, so the grid holds the videos alone. */
const videosOf = (downloads: DownloadView[]): DownloadView[] =>
  downloads.filter((view) => !isMusicGroup(view.group))

const WatchListed = ({ sections }: WatchListedProps) => (
  <DownloadsWatch
    sections={sections
      .map((section) => ({ ...section, downloads: videosOf(section.downloads) }))
      .filter(({ downloads }) => downloads.length > 0)}
  />
)

/** The page's two views of the same downloads: the list to manage them, and the grid to watch. */
const PAGE_TABS = { manage: 'manage', watch: 'watch' } as const

type PageTab = (typeof PAGE_TABS)[keyof typeof PAGE_TABS]

const TAB_VIEWS = {
  [PAGE_TABS.manage]: Listed,
  [PAGE_TABS.watch]: WatchListed,
} as const satisfies Record<PageTab, ComponentType<ListedProps>>

const TAB_LABELS = {
  [PAGE_TABS.manage]: DOWNLOADS_PAGE_COPY.manage,
  [PAGE_TABS.watch]: DOWNLOADS_PAGE_COPY.watch,
} as const satisfies Record<PageTab, string>

type ActivityProps = { downloads: DownloadView[] }

const bytesSoFar = ({ status }: DownloadView): number =>
  status.kind === DOWNLOAD_STATUS_KINDS.downloading ? status.bytes : 0

/** What is downloading and how fast, over a bar that keeps moving while any of it does. */
const Activity = ({ downloads }: ActivityProps) => {
  const speed = useTotalSpeed()
  const active = downloads.filter(isInProgress)
  const label = DOWNLOADS_PAGE_COPY.activity({ files: active.length, speed })
  return (
    active.length > 0 && (
      <div className={styles.activity}>
        <p className={styles.line}>{label}</p>
        <DownloadActivity
          value={active.reduce((sum, view) => sum + bytesSoFar(view), 0)}
          max={active.reduce((sum, view) => sum + view.size, 0)}
          label={label}
        />
      </div>
    )
  )
}

type DiskProps = { disk: SpaceView; lineId: string }

const Disk = ({ disk, lineId }: DiskProps) => (
  <div className={styles.disk}>
    <p id={lineId} className={styles.line}>
      {DOWNLOADS_PAGE_COPY.space(disk)}
    </p>
    <meter
      className={styles.meter}
      min={0}
      max={disk.total}
      value={disk.used}
      aria-label={DOWNLOADS_PAGE_COPY.disk}
      aria-describedby={lineId}
    />
  </div>
)

/** What the list is read from: every download held, and those the viewer may see. */
type HeldDownloads = { held: DownloadView[]; list: DownloadView[] }

/** Every title Raven has downloaded or is downloading, and the disk they are kept on. */
export const DownloadsPage = () => {
  const host = useDownloadsHost()
  const downloads = useDownloads()
  const space = useSpace()
  const change = useChangeDownloads()
  const title = useRef<HTMLHeadingElement>(null)
  const ids = { title: useId(), line: useId() }

  const focusTitle = () => title.current?.focus()

  const held = downloads.data?.downloads ?? null
  const isUnlocked = useDownloadsUnlocked(held ?? [])
  const show = useDownloadsShow((state) => state.show)
  // A private library's downloads are left out of everything below but the bytes on their way.
  const list = held === null ? null : visibleDownloadsOf({ downloads: held, isUnlocked })
  const hasHidden = (held ?? []).length > (list ?? []).length
  const bulks = bulksOf(list ?? [])
  const [tab, setTab] = useState<PageTab>(PAGE_TABS.manage)
  const ListView = TAB_VIEWS[tab]
  const read = keptRead<HeldDownloads>({
    data: held === null || list === null ? undefined : { held, list },
    error: downloads.error,
  })

  return (
    <section className={styles.page} aria-labelledby={ids.title}>
      <header className={styles.header}>
        <PageTitle
          id={ids.title}
          ref={title}
          tabIndex={-1}
          icon="download"
          className={styles.title}
        >
          {COMMON_COPY.downloads}
        </PageTitle>
        <div className={styles.tools}>
          {bulks.map((bulk) => (
            <Button
              key={bulk}
              icon={BULK_BUTTONS[bulk].icon}
              onClick={() => handled(change(BULK_BUTTONS[bulk].request))}
            >
              {BULK_BUTTONS[bulk].label}
            </Button>
          ))}
          {host.canShowFolder && (
            <Button
              icon="folder"
              onClick={() => handled(change({ type: DESKTOP_REQUESTS.showDownloadsFolder }))}
            >
              {DOWNLOADS_PAGE_COPY.showInFinder}
            </Button>
          )}
        </div>
        <Activity downloads={held ?? []} />
        <QueryView
          query={keptRead(space)}
          pending={null}
          renderFailed={(error) => <p className={styles.line}>{error.message}</p>}
        >
          {(disk) => <Disk disk={disk} lineId={ids.line} />}
        </QueryView>
      </header>
      <Tabs
        label={DOWNLOADS_PAGE_COPY.tabs}
        tabs={Object.values(PAGE_TABS).map((value) => ({
          value,
          label: TAB_LABELS[value],
          count: (value === PAGE_TABS.watch ? videosOf(list ?? []) : (list ?? [])).length,
        }))}
        chosen={tab}
        onChoose={setTab}
      >
        <div className={styles.panel}>
          {(list ?? []).length > 0 && <ShowBar />}
          {hasHidden && <p className={styles.line}>{DOWNLOADS_PAGE_COPY.hidden}</p>}
          <QueryView
            query={read}
            pending={null}
            renderFailed={(error) => <p role="alert">{error.message}</p>}
            empty={{
              isEmpty: ({ held: all }) => all.length === 0,
              shown: <p className={styles.empty}>{DOWNLOADS_PAGE_COPY.empty[host.kind]}</p>,
            }}
          >
            {({ list: shown }) => (
              <ListView sections={sectionsOf({ downloads: shown, show })} onDeleted={focusTitle} />
            )}
          </QueryView>
        </div>
      </Tabs>
    </section>
  )
}
