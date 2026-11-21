import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { act, render, screen } from '@testing-library/react-native'

import { TAP_AREA_TEST_ID, TapAreaFlash } from '@/layouts/PlayerMark.touch'
import { useReduceMotion } from '@/stores/reduceMotion'

const initial = useReduceMotion.getInitialState()

// The wash is hidden from assistive technology, which the queries leave out unless asked.
const HIDDEN = { includeHiddenElements: true } as const

describe('TapAreaFlash', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
    useReduceMotion.setState(initial, true)
  })

  it('is gone 0.3 seconds after the tap, on either half', async () => {
    await render(
      <>
        <TapAreaFlash side={-1} />
        <TapAreaFlash side={1} />
      </>,
    )
    expect(screen.getAllByTestId(TAP_AREA_TEST_ID, HIDDEN)).toHaveLength(2)
    await act(async () => jest.advanceTimersByTime(300))
    expect(screen.queryAllByTestId(TAP_AREA_TEST_ID, HIDDEN)).toHaveLength(0)
  })

  it('is gone as soon when the system asks for less motion', async () => {
    useReduceMotion.setState({ isReduced: true })
    await render(<TapAreaFlash side={1} />)
    expect(screen.getByTestId(TAP_AREA_TEST_ID, HIDDEN)).toBeTruthy()
    await act(async () => jest.advanceTimersByTime(300))
    expect(screen.queryByTestId(TAP_AREA_TEST_ID, HIDDEN)).toBeNull()
  })
})
