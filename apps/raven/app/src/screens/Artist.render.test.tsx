import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { HTTP_METHODS, APP_CLIENT_CALLS, MUSIC_LINK_COPY } from '@raven/core'
import type * as Native from '@raven/native'
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native'
import { type HeardRequest, pathWithId } from '@raven/native/testing'

import { CARD_MENU_COPY } from '@/cardMenu/menuOptions'
import { APP_ROUTE_PARAMS, ROUTE_TARGETS, hrefOf } from '@/routes'
import { answerSheetShown } from '@/test/actionSheet'
import { NATIVE_EVENTS } from '@/test/nativeEvents'
import { Artist } from '@/screens/Artist'
import { useActiveServer } from '@/stores/activeServer'
import { heldAnswer } from '@/test/heldAnswer'
import { NAS } from '@/test/homeServer'
import { OK_COMPUTER, RADIOHEAD, musicApi } from '@/test/musicServer'
import { createScreenClient, renderScreen, untilIdle } from '@/test/renderScreen'

const mockParams = jest.fn((): Record<string, string> => ({
  [APP_ROUTE_PARAMS.id]: String(RADIOHEAD.id),
}))
const mockHeard: HeardRequest[] = []
const mockServer = { writes: async (): Promise<void> => undefined }
const mockApi = jest.fn(() =>
  musicApi({ hear: (request) => mockHeard.push(request), writes: () => mockServer.writes() }),
)

const mockPush = jest.fn()

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => mockParams(),
}))
jest.mock('@raven/native', () => ({
  ...jest.requireActual<typeof Native>('@raven/native'),
  apiFor: () => mockApi(),
  openEventsFor: () => () => ({ addEventListener: () => {}, close: () => {} }),
  cookieJar: { read: async () => ({}), forget: async () => {} },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

/** The client this test's screen reads through. */
const shown = { client: createScreenClient() }

describe('Artist', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockHeard.splice(0)
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  afterEach(async () => {
    await untilIdle(shown.client)
  })

  it('shows their albums, and marks the artist a favourite before the server answers', async () => {
    const { answer, release } = heldAnswer()
    mockServer.writes = () => answer
    shown.client = createScreenClient()
    await renderScreen({ ui: <Artist />, client: shown.client })
    expect(await screen.findByText(OK_COMPUTER.title)).toBeTruthy()
    const favourite = screen.getByRole('button', { name: 'Favourite' })
    // The toolbar's mark is its heart alone: no words, though it is still said as Favourite.
    expect(within(favourite).queryAllByText(/./)).toEqual([])

    await fireEvent.press(favourite)
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Favourite' }).props.accessibilityState,
      ).toMatchObject({ selected: true }),
    )
    expect(mockHeard.filter(({ method }) => method !== HTTP_METHODS.get)).toEqual([
      {
        method: HTTP_METHODS.put,
        path: pathWithId({ path: APP_CLIENT_CALLS.setArtistFavourite.path, id: RADIOHEAD.id }),
        body: { favourite: true },
      },
    ])
    release()
  })

  it("opens a held album card's facts beside its favourite, and goes to the album", async () => {
    const sheets = answerSheetShown({ answer: MUSIC_LINK_COPY.goToAlbum })
    shown.client = createScreenClient()
    await renderScreen({ ui: <Artist />, client: shown.client })
    await fireEvent(
      await screen.findByRole('button', { name: OK_COMPUTER.title }),
      NATIVE_EVENTS.longPress,
    )
    await waitFor(() => expect(sheets).toHaveLength(1))
    expect(sheets[0]?.options).toEqual([
      CARD_MENU_COPY.addFavourite,
      MUSIC_LINK_COPY.goToAlbum,
      MUSIC_LINK_COPY.goToArtist,
      'Cancel',
    ])
    expect(sheets[0]?.message ?? '').toContain('Released: 1997')
    expect(mockPush).toHaveBeenCalledWith(
      hrefOf({ kind: ROUTE_TARGETS.album, albumId: OK_COMPUTER.id }),
    )
  })
})
