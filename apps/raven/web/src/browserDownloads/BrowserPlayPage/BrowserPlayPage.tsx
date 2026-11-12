import {
  DESKTOP_PATHS,
  DOWNLOAD_STATUS_KINDS,
  type DownloadView,
  isOpaqueId,
  PLAYER_SOURCE_KINDS,
  resumeAtFor,
} from '@raven/core'
import { createProgressSaver, Player, useLeaveFullscreen } from '@raven/ui'
import {
  ENGINE_KINDS,
  type FileSubtitles,
  type PlayerServices,
  useHostPlayer,
} from '@raven/ui/headless'
import { type ComponentType, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { BROWSER_PLAY_COPY } from '@/browserDownloads/BrowserPlayPage/copy'
import { BROWSER_DOWNLOAD_COPY } from '@/browserDownloads/copy'
import type { BrowserDownloads, PlayableDownload } from '@/browserDownloads/engine'
import { useDownloads } from '@/desktop/downloadsApi'
import { DOWNLOADS_PAGE_COPY } from '@/desktop/DownloadsPage/copy'
import { visibleDownloadsOf } from '@/desktop/DownloadsPage/libraries'
import { useDownloadsUnlocked } from '@/desktop/DownloadsPage/useDownloadsUnlocked'
import { PlayerMessage } from '@/desktop/player/PlayerMessage'
import { api } from '@/lib/api'
import { useBrowserDownloads } from '@/stores/browserDownloads'
import { useServerReach } from '@/stores/serverReach'

/** Whether the server answers now, read as each report is made, not when the player opened. */
const isReached = (): boolean => !useServerReach.getState().isOffline

type ServicesForProps = { engine: BrowserDownloads; download: PlayableDownload }

/*
 * A download's services. Where it was left is kept with the download, so it resumes with no
 * server; while the server answers, the play and each position also go to it as a watch page's
 * do, and what is watched out of its reach stays on this browser alone.
 */
const servicesFor = ({ engine, download }: ServicesForProps): PlayerServices => {
  const { downloadId, media } = download
  const saver =
    media === null
      ? null
      : createProgressSaver({ send: (report) => api.saveProgress({ id: media.id, ...report }) })
  // The share watched needs the length, which only the player learns of a file.
  const length: { seconds: number | null } = { seconds: media?.duration ?? null }
  const keep = (position: number): void =>
    engine.savePosition({ downloadId, position, duration: length.seconds })
  return {
    title: {
      label: download.label,
      logo: download.logo,
      context: BROWSER_PLAY_COPY.downloaded,
      duration: media?.duration ?? null,
      resumeAt:
        media === null
          ? download.resumeAt
          : resumeAtFor({ at: 0, media: { ...media, position: download.resumeAt } }),
      backTo: DESKTOP_PATHS.downloads,
      next: null,
    },
    progress: {
      started: () => {
        if (media !== null && isReached()) api.recordPlay(media.id).catch(() => undefined)
      },
      save: (report) => {
        keep(report.position)
        if (isReached()) saver?.save(report)
      },
      left: keep,
      duration: (seconds) => {
        length.seconds = seconds
      },
    },
    posterUrl: null,
    escape: null,
  }
}

type PlayingProps = { engine: BrowserDownloads; download: PlayableDownload; url: string }

/** The browser's own video on the file's object URL, hosted for as long as it plays. */
const Playing = ({ engine, download, url }: PlayingProps) => {
  const services = useMemo(() => servicesFor({ engine, download }), [engine, download])
  // The subtitles saved with the download, since a browser draws none of an MP4's own.
  const subtitles = useMemo<FileSubtitles>(
    () => ({
      tracks: download.subtitles,
      read: (trackId) => engine.cues({ downloadId: download.downloadId, trackId }),
    }),
    [engine, download],
  )
  const isHosting = useHostPlayer(services)
  return (
    isHosting && (
      <Player
        engine={{
          kind: ENGINE_KINDS.html,
          source: { kind: PLAYER_SOURCE_KINDS.file, url, subtitles },
        }}
      />
    )
  )
}

type Opened = { download: PlayableDownload; url: string }

type UseOpenedProps = { engine: BrowserDownloads; downloadId: string; isReady: boolean }

/*
 * The download's file as an object URL, made when the page opens it and let go of when the page
 * leaves, so the browser frees it. The file stays on disk behind the URL: seeking reads it there.
 */
const useOpened = ({ engine, downloadId, isReady }: UseOpenedProps) => {
  const [opened, setOpened] = useState<Opened | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)

  useEffect(() => {
    if (!isReady) return
    const page = { isOpen: true, url: '' }
    const open = async (): Promise<void> => {
      const playable = engine.playable(downloadId)
      if (!playable.ok) return setRefusal(playable.message)
      const url = await engine.open(downloadId)
      if (url === null) return setRefusal(BROWSER_DOWNLOAD_COPY.fileGone)
      // The page left while the file was found: nothing will play it.
      if (!page.isOpen) return engine.close(url)
      page.url = url
      setOpened({ download: playable.value, url })
    }
    open().catch(() => setRefusal(BROWSER_DOWNLOAD_COPY.fileGone))
    return () => {
      page.isOpen = false
      if (page.url !== '') engine.close(page.url)
      setOpened(null)
    }
  }, [engine, downloadId, isReady])

  return { opened, refusal }
}

