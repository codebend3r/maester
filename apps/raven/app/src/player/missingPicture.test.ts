import { describe, expect, it } from 'bun:test'
import { PLAYBACK_MODES } from '@raven/core'

import { APP_PLATFORMS } from '@/platform/platform'
import {
  NO_PICTURE_SECONDS,
  PICTURE_HEARINGS,
  type PictureHearing,
  type PictureWatch,
  watchPicture,
} from '@/player/missingPicture'

type PlayProps = {
  hearings: readonly PictureHearing[]
  platform?: (typeof APP_PLATFORMS)[keyof typeof APP_PLATFORMS]
  mode?: (typeof PLAYBACK_MODES)[keyof typeof PLAYBACK_MODES]
}

/** Hears each event in turn and says whether any of them found the picture missing. */
const play = ({
  hearings,
  platform = APP_PLATFORMS.tvos,
  mode = PLAYBACK_MODES.direct,
}: PlayProps) =>
  hearings.reduce<{ watch: PictureWatch | null; isMissing: boolean }>(
    (heard, hearing) => {
      const next = watchPicture({ watch: heard.watch, hearing, platform, mode })
      return { watch: next.watch, isMissing: heard.isMissing || next.isMissing }
    },
    { watch: null, isMissing: false },
  ).isMissing

type MovedProps = { clock: number; attempt?: number }

const moved = ({ clock, attempt = 1 }: MovedProps): PictureHearing => ({
  type: PICTURE_HEARINGS.moved,
  attempt,
  clock,
})

type DrawnProps = { attempt?: number }

const drawn = ({ attempt = 1 }: DrawnProps = {}): PictureHearing => ({
  type: PICTURE_HEARINGS.drawn,
  attempt,
})

describe('watchPicture', () => {
  it('finds a direct play on Apple TV missing its picture once its sound has run on without one', () => {
    expect(
      play({ hearings: [moved({ clock: 600 }), moved({ clock: 600 + NO_PICTURE_SECONDS })] }),
    ).toBe(true)
  })

  it('waits the whole grace before saying so', () => {
    expect(
      play({ hearings: [moved({ clock: 600 }), moved({ clock: 600 + NO_PICTURE_SECONDS - 1 })] }),
    ).toBe(false)
  })

  it('finds nothing missing once a picture is drawn', () => {
    expect(
      play({ hearings: [moved({ clock: 0 }), drawn(), moved({ clock: NO_PICTURE_SECONDS * 3 })] }),
    ).toBe(false)
  })

  it('judges each attempt on its own, so a new source starts its grace afresh', () => {
    expect(
      play({
        hearings: [
          moved({ clock: 0, attempt: 1 }),
          drawn({ attempt: 1 }),
          moved({ clock: 10, attempt: 2 }),
          moved({ clock: 10 + NO_PICTURE_SECONDS, attempt: 2 }),
        ],
      }),
    ).toBe(true)
    expect(
      play({
        hearings: [
          moved({ clock: 0, attempt: 1 }),
          moved({ clock: 2, attempt: 1 }),
          moved({ clock: 3, attempt: 2 }),
          moved({ clock: 5, attempt: 2 }),
        ],
      }),
    ).toBe(false)
  })

  it('leaves a stream alone, which carries the picture the server made', () => {
    expect(
      play({
        hearings: [moved({ clock: 0 }), moved({ clock: NO_PICTURE_SECONDS * 2 })],
        mode: PLAYBACK_MODES.remux,
      }),
    ).toBe(false)
  })

  it('leaves Android TV alone, whose player reports what it cannot decode', () => {
    expect(
      play({
        hearings: [moved({ clock: 0 }), moved({ clock: NO_PICTURE_SECONDS * 2 })],
        platform: APP_PLATFORMS.androidTv,
      }),
    ).toBe(false)
  })
})
