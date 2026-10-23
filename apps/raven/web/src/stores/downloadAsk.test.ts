import { describe, expect, it } from 'bun:test'
import { DESKTOP_REQUESTS, DOWNLOAD_ASK_KINDS, type DownloadAsk } from '@raven/core'
import { useDownloadAsk } from '@/stores/downloadAsk'
import { ASK_ID, asDesktop, fakeClient, SERVER_ID, sentOfType } from '@/test/desktop'

const OTHER_ASK_ID = '0c000000-0000-4000-8000-000000000002'

const askOf = (askId: string): DownloadAsk => ({
  askId,
  serverId: SERVER_ID,
  serverName: 'raven',
  shouldAutoDelete: false,
  status: { kind: DOWNLOAD_ASK_KINDS.locked },
})

describe('useDownloadAsk', () => {
  it('declines an ask a new one replaces, and keeps one asked again', () => {
    const client = fakeClient()
    asDesktop(client)
    const { show } = useDownloadAsk.getState()
    show(askOf(ASK_ID))
    show(askOf(ASK_ID))
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.declineDownload })).toEqual([])
    show(askOf(OTHER_ASK_ID))
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.declineDownload })).toEqual([
      { type: DESKTOP_REQUESTS.declineDownload, askId: ASK_ID },
    ])
    expect(useDownloadAsk.getState().shown).toEqual({ ask: askOf(OTHER_ASK_ID), instance: 3 })
  })

  it('declines nothing outside Raven', () => {
    useDownloadAsk.getState().show(askOf(ASK_ID))
    useDownloadAsk.getState().show(askOf(OTHER_ASK_ID))
    expect(useDownloadAsk.getState().shown?.instance).toBe(2)
  })
})