type MessageOfProps = {
  view: DownloadView | null
  isHidden: boolean
  /** Whether the list is whole: read from disk, for the account the page shows. */
  isListed: boolean
  refusal: string | null
}

/** Why a download does not play; null for one that does, or while the list is still being read. */
const messageOf = ({ view, isHidden, isListed, refusal }: MessageOfProps): string | null => {
  if (isHidden) return DOWNLOADS_PAGE_COPY.hidden
  if (view === null) return isListed ? BROWSER_DOWNLOAD_COPY.unknown : null
  return view.status.kind === DOWNLOAD_STATUS_KINDS.ready ? refusal : BROWSER_DOWNLOAD_COPY.notReady
}

const PAGE_KINDS = { playing: 'playing', message: 'message' } as const

type PageKind = (typeof PAGE_KINDS)[keyof typeof PAGE_KINDS]

type PageViewProps = { engine: BrowserDownloads; opened: Opened | null; message: string | null }

type OpenedPlayingProps = PageViewProps

const OpenedPlaying = ({ engine, opened }: OpenedPlayingProps) =>
  opened !== null && <Playing engine={engine} download={opened.download} url={opened.url} />

type DownloadMessageProps = PageViewProps

const DownloadMessage = ({ message }: DownloadMessageProps) => (
  <PlayerMessage message={message} fallback={DESKTOP_PATHS.downloads} />
)

const PAGE_VIEWS = {
  [PAGE_KINDS.playing]: OpenedPlaying,
  [PAGE_KINDS.message]: DownloadMessage,
} as const satisfies Record<PageKind, ComponentType<PageViewProps>>

type BrowserPlayPageProps = { engine: BrowserDownloads; downloadId: string }

/*
 * A download playing with no server. It reads the same list the Downloads page does, so a
 * private library's download stays shut until the PIN is entered. While the list is still being
 * read from disk the page waits; once it is whole, a download it does not hold is refused, with
 * the way back to Downloads.
 */
const BrowserPlayPage = ({ engine, downloadId }: BrowserPlayPageProps) => {
  useLeaveFullscreen()
  const listed = useDownloads().data?.downloads ?? null
  const held = listed ?? []
  const isUnlocked = useDownloadsUnlocked(held)
  const visible = visibleDownloadsOf({ downloads: held, isUnlocked })
  const view = visible.find((each) => each.downloadId === downloadId) ?? null
  const isHidden = view === null && held.some((each) => each.downloadId === downloadId)
  const isReady = (view?.status.kind ?? null) === DOWNLOAD_STATUS_KINDS.ready
  const { opened, refusal } = useOpened({ engine, downloadId, isReady })
  const View = PAGE_VIEWS[opened === null ? PAGE_KINDS.message : PAGE_KINDS.playing]
  const isListed = listed !== null && engine.isSettled()
  return (
    <View
      engine={engine}
      opened={opened}
      message={messageOf({ view, isHidden, isListed, refusal })}
    />
  )
}

const ROUTE_KINDS = { known: 'known', invalid: 'invalid' } as const

type RouteKind = (typeof ROUTE_KINDS)[keyof typeof ROUTE_KINDS]

type RouteViewProps = { engine: BrowserDownloads | null; downloadId: string | undefined }

type KnownDownloadProps = RouteViewProps

const KnownDownload = ({ engine, downloadId }: KnownDownloadProps) =>
  engine !== null &&
  isOpaqueId(downloadId) && (
    <BrowserPlayPage key={downloadId} engine={engine} downloadId={downloadId} />
  )

const InvalidDownload = () => (
  <PlayerMessage message={BROWSER_PLAY_COPY.notOpenable} fallback={DESKTOP_PATHS.downloads} />
)

const ROUTE_VIEWS = {
  [ROUTE_KINDS.known]: KnownDownload,
  [ROUTE_KINDS.invalid]: InvalidDownload,
} as const satisfies Record<RouteKind, ComponentType<RouteViewProps>>

/**
 * A download in the browser's own player, by its id. Keyed by download, so another one remounts
 * the player and its unmount saves the old position first.
 */
export const BrowserPlayRoute = () => {
  const { downloadId } = useParams()
  const engine = useBrowserDownloads((state) => state.engine)
  const isKnown = engine !== null && isOpaqueId(downloadId)
  const View = ROUTE_VIEWS[isKnown ? ROUTE_KINDS.known : ROUTE_KINDS.invalid]
  return <View engine={engine} downloadId={downloadId} />
}
