import { jest } from '@jest/globals'
import { isRecord } from '@raven/core'
import { act } from '@testing-library/react-native'
import { create } from 'zustand'

import { returnScreen, useScreenFocus } from '@/stores/screenFocus'

/** Whether the screen a render test draws is the one in front, as the navigator would say. */
const useTestScreen = create<{ isFocused: boolean }>()(() => ({ isFocused: true }))

/** The route a render test's screen sits on. */
const TEST_ROUTE = { key: 'test-route-key', name: 'test-route' } as const

/** expo-router's focus hooks, answered for the test's one screen. */
export const navigationFocusMocks = {
  useIsFocused: (): boolean => useTestScreen((state) => state.isFocused),
  useRoute: (): typeof TEST_ROUTE => TEST_ROUTE,
}

const focusRequests = jest.fn<(view: unknown) => void>()

/**
 * `@/layouts/tvFocus` with the fork's native `requestTVFocus` swapped for a record: what
 * matters is which card asks for the focus, and when.
 */
export const tvFocusMocks = { requestTVFocus: (view: unknown) => focusRequests(view) }

/** The views that asked for the remote's focus, in order. */
export const focusRequested = (): unknown[] => focusRequests.mock.calls.map(([view]) => view)

/**
 * The label a view that asked for the focus is read by: its own, or, for a text field's frame,
 * which asks for the field inside it, the field's.
 */
const labelOf = (view: unknown): unknown => {
  if (!isRecord(view) || !isRecord(view.props)) return view
  const { accessibilityLabel, children } = view.props
  if (accessibilityLabel !== undefined) return accessibilityLabel
  return isRecord(children) && isRecord(children.props) ? children.props.accessibilityLabel : view
}

/** The cards and fields that asked for the remote's focus, by label, in order. */
export const askedFor = (): unknown[] => focusRequested().map(labelOf)

/** Another screen goes on top of the test's, as a card or a link opens it. */
export const leaveTestScreen = async (): Promise<void> =>
  act(() => useTestScreen.setState({ isFocused: false }))

/**
 * The screen on top goes back, as Menu or Back takes it, and the test's is in front again, then
 * the transition that reveals it ends, which the navigator tells the screen focus store.
 */
export const returnToTestScreen = async (): Promise<void> => {
  await act(() => useTestScreen.setState({ isFocused: true }))
  await act(() => returnScreen({ screen: TEST_ROUTE.key }))
}

/** The test's screen in front with nothing remembered of its focus, as each test starts. */
export const resetTestScreen = (): void => {
  useTestScreen.setState({ isFocused: true })
  useScreenFocus.setState({ screens: {} })
  focusRequests.mockClear()
}
