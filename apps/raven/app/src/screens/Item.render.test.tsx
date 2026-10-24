import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { APP_CALL_METHODS, APP_CLIENT_CALLS, WATCH_TARGET_KINDS } from '@raven/core'
import { fireEvent, screen } from '@testing-library/react-native'

import { APP_ROUTES, APP_ROUTE_PARAMS } from '@/routes'
import { Item } from '@/screens/Item'
import type { AppServer } from '@/servers/serverList'
import { useActiveServer } from '@/stores/activeServer'
import { type HeardRequest, pathFor } from '@/test/fixtureFetch'
import { NAS, SERIES } from '@/test/homeServer'
import {
  BUSBOYS,
  BUSBOYS_FILE,
  GOOD_NEWS_ABOUT_HELL,
  SEVERANCE,
  SEVERANCE_ONE,
  itemApi,
} from '@/test/itemServer'
import { heldAnswer } from '@/test/heldAnswer'
import { createScreenClient, renderScreen, untilIdle } from '@/test/renderScreen'

const mockPush = jest.fn()
const mockParams = jest.fn((): Record<string, string> => ({
  [APP_ROUTE_PARAMS.id]: String(BUSBOYS.id),
}))
/** What the server heard, and the answers its writes and reads wait on, per test. */
const mockServer: {
  heard: HeardRequest[]
  writes: () => Promise<void>
  reads: (path: string) => Promise<void>
} = {
  heard: [],
  writes: async () => undefined,
  reads: async () => undefined,
}
const mockApi = jest.fn((_server: AppServer) =>
  itemApi({
    hear: (request) => {
      mockServer.heard = [...mockServer.heard, request]
    },
    writes: () => mockServer.writes(),
    reads: (path) => mockServer.reads(path),
  }),
)

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => mockParams(),
}))
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

const { setWatched, setItemFavourite } = APP_CLIENT_CALLS

/** The client this test's screen reads through. */
const shown = { client: createScreenClient() }

const renderItem = async (params: Record<string, string>) => {
  mockParams.mockReturnValue(params)
  shown.client = createScreenClient()
  return renderScreen({ ui: <Item />, client: shown.client })
}

/** The writes the server heard, without its reads. */
const writes = (): HeardRequest[] =>
  mockServer.heard.filter(({ method }) => method !== APP_CALL_METHODS.get)

