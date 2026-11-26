import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { LAUNCH_INTRO_TEST_ID } from '@raven/native'
import { act, fireEvent, render, screen } from '@testing-library/react-native'

import { WrenLaunch } from '@/shell/WrenLaunch'

// Longer than the shortest time the lockup stays up and its fade together.
const WHOLE_INTRO_MS = 3000

const queryIntro = () => screen.queryByTestId(LAUNCH_INTRO_TEST_ID, { includeHiddenElements: true })

describe('WrenLaunch', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('takes over from the splash on its first frame, and goes once Wren is ready', async () => {
    const onShown = jest.fn()
    const view = await render(<WrenLaunch isReady={false} onShown={onShown} />)
    await fireEvent(
      screen.getByTestId(LAUNCH_INTRO_TEST_ID, { includeHiddenElements: true }),
      'layout',
      {
        nativeEvent: { layout: { x: 0, y: 0, width: 1920, height: 1080 } },
      },
    )
    expect(onShown).toHaveBeenCalledTimes(1)

    await act(() => jest.advanceTimersByTime(WHOLE_INTRO_MS))
    expect(queryIntro()).toBeTruthy()

    await view.rerender(<WrenLaunch isReady onShown={onShown} />)
    await act(() => jest.advanceTimersByTime(WHOLE_INTRO_MS))
    expect(queryIntro()).toBeNull()
  })

  it('plays the whole lockup even when Wren is ready at once', async () => {
    await render(<WrenLaunch isReady onShown={jest.fn()} />)
    await act(() => jest.advanceTimersByTime(1000))
    expect(queryIntro()).toBeTruthy()

    // Its shortest time ends, then it fades.
    await act(() => jest.advanceTimersByTime(1000))
    await act(() => jest.advanceTimersByTime(1000))
    expect(queryIntro()).toBeNull()
  })
})
