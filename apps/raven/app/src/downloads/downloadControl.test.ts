import { describe, expect, it } from 'bun:test'

import { DOWNLOAD_COPY } from '@/downloads/copy'
import { DOWNLOAD_ACTIONS, downloadControlOf } from '@/downloads/downloadControl'
import { DOWNLOAD_STATES } from '@/downloads/downloadEntries'
import { DONE_STATUS, downloadKeyFor, videoEntryOf } from '@/test/downloadFixtures'

describe('downloadControlOf', () => {
  const none = { held: [], wanted: 1, readings: {}, name: 'Busboys', blocked: null }

  it('draws a faint Download saying why when nothing of it can come to this device', () => {
    expect(downloadControlOf({ ...none, blocked: DOWNLOAD_COPY.cantDownload })).toMatchObject({
      label: DOWNLOAD_COPY.cantDownload,
      text: DOWNLOAD_COPY.download,
      isDisabled: true,
      action: DOWNLOAD_ACTIONS.none,
    })
  })

  it('reads Download until something is asked for', () => {
    expect(downloadControlOf(none)).toMatchObject({
      text: DOWNLOAD_COPY.download,
      action: DOWNLOAD_ACTIONS.download,
      isOn: false,
    })
  })

  it("says how far one file has come, the server's copy's percent first, and cancels on a press", () => {
    const preparing = videoEntryOf({
      id: 1,
      status: { state: DOWNLOAD_STATES.preparing, progress: 0.42 },
    })
    expect(downloadControlOf({ ...none, held: [preparing] })).toMatchObject({
      text: 'Preparing on server 42%',
      action: DOWNLOAD_ACTIONS.cancel,
    })
    const coming = videoEntryOf({ id: 1, status: { state: DOWNLOAD_STATES.downloading } })
    expect(
      downloadControlOf({
        ...none,
        held: [coming],
        readings: { [downloadKeyFor(1)]: { bytes: 300, total: 1000 } },
      }),
    ).toMatchObject({ text: '30%', action: DOWNLOAD_ACTIONS.cancel })
  })

  it('counts a group in, then reads Downloaded and deletes once all of it is', () => {
    const held = [
      videoEntryOf({ id: 1, status: DONE_STATUS }),
      videoEntryOf({ id: 2, status: { state: DOWNLOAD_STATES.queued, preparing: null } }),
    ]
    expect(downloadControlOf({ ...none, held, wanted: 2 })).toMatchObject({
      text: 'Downloading 1 of 2',
      isDisabled: true,
    })
    const all = [
      videoEntryOf({ id: 1, status: DONE_STATUS }),
      videoEntryOf({ id: 2, status: DONE_STATUS }),
    ]
    expect(downloadControlOf({ ...none, held: all, wanted: 2 })).toMatchObject({
      text: DOWNLOAD_COPY.downloaded,
      isOn: true,
      action: DOWNLOAD_ACTIONS.remove,
    })
    expect(downloadControlOf({ ...none, held: all, wanted: 3 }).action).toBe(
      DOWNLOAD_ACTIONS.download,
    )
  })

  it('offers Retry once one failed', () => {
    const failed = videoEntryOf({
      id: 1,
      status: { state: DOWNLOAD_STATES.failed, message: 'No.' },
    })
    expect(downloadControlOf({ ...none, held: [failed] }).action).toBe(DOWNLOAD_ACTIONS.retry)
  })
})
