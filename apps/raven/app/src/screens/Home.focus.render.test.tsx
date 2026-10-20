import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { fireEvent, screen } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'

import { APP_ROUTES } from '@/routes'
import { Home } from '@/screens/Home'
import type { AppServer } from '@/servers/serverList'
import { useActiveServer } from '@/stores/activeServer'
import { useReduceMotion } from '@/stores/reduceMotion'
import { NAS, SPARSE, homeApi } from '@/test/homeServer'
import { NATIVE_EVENTS } from '@/test/nativeEvents'
import { renderScreen } from '@/test/renderScreen'

const mockApi = jest.fn(homeApi)

// The layouts pick their variant once, as they load, so the TV is set before anything does.
jest.mock('react-native/Libraries/Utilities/Platform', () => {
  const platform = jest.requireActual<{ default: object }>(
    'react-native/Libraries/Utilities/Platform',
  )
  Object.defineProperty(platform.default, 'isTV', { get: () => true })
  return platform
})
const mockPush = jest.fn()

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }))
jest.mock('@/servers/serverClient', () => ({
  apiFor: (server: AppServer) => mockApi(server),
  openEventsFor: () => () => ({ addEventListener: () => {}, close: () => {} }),
  cookieJar: { read: async () => ({}), forget: async () => {} },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

const renderHome = async () => renderScreen({ ui: <Home /> })

describe('Home on a TV', () => {
  beforeEach(() => {
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  it('shows the same shelves and cards as the touch layout', async () => {
    await renderHome()
    expect(await screen.findByRole('header', { name: 'Continue watching' })).toBeTruthy()
    expect(screen.getByRole('header', { name: 'Films' })).toBeTruthy()
    expect(screen.getByRole('header', { name: 'Series' })).toBeTruthy()
    const cards = screen.getAllByRole('button').map((card) => card.props.accessibilityLabel)
    expect(cards).toEqual(['Busboys', 'Busboys', 'Night Train', 'Severance'])
  })

  it('puts focus on the first card as it opens, and on no other', async () => {
    await renderHome()
    await screen.findByRole('header', { name: 'Films' })
    const [first, ...rest] = screen.getAllByRole('button')
    if (first === undefined) throw new Error('No card')
    expect(first.props.hasTVPreferredFocus).toBe(true)
    expect(rest.some((card) => card.props.hasTVPreferredFocus === true)).toBe(false)
  })

  it('grows the focused card and rings it, at once when the system asks for less motion', async () => {
    useReduceMotion.setState({ isReduced: true })
    await renderHome()
    await screen.findByRole('header', { name: 'Films' })
    const [first] = screen.getAllByRole('button')
    if (first === undefined) throw new Error('No card')
    const scaleOf = () => {
      const [face] = first.children
      if (typeof face !== 'object' || face === null) throw new Error('No card face')
      return StyleSheet.flatten(face.props.style)?.transform ?? null
    }
    expect(scaleOf()).toEqual([{ scale: 1 }])

    await fireEvent(first, NATIVE_EVENTS.focus)
    expect(scaleOf()).toEqual([{ scale: 1.08 }])

    await fireEvent(first, NATIVE_EVENTS.blur)
    expect(scaleOf()).toEqual([{ scale: 1 }])
  })

  it("lets the remote open a library from its shelf's title", async () => {
    await renderHome()
    await fireEvent.press(await screen.findByRole('link', { name: 'See all in Series' }))
    expect(mockPush).toHaveBeenCalledWith({ pathname: APP_ROUTES.library, params: { id: '2' } })
  })

  it('puts focus on the first card of the first shelf that has one', async () => {
    useActiveServer.setState({ servers: [SPARSE], activeId: SPARSE.id })
    await renderHome()
    await screen.findByRole('header', { name: 'Films' })
    expect(screen.getByRole('header', { name: 'Cartoons' })).toBeTruthy()
    const [first, ...rest] = screen.getAllByRole('button')
    if (first === undefined) throw new Error('No card')
    expect(first.props.accessibilityLabel).toBe('Busboys')
    expect(first.props.hasTVPreferredFocus).toBe(true)
    expect(rest.some((card) => card.props.hasTVPreferredFocus === true)).toBe(false)
  })
})
