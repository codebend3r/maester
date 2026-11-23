import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import {
  type ApiClient,
  ITEM_TYPES,
  REQUEST_STATUSES,
  type TitleRequestAsk,
  type TitleRequests,
  type Upcoming,
  type UpcomingDetails,
} from '@raven/core'
import type * as Native from '@raven/native'
import { fireEvent, screen } from '@testing-library/react-native'

import { COMING_SOON_COPY } from '@/queries/comingSoonCopy'
import { APP_ROUTES, APP_ROUTE_PARAMS } from '@/routes'
import { ComingSoon } from '@/screens/ComingSoon'
import { ComingSoonTitle } from '@/screens/ComingSoonTitle'
import { useActiveServer } from '@/stores/activeServer'
import { NAS, homeApi } from '@/test/homeServer'
import { renderScreen } from '@/test/renderScreen'

const DUNE = {
  type: ITEM_TYPES.movie,
  tmdbId: '693134',
  title: 'Dune: Part Three',
  released: '2026-12-18',
  poster: '/dune.jpg',
} as const

const UPCOMING: Upcoming = { movies: [DUNE], shows: [], documentaries: [] }

const DETAILS: UpcomingDetails = {
  ...DUNE,
  backdrop: null,
  summary: 'Paul walks the golden path.',
  tagline: null,
  genres: ['Science Fiction'],
  runtime: 165,
}

const NO_REQUESTS: TitleRequests = {
  requests: [],
  budget: { limit: 5, left: 3, nextAt: null },
  kinds: { movie: true, show: true },
}

const REQUESTED: TitleRequests = {
  ...NO_REQUESTS,
  requests: [
    {
      type: DUNE.type,
      tmdbId: DUNE.tmdbId,
      title: DUNE.title,
      status: REQUEST_STATUSES.searching,
      requestedAt: '2026-11-20T15:00:00.000Z',
      isMine: true,
    },
  ],
}

let mockRequests: TitleRequests = NO_REQUESTS
const mockAsked = jest.fn<(ask: TitleRequestAsk) => void>()
const mockPush = jest.fn()
const mockBack = jest.fn()
const mockParams = jest.fn((): Record<string, string> => ({}))
const mockApi = jest.fn((): ApiClient => ({
  ...homeApi(NAS),
  getUpcoming: async () => UPCOMING,
  getUpcomingDetails: async () => DETAILS,
  listRequests: async () => mockRequests,
  getRequestHolding: async () => ({ status: null }),
  requestDownload: async (ask) => {
    mockAsked(ask)
    mockRequests = REQUESTED
    const [made] = REQUESTED.requests
    if (made === undefined) throw new Error('no request')
    return made
  },
}))

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
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

describe('Coming soon on a phone or tablet', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRequests = NO_REQUESTS
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  it("shelves what is on its way under the web's headings, and opens a title's own page", async () => {
    await renderScreen({ ui: <ComingSoon /> })
    expect(screen.getByRole('header', { name: COMING_SOON_COPY.title })).toBeTruthy()
    await fireEvent.press(await screen.findByRole('button', { name: DUNE.title }))
    expect(screen.getByText(COMING_SOON_COPY.shelves.movies)).toBeTruthy()
    expect(mockPush).toHaveBeenCalledWith({
      pathname: APP_ROUTES.comingSoonTitle,
      params: { [APP_ROUTE_PARAMS.type]: DUNE.type, [APP_ROUTE_PARAMS.tmdbId]: DUNE.tmdbId },
    })
  })

  it('has a page for the requests still pending and one for those added, and none for everyone’s', async () => {
    mockRequests = REQUESTED
    await renderScreen({ ui: <ComingSoon /> })
    await screen.findByRole('button', { name: DUNE.title })
    expect(
      screen.queryByLabelText(COMING_SOON_COPY.showPage(COMING_SOON_COPY.pages.everyone)),
    ).toBeNull()

    await fireEvent.press(
      screen.getByLabelText(COMING_SOON_COPY.showPage(COMING_SOON_COPY.pages.pending)),
    )
    expect(await screen.findByText(/3 of 5 requests left today/u)).toBeTruthy()
    expect(await screen.findByRole('button', { name: DUNE.title })).toBeTruthy()

    await fireEvent.press(
      screen.getByLabelText(COMING_SOON_COPY.showPage(COMING_SOON_COPY.pages.added)),
    )
    expect(await screen.findByText(COMING_SOON_COPY.requests.none.added)).toBeTruthy()
  })
})

describe("An upcoming title's page on a phone or tablet", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRequests = NO_REQUESTS
    mockParams.mockReturnValue({
      [APP_ROUTE_PARAMS.type]: DUNE.type,
      [APP_ROUTE_PARAMS.tmdbId]: DUNE.tmdbId,
    })
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  it('describes the title and asks for it, then says where the request stands', async () => {
    await renderScreen({ ui: <ComingSoonTitle /> })
    expect(await screen.findByText(DETAILS.summary ?? '')).toBeTruthy()
    expect(await screen.findByText('3 of 5 requests left today')).toBeTruthy()

    await fireEvent.press(
      await screen.findByRole('button', { name: COMING_SOON_COPY.request.request }),
    )
    expect(mockAsked).toHaveBeenCalledWith({ type: DUNE.type, tmdbId: DUNE.tmdbId })
    expect(
      await screen.findByText(new RegExp(`^${COMING_SOON_COPY.statuses.searching.label}: `, 'u')),
    ).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: COMING_SOON_COPY.request.requested })).toBeTruthy()
  })

  it('says so when the address names no title', async () => {
    mockParams.mockReturnValue({ [APP_ROUTE_PARAMS.type]: 'album', [APP_ROUTE_PARAMS.tmdbId]: '1' })
    await renderScreen({ ui: <ComingSoonTitle /> })
    expect(await screen.findByText(COMING_SOON_COPY.notFound)).toBeTruthy()
  })
})
