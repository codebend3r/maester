import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { ApiForProps } from '@raven/native'
import type * as Native from '@raven/native'
import type { AppServer } from '@raven/native/headless'
import { fireEvent, screen } from '@testing-library/react-native'

import { APP_ROUTES } from '@/routes'
import { CONTINUE_WATCHING_COPY } from '@/screens/copy'
import { ContinueWatching } from '@/screens/ContinueWatching'
import { useActiveServer } from '@/stores/activeServer'
import { heldAnswer } from '@/test/heldAnswer'
import { NAS, OTHER, homeApi } from '@/test/homeServer'
import { renderScreen } from '@/test/renderScreen'

const HOME_FAILURE = 'The server is resting.'

/** What Home's read waits on before it is answered, and whether it fails. */
const mockHome = { answer: Promise.resolve(), isFailing: false }
const mockPush = jest.fn()
const mockBack = jest.fn()
const mockApi = jest.fn((server: AppServer) => {
  const api = homeApi(server)
  return {
    ...api,
    getHome: async () => {
      await mockHome.answer
      if (mockHome.isFailing) throw new Error(HOME_FAILURE)
      return api.getHome()
    },
  }
})

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: mockBack }) }))
jest.mock('@raven/native', () => ({
  ...jest.requireActual<typeof Native>('@raven/native'),
  apiFor: ({ server }: ApiForProps) => mockApi(server),
  openEventsFor: () => () => ({ addEventListener: () => {}, close: () => {} }),
  cookieJar: { read: async () => ({}), forget: async () => {} },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

describe('Continue watching on a phone or tablet', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockHome.answer = Promise.resolve()
    mockHome.isFailing = false
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  it('lists every video in progress as a card under its title', async () => {
    await renderScreen({ ui: <ContinueWatching /> })
    expect(await screen.findByRole('button', { name: 'Busboys' })).toBeTruthy()
    expect(screen.getByRole('header', { name: 'Continue watching' })).toBeTruthy()
    expect(screen.getByText('1 video in progress')).toBeTruthy()
  })

  it('shows the mark while Home is read', async () => {
    const { answer, release } = heldAnswer()
    mockHome.answer = answer
    await renderScreen({ ui: <ContinueWatching /> })
    expect(await screen.findByLabelText(CONTINUE_WATCHING_COPY.gathering)).toBeTruthy()
    release()
    expect(await screen.findByRole('button', { name: 'Busboys' })).toBeTruthy()
  })

  it('opens the page of the card pressed', async () => {
    await renderScreen({ ui: <ContinueWatching /> })
    await fireEvent.press(await screen.findByRole('button', { name: 'Busboys' }))
    expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ pathname: APP_ROUTES.item }))
  })

  it('says so when nothing is in progress', async () => {
    useActiveServer.setState({ servers: [OTHER], activeId: OTHER.id })
    await renderScreen({ ui: <ContinueWatching /> })
    expect(await screen.findByText(CONTINUE_WATCHING_COPY.none)).toBeTruthy()
  })

  it('says what the server said when it cannot read Home', async () => {
    mockHome.isFailing = true
    await renderScreen({ ui: <ContinueWatching /> })
    expect(await screen.findByText(HOME_FAILURE)).toBeTruthy()
  })
})
