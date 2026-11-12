import { DOWNLOAD_STATUS_KINDS, CONTAINERS } from '@raven/core'
import { describe, expect, it } from 'bun:test'
import { waitFor } from '@testing-library/react'
import { INDEX_PATH, readIndex } from '@/browserDownloads/entries'
import {
  bytesOfLength,
  fakeDisk,
  fakeEngine,
  fakeServer,
  fakeTabs,
  queueVideo,
  statusesOf,
  stuckAnswer,
  videoTarget,
} from '@/test/browserDownloads'
import { itemDetails, itemSummary, mediaItem } from '@/test/fixtures'

const MOVIE = mediaItem({
  id: 7,
  container: CONTAINERS.mp4,
  size: 10,
  item: itemSummary({ id: 40 }),
})
const SECOND = mediaItem({ id: 8, container: CONTAINERS.mp4, size: 6, title: 'Second', item: null })
const FILES = { 7: bytesOfLength(10), 8: bytesOfLength(6) }

const server = () =>
  fakeServer({
    media: [MOVIE, SECOND],
    items: [itemDetails({ id: 40, posterVersion: null, logoVersion: null })],
    files: FILES,
  })

describe('browser downloads: several tabs', () => {
  /** Two tabs over one disk: `holder` asked first, so the queue is its own. */
  const twoTabs = async () => {
    const hub = fakeTabs()
    const disk = fakeDisk()
    const first = hub.open()
    const second = hub.open()
    const holder = await fakeEngine({ disk, server: server(), tabs: first.tabs })
    const other = await fakeEngine({ disk, server: server(), tabs: second.tabs, firstId: 1000 })
    return { disk, holder, other, first }
  }

  const mediaFiles = (disk: ReturnType<typeof fakeDisk>) =>
    disk.names().filter((name) => name.endsWith('media.mp4'))

  it('downloads only in the tab that holds the queue, whichever tab asked', async () => {
    const { holder, other } = await twoTabs()
    await queueVideo({ engine: other.engine, mediaId: 7 })
    await waitFor(() => expect(statusesOf(other.engine)).toEqual([DOWNLOAD_STATUS_KINDS.ready]))
    expect(statusesOf(holder.engine)).toEqual([DOWNLOAD_STATUS_KINDS.ready])
    expect(holder.server.calls).toHaveLength(1)
    expect(other.server.calls).toEqual([])
  })

  it('writes what both tabs queued, neither over the other', async () => {
    const { disk, holder, other } = await twoTabs()
    await Promise.all([
      queueVideo({ engine: holder.engine, mediaId: 7 }),
      queueVideo({ engine: other.engine, mediaId: 8 }),
    ])
    const ready = [DOWNLOAD_STATUS_KINDS.ready, DOWNLOAD_STATUS_KINDS.ready]
    await waitFor(() => expect(statusesOf(holder.engine)).toEqual(ready))
    await waitFor(() => expect(statusesOf(other.engine)).toEqual(ready))
    const index = readIndex((await disk.textOf(INDEX_PATH)) ?? '')
    expect(index.map(({ mediaId }) => mediaId).toSorted()).toEqual([7, 8])
    expect(other.server.calls).toEqual([])
  })

  it('queues a video once when both tabs confirm it at the same time', async () => {
    const { disk, holder, other } = await twoTabs()
    const asks = await Promise.all([
      holder.engine.ask(videoTarget(7)),
      other.engine.ask(videoTarget(7)),
    ])
    const [mine, theirs] = asks.map((asked) => (asked.ok ? asked.value.askId : ''))
    holder.engine.confirm(mine ?? '')
    other.engine.confirm(theirs ?? '')
    await waitFor(() => expect(statusesOf(other.engine)).toEqual([DOWNLOAD_STATUS_KINDS.ready]))
    expect(readIndex((await disk.textOf(INDEX_PATH)) ?? '')).toHaveLength(1)
  })

  it("shows the other tab the run's progress, and stops the run when that tab pauses it", async () => {
    const { holder, other } = await twoTabs()
    const stuck = stuckAnswer(FILES[7].slice(0, 4))
    holder.server.answers.push(stuck.answer)
    await queueVideo({ engine: holder.engine, mediaId: 7 })
    await waitFor(() =>
      expect(statusesOf(holder.engine)).toEqual([DOWNLOAD_STATUS_KINDS.downloading]),
    )
    holder.clock.advance(1000)
    stuck.send(FILES[7].slice(4, 8))
    await waitFor(() =>
      expect(other.engine.list()[0]?.status ?? null).toEqual({
        kind: DOWNLOAD_STATUS_KINDS.downloading,
        bytes: 8,
      }),
    )
    const id = other.engine.list()[0]?.downloadId ?? ''
    other.engine.pause(id)
    await waitFor(() => expect(statusesOf(holder.engine)).toEqual([DOWNLOAD_STATUS_KINDS.paused]))
    other.engine.resume(id)
    await waitFor(() => expect(statusesOf(other.engine)).toEqual([DOWNLOAD_STATUS_KINDS.ready]))
    expect(holder.server.calls.map(({ from }) => from)).toEqual([0, 8])
    expect(other.server.calls).toEqual([])
  })

  it('stops the run of a download another tab deletes, and removes its file', async () => {
    const { disk, holder, other } = await twoTabs()
    const stuck = stuckAnswer(FILES[7].slice(0, 4))
    holder.server.answers.push(stuck.answer)
    await queueVideo({ engine: holder.engine, mediaId: 7 })
    await waitFor(() =>
      expect(statusesOf(holder.engine)).toEqual([DOWNLOAD_STATUS_KINDS.downloading]),
    )
    await other.engine.remove(other.engine.list()[0]?.downloadId ?? '')
    await waitFor(() => expect(holder.engine.list()).toEqual([]))
    // The file the holder was writing closes after the other tab's delete, and goes with it.
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(mediaFiles(disk)).toEqual([])
    expect(readIndex((await disk.textOf(INDEX_PATH)) ?? '')).toEqual([])
  })

  it('takes the queue over once the tab that held it closes', async () => {
    const { holder, other, first } = await twoTabs()
    first.close()
    await queueVideo({ engine: other.engine, mediaId: 7 })
    await waitFor(() => expect(statusesOf(other.engine)).toEqual([DOWNLOAD_STATUS_KINDS.ready]))
    expect(other.server.calls).toHaveLength(1)
    expect(holder.server.calls).toEqual([])
  })
})
