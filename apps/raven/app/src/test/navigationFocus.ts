import { act } from '@testing-library/react-native'
import { create } from 'zustand'

/** Whether the screen a render test draws is the one in front, as the navigator would say. */
const useTestScreen = create<{ isFocused: boolean }>()(() => ({ isFocused: true }))

/** The route a render test's screen sits on. */
const TEST_ROUTE = { key: 'test-route-key', name: 'test-route' } as const

/** expo-router's focus hooks, answered for the test's one screen. */
export const navigationFocusMocks = {
  useIsFocused: (): boolean => useTestScreen((state) => state.isFocused),
  useRoute: (): typeof TEST_ROUTE => TEST_ROUTE,
}

/** Another screen goes on top of the test's, as a card or a link opens it. */
export const leaveTestScreen = async (): Promise<void> =>
  act(() => useTestScreen.setState({ isFocused: false }))

/** The screen on top goes back, as Menu or Back takes it, and the test's is in front again. */
export const returnToTestScreen = async (): Promise<void> =>
  act(() => useTestScreen.setState({ isFocused: true }))

/** The test's screen in front, as each test starts. */
export const resetTestScreen = (): void => useTestScreen.setState({ isFocused: true })
