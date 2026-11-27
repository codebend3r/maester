import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { LAUNCH_INTRO_TEST_ID } from '@raven/native'
import { act, render, screen } from '@testing-library/react-native'

import { DEVICE_LAUNCHES } from '@/layouts/Launch'
import { NAV_KINDS } from '@/platform/platform'

// Longer than the shortest time the mark stays up.
const SHOWN_MS = 2000

const queryIntro = () => screen.queryByTestId(LAUNCH_INTRO_TEST_ID, { includeHiddenElements: true })

describe('DEVICE_LAUNCHES', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it("opens a TV on raven's mark, which goes once the routes are drawn and it has been seen", async () => {
    const TvLaunch = DEVICE_LAUNCHES[NAV_KINDS.focus]
    await render(<TvLaunch isReady onShown={jest.fn()} />)
    expect(queryIntro()).toBeTruthy()

    await act(() => jest.advanceTimersByTime(SHOWN_MS))
    await act(() => jest.advanceTimersByTime(SHOWN_MS))
    expect(queryIntro()).toBeNull()
  })

  it.each([NAV_KINDS.tabs, NAV_KINDS.drawer])(
    'opens a %s device straight from the splash once the routes are drawn',
    async (kind) => {
      const SplashLaunch = DEVICE_LAUNCHES[kind]
      const onShown = jest.fn()
      const view = await render(<SplashLaunch isReady={false} onShown={onShown} />)
      expect(queryIntro()).toBeNull()
      expect(onShown).not.toHaveBeenCalled()

      await view.rerender(<SplashLaunch isReady onShown={onShown} />)
      expect(onShown).toHaveBeenCalledTimes(1)
    },
  )
})