describe('Item on a phone or tablet', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockServer.heard = []
    mockServer.writes = async () => undefined
    mockServer.reads = async () => undefined
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  // What the page still reads, such as a season's show, lands before the test ends.
  afterEach(() => untilIdle(shown.client))

  it('shows a half-watched movie with Resume and the time left', async () => {
    await renderItem({ [APP_ROUTE_PARAMS.id]: String(BUSBOYS.id) })

    expect(await screen.findByRole('header', { name: 'Busboys' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Resume from 50:00' })).toBeTruthy()
    expect(screen.getByText('50 min left')).toBeTruthy()
    expect(screen.getByText('Directed by Mark Kimball')).toBeTruthy()
    expect(
      screen.getByText('Two busboys at a downtown steakhouse plan one last perfect shift.'),
    ).toBeTruthy()
    expect(screen.getByText('Rudy / Director')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull()
  })

  it('plays the file Play starts', async () => {
    await renderItem({ [APP_ROUTE_PARAMS.id]: String(BUSBOYS.id) })
    await fireEvent.press(await screen.findByRole('button', { name: 'Resume from 50:00' }))
    expect(mockPush).toHaveBeenCalledWith({
      pathname: APP_ROUTES.play,
      params: {
        [APP_ROUTE_PARAMS.mediaId]: String(BUSBOYS_FILE.id),
        [APP_ROUTE_PARAMS.at]: String(BUSBOYS_FILE.position),
      },
    })
  })

  it('marks the movie watched, flipping the button before the server answers', async () => {
    const { answer, release } = heldAnswer()
    mockServer.writes = () => answer
    await renderItem({ [APP_ROUTE_PARAMS.id]: String(BUSBOYS.id) })

    await fireEvent.press(
      await screen.findByRole('checkbox', { name: 'Mark watched', checked: false }),
    )

    expect(await screen.findByRole('checkbox', { name: 'Watched', checked: true })).toBeTruthy()
    // Marking clears the resume spot, so Play starts from the top again.
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy()
    expect(writes()).toEqual([
      {
        method: APP_CALL_METHODS.put,
        path: setWatched.path,
        body: { watched: true, targets: [{ kind: WATCH_TARGET_KINDS.media, id: BUSBOYS_FILE.id }] },
      },
    ])
    release()
  })

  it("lists a show's seasons, each opening its page, and plays the next episode", async () => {
    await renderItem({ [APP_ROUTE_PARAMS.id]: String(SEVERANCE.id) })

    expect(await screen.findByRole('header', { name: 'Severance' })).toBeTruthy()
    expect(screen.getByRole('header', { name: 'Seasons' })).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Play S01E01' })).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'Season 2' }))
    expect(mockPush).toHaveBeenCalledWith({
      pathname: APP_ROUTES.item,
      params: { [APP_ROUTE_PARAMS.id]: '7' },
    })
  })

  it("offers a show's marks while its next episode is read, and Play once it is, as the web does", async () => {
    const next = heldAnswer()
    const nextPath = pathFor({ path: APP_CLIENT_CALLS.nextEpisode.path, id: SEVERANCE.id })
    mockServer.reads = (path) => (path === nextPath ? next.answer : Promise.resolve())
    await renderItem({ [APP_ROUTE_PARAMS.id]: String(SEVERANCE.id) })

    expect(await screen.findByRole('checkbox', { name: 'Favourite', checked: false })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Mark watched' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Play S01E01' })).toBeNull()

    next.release()
    expect(await screen.findByRole('button', { name: 'Play S01E01' })).toBeTruthy()
  })

  it('marks a show a favourite, showing it before the server answers', async () => {
    const { answer, release } = heldAnswer()
    mockServer.writes = () => answer
    await renderItem({ [APP_ROUTE_PARAMS.id]: String(SEVERANCE.id) })

    await fireEvent.press(
      await screen.findByRole('checkbox', { name: 'Favourite', checked: false }),
    )

    expect(await screen.findByRole('checkbox', { name: 'Favourite', checked: true })).toBeTruthy()
    expect(writes()).toEqual([
      {
        method: APP_CALL_METHODS.put,
        path: pathFor({ path: setItemFavourite.path, id: SEVERANCE.id }),
        body: { favourite: true },
      },
    ])
    release()
  })

  it("lists a season's episodes, each opening its page in its library", async () => {
    await renderItem({ [APP_ROUTE_PARAMS.id]: String(SEVERANCE_ONE.id) })

    expect(await screen.findByRole('header', { name: 'Season 1' })).toBeTruthy()
    expect(screen.getByText('Severance')).toBeTruthy()
    expect(screen.getByRole('header', { name: 'Episodes' })).toBeTruthy()
    // Each row is read out with its line, and whether it is watched.
    expect(screen.getByRole('button', { name: /^E2 · Half Loop, .+ · 55m$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Play S01E01' })).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: /^E1 · Good News About Hell, / }))
    expect(mockPush).toHaveBeenCalledWith({
      pathname: APP_ROUTES.item,
      params: {
        [APP_ROUTE_PARAMS.id]: String(GOOD_NEWS_ABOUT_HELL.id),
        [APP_ROUTE_PARAMS.library]: String(SERIES.id),
      },
    })
  })

  it('names an episode by its show, season and number', async () => {
    await renderItem({ [APP_ROUTE_PARAMS.id]: String(GOOD_NEWS_ABOUT_HELL.id) })

    expect(await screen.findByRole('header', { name: 'Good News About Hell' })).toBeTruthy()
    expect(screen.getByText('Severance · Season 1 · Episode 1')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy()
  })

  it('says a title is not there for an address that names none, and asks nothing', async () => {
    await renderItem({ [APP_ROUTE_PARAMS.id]: '1e3' })

    expect(await screen.findByText('This title is not on the server.')).toBeTruthy()
    expect(mockServer.heard.map(({ path }) => path)).not.toContain(
      pathFor({ path: APP_CLIENT_CALLS.getItem.path, id: 1000 }),
    )
  })

  it('says a title the server does not have is not there', async () => {
    await renderItem({ [APP_ROUTE_PARAMS.id]: '999' })
    expect(await screen.findByText('This title is not on the server.')).toBeTruthy()
  })
})
