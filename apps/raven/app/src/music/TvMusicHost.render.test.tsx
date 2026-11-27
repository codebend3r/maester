import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { TRACK_STREAM_KINDS } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import { waitFor } from '@testing-library/react-native'

import { TvMusicHost } from '@/music/TvMusicHost'
import { usePlayedStreams } from '@raven/native/headless'
import { NAS } from '@/test/homeServer'
import { AIRBAG, musicApi } from '@/test/musicServer'
import { createScreenClient, renderScreen, untilIdle } from '@/test/renderScreen'
import type * as VideoMock from '@raven/native/testing/video'
import { drawnVideo, resetDrawnVideo } from '@raven/native/testing/video'

type SourceAnswer =
  | { ok: true; source: { uri: string; headers: Record<string, string> } }
  | { ok: false; message: string }

const FILE: SourceAnswer = { ok: true, source: { uri: `${NAS.origin}/airbag.flac`, headers: {} } }
const mockSource = jest.fn(async (): Promise<SourceAnswer> => FILE)

jest.mock('react-native-video', () =>
  jest.requireActual<typeof VideoMock>('@raven/native/testing/video').videoModuleMock(),
)
jest.mock('@/player/mediaSources', () => ({
  mediaSourcesFor: () => ({ source: () => mockSource() }),
}))

const renderHost = async () => {
  const client = createScreenClient()
  await renderScreen({
    ui: <TvMusicHost session={{ server: NAS, api: musicApi() }} />,
    client,
  })
  return client
}

describe('TvMusicHost', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetDrawnVideo()
    mockSource.mockResolvedValue(FILE)
    useAudioQueue.getState().clear()
    usePlayedStreams.setState({ streams: {} })
  })

  it('says a track plays from the file itself once its address is made', async () => {
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG] })
    const client = await renderHost()
    await waitFor(() => expect(drawnVideo.props).not.toBeNull())
    expect(usePlayedStreams.getState().streams[AIRBAG.id]).toEqual({
      kind: TRACK_STREAM_KINDS.file,
    })
    await untilIdle(client)
  })

  it('says nothing of a track the server would not play', async () => {
    mockSource.mockResolvedValue({ ok: false, message: 'Not yours to play.' })
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG] })
    const client = await renderHost()
    await waitFor(() => expect(useAudioQueue.getState().error).toBe('Not yours to play.'))
    expect(usePlayedStreams.getState().streams).toEqual({})
    await untilIdle(client)
  })
})
