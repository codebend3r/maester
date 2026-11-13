import { useServerUnlock } from '@raven/native'
import { IGNORED } from '@raven/native/headless'
import { useAudioQueue } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'

import { confirmDelete } from '@/downloads/confirmDelete'
import { DOWNLOAD_KINDS } from '@/downloads/downloadEntries'
import { FINISHED_KINDS, downloadsPageOf } from '@/downloads/downloadsPage'
import { DownloadsLayout } from '@/layouts'
import type { ShownGroup, ShownLibrarySection, ShownPictures } from '@/layouts/downloadsKit'
import type { Picture } from '@/queries/cards'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { ROUTE_TARGETS, hrefOf } from '@/routes'
import { useAppPrefs } from '@/stores/appPrefs'
import { useDownloadProgress } from '@/stores/downloadProgress'
import { useDownloads } from '@/stores/downloads'

/** How often the page reads the clock and the free space again while something downloads. */
const TICK_MS = 1000

/** A finished group the music queue plays. */
type MusicGroup = Extract<ShownGroup, { kind: typeof FINISHED_KINDS.music }>

/** The clock, read again every second while `isTicking`, so a quiet download's speed goes. */
const useClock = (isTicking: boolean): number => {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!isTicking) return undefined
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [isTicking])
  return now
}

type PlayMusicProps = { group: MusicGroup; startAt: number }

/** What a group or a row keeps of its pictures: their paths under the documents. */
type SavedPictures = { artPath: string | null; logoPath: string | null }

type UseLockRefreshProps = { session: AppQueries }

/** Writes each library's lock, as the server lists it now, onto the downloads filed under it. */
const useLockRefresh = ({ session }: UseLockRefreshProps) => {
  const libraries = useQuery(session.queries.librariesQuery)
  const serverId = session.server.id
  useEffect(() => {
    if (libraries.data === undefined) return
    useDownloads.getState().refreshLocks({
      serverId,
      locks: libraries.data.map((library) => ({
        libraryId: library.id,
        isLocked: library.settings.locked,
      })),
    })
  }, [libraries.data, serverId])
}

type ServerDownloadsProps = { session: AppQueries }

const ServerDownloads = ({ session }: ServerDownloadsProps) => {
  const serverId = session.server.id
  const router = useRouter()
  const entries = useDownloads((state) => state.entries)
  const disk = useDownloads((state) => state.device.disk)
  const readings = useDownloadProgress((state) => state.readings)
  const samples = useDownloadProgress((state) => state.samples)
  const playTracks = useAudioQueue((store) => store.playTracks)
  const isRunning = useDownloads((state) => state.isRunning)
  const grouping = useAppPrefs((prefs) => prefs.downloadsGrouping)
  const changePrefs = useAppPrefs((prefs) => prefs.change)
  const isUnlocked = useServerUnlock({ serverId })
  useLockRefresh({ session })
  const now = useClock(isRunning)
  const page = downloadsPageOf({
    entries,
    serverId,
    isUnlocked,
    readings,
    samples,
    now,
    // Read on every render: each reading, delete and tick draws the page again.
    freeBytes: disk.freeBytes(),
  })
  const pictureAt = (path: string | null): Picture | null =>
    path === null ? null : { uri: disk.uriOf(path), headers: {} }
  const shownOf = <T extends SavedPictures>(saved: T): T & ShownPictures => ({
    ...saved,
    art: pictureAt(saved.artPath),
    logo: pictureAt(saved.logoPath),
  })
  const finished = page.finished.map(shownOf)
  const finishedByLibrary = page.finishedByLibrary.map((section): ShownLibrarySection => ({
    ...section,
    groups: section.groups.map(shownOf),
  }))
  const underway = page.underway.map(shownOf)
  const store = useDownloads.getState
  const playVideo = (mediaId: number) =>
    router.push(hrefOf({ kind: ROUTE_TARGETS.play, mediaId, at: 0 }))
  const playMusic = ({ group, startAt }: PlayMusicProps) =>
    playTracks({
      tracks: group.tracks,
      startAt,
      source: group.source,
    })
  return (
    <DownloadsLayout
      available={page.available}
      finished={finished}
      finishedByLibrary={finishedByLibrary}
      grouping={grouping}
      onBack={() => router.back()}
      onCancel={({ key }) => {
        store().cancel({ key }).catch(IGNORED)
      }}
      onDelete={(row) =>
        confirmDelete({
          name: row.title,
          onDelete: () => {
            store().remove({ key: row.key }).catch(IGNORED)
          },
        })
      }
      onDeleteAll={() =>
        confirmDelete({ name: null, onDelete: () => store().removeAll().catch(IGNORED) })
      }
      onDeleteGroup={(group) =>
        confirmDelete({
          name: group.title,
          onDelete: () => {
            store().removeGroup({ groupKey: group.key }).catch(IGNORED)
          },
        })
      }
      onGrouping={(downloadsGrouping) => changePrefs({ downloadsGrouping })}
      onMove={(move) => store().move(move)}
      onPlay={({ group, row }) => {
        if (row.kind === DOWNLOAD_KINDS.video) return playVideo(row.mediaId)
        if (group.kind !== FINISHED_KINDS.music) return
        playMusic({
          group,
          startAt: Math.max(
            0,
            group.tracks.findIndex(({ id }) => id === row.mediaId),
          ),
        })
      }}
      onPlayGroup={(group) => {
        if (group.kind === FINISHED_KINDS.music) return playMusic({ group, startAt: 0 })
        const [first] = group.rows
        if (first !== undefined) playVideo(first.mediaId)
      }}
      onRetry={({ key }) => {
        store().retry({ key }).catch(IGNORED)
      }}
      speed={page.speed}
      underway={underway}
      used={page.used}
    />
  )
}

/**
 * `/downloads`: the space left on the device, the downloads on their way with their progress
 * and speed, and those on the device, grouped and played from their files, the server or no
 * server. Each server keeps its own.
 */
export const Downloads = () => {
  const session = useAppQueries()
  return session !== null && <ServerDownloads key={session.server.id} session={session} />
}
