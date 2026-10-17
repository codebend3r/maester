import { fakeClient } from '@/renderer/test/render'
import { S } from '@/renderer/test/serverFakes'
import type { DesktopReply, DesktopRequest, DownloadView, SpaceView } from '@/shared/protocol'

export const GB = 1_000_000_000

export const DL_1 = '0a000000-0000-4000-8000-000000000001'
export const DL_2 = '0a000000-0000-4000-8000-000000000002'
export const DL_3 = '0a000000-0000-4000-8000-000000000003'
export const DL_4 = '0a000000-0000-4000-8000-000000000004'
export const DL_5 = '0a000000-0000-4000-8000-000000000005'

export const SPACE: SpaceView = { free: 412 * GB, total: 1000 * GB, used: 34.2 * GB }

/** An episode of Severance from Vhagar, queued unless `overrides` say otherwise. */
export const viewOf = (overrides: Partial<DownloadView> = {}): DownloadView => ({
  downloadId: DL_1,
  serverId: S,
  label: 'S01E01 Good News',
  group: { kind: 'season', key: 'show:4', title: 'Severance', order: 10_001 },
  serverName: 'Vhagar',
  size: 2 * GB,
  status: { kind: 'queued' },
  autoDelete: false,
  watched: null,
  deletesAt: null,
  needsUnlock: false,
  ...overrides,
})

type Answers = Partial<Record<DesktopRequest['type'], DesktopReply>>

/**
 * Main as the downloads screens see it: it keeps the list and answers each change with the
 * new one, or with `answers` by request type. `extra` answers anything else first.
 */
export const downloadsMain = ({
  downloads = [],
  autoDeleteDefault = false,
  space = SPACE,
  answers = {},
  extra = () => null,
}: {
  downloads?: DownloadView[]
  autoDeleteDefault?: boolean
  space?: SpaceView
  answers?: Answers
  extra?: (request: DesktopRequest) => DesktopReply | null
} = {}) => {
  const state = { downloads, autoDeleteDefault }
  const listed = (): DesktopReply => ({
    type: 'downloads',
    downloads: state.downloads,
    autoDeleteDefault: state.autoDeleteDefault,
  })
  const update = ({
    downloadId,
    change,
  }: {
    downloadId: string
    change: (view: DownloadView) => DownloadView
  }): DesktopReply => {
    state.downloads = state.downloads.map((view) =>
      view.downloadId === downloadId ? change(view) : view,
    )
    return listed()
  }
  const respond = (request: DesktopRequest): DesktopReply => {
    const answer = answers[request.type] ?? extra(request)
    if (answer !== undefined && answer !== null) return answer
    switch (request.type) {
      case 'listDownloads':
        return listed()
      case 'readSpace':
        return { type: 'space', space }
      case 'listRecents':
        return { type: 'recents', recents: [] }
      case 'pauseDownload':
        return update({
          downloadId: request.downloadId,
          change: (view) => ({ ...view, status: { kind: 'paused', bytes: 0, message: null } }),
        })
      case 'resumeDownload':
      case 'retryDownload':
        return update({
          downloadId: request.downloadId,
          change: (view) => ({ ...view, status: { kind: 'queued' }, needsUnlock: false }),
        })
      case 'setDownloadAutoDelete':
        return update({
          downloadId: request.downloadId,
          change: (view) => ({ ...view, autoDelete: request.autoDelete }),
        })
      case 'deleteDownload':
        state.downloads = state.downloads.filter((view) => view.downloadId !== request.downloadId)
        return listed()
      case 'deleteAllDownloads':
        state.downloads = []
        return listed()
      case 'setDownloadDefaults':
        state.autoDeleteDefault = request.autoDelete
        return listed()
      default:
        return { type: 'done' }
    }
  }
  return { client: fakeClient({ request: async (request) => respond(request) }), respond }
}
