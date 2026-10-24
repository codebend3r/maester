import { jest } from '@jest/globals'
import { act } from '@testing-library/react-native'
import { type Ref, useEffect, useImperativeHandle } from 'react'
import type * as VideoModule from 'react-native-video'
import type { ReactVideoProps, VideoRef } from 'react-native-video'

/** The props the stand-in player was last drawn with, and the seeks it was asked for. */
export const drawnVideo: {
  props: ReactVideoProps | null
  seek: jest.Mock<(time: number) => void>
} = { props: null, seek: jest.fn() }

/** Forgets what the stand-in player was drawn with and asked, as each test starts. */
export const resetDrawnVideo = (): void => {
  drawnVideo.props = null
  drawnVideo.seek.mockClear()
}

/** A player that draws nothing and keeps its props, which the test fires the player's events through. */
const Video = ({ ref, ...props }: ReactVideoProps & { ref?: Ref<VideoRef> }) => {
  useEffect(() => {
    drawnVideo.props = props
  })
  useImperativeHandle(ref, () => ({
    seek: (time: number) => drawnVideo.seek(time),
    resume: () => undefined,
    pause: () => undefined,
    presentFullscreenPlayer: () => undefined,
    dismissFullscreenPlayer: () => undefined,
    restoreUserInterfaceForPictureInPictureStopCompleted: () => undefined,
    save: () => undefined,
    setVolume: () => undefined,
    getCurrentPosition: async () => 0,
    setFullScreen: () => undefined,
    setSource: () => undefined,
    enterPictureInPicture: () => undefined,
    exitPictureInPicture: () => undefined,
  }))
  return null
}

/**
 * `react-native-video` with its player swapped for the stand-in, its own constants kept. A test
 * hands it to `jest.mock` through `jest.requireActual`, so the module and the test share
 * `drawnVideo`; read lazily, since `react-native-video` itself is the module being mocked.
 */
export const videoModuleMock = () => ({
  ...jest.requireActual<typeof VideoModule>('react-native-video'),
  __esModule: true,
  default: Video,
})

/** Fires what the player says as it opens its source, `duration` seconds long, and starts. */
export const startVideo = async ({
  props: { onLoad, onPlaybackStateChanged, onBuffer },
  duration,
}: {
  props: ReactVideoProps
  duration: number
}): Promise<void> => {
  if (onLoad === undefined || onPlaybackStateChanged === undefined || onBuffer === undefined) {
    throw new Error('The player must hear its load, playback and buffering events')
  }
  await act(async () => {
    onLoad({
      currentTime: 0,
      duration,
      naturalSize: { width: 1920, height: 1080, orientation: 'landscape' },
      audioTracks: [],
      textTracks: [],
      videoTracks: [],
    })
    onPlaybackStateChanged({ isPlaying: true, isSeeking: false })
    onBuffer({ isBuffering: false })
  })
}

/** Fires the player's report that it has reached `seconds`. */
export const moveVideoTo = async ({
  props: { onProgress },
  seconds,
}: {
  props: ReactVideoProps
  seconds: number
}): Promise<void> => {
  if (onProgress === undefined) throw new Error('The player hears no progress')
  await act(async () => {
    onProgress({ currentTime: seconds, playableDuration: seconds, seekableDuration: 6000 })
  })
}
