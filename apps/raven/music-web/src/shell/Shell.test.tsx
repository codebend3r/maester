import { describe, expect, it } from 'bun:test'
import { artistNames } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import {
  HOME_COPY,
  LIBRARY_LABELS,
  LIBRARY_PAGE_COPY,
  PLAYER_COPY,
  SEARCH_COPY,
  SETTINGS_COPY,
  SHARED_ORDER,
  STATUS_COPY,
  TAB_COPY,
  WREN_LOCKUP_COPY,
} from '@raven/wren'
import { act, cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/AppRoutes'
import { COLLECTION_KINDS, WREN_ROUTES, albumPath, collectionPath } from '@/routes'
import { AIRBAG, OK_COMPUTER, mockMusicApi } from '@/test/music'
import { renderWithProviders } from '@/test/render'
import { atFormFactor } from '@/test/viewport'
import { FORM_FACTORS, type FormFactor } from '@/theme/formFactor'

const TABS: readonly string[] = [
  HOME_COPY.title,
  LIBRARY_PAGE_COPY.title,
  SEARCH_COPY.title,
  SETTINGS_COPY.title,
]

const tabName = (label: string): string =>
  TAB_COPY.label({ label, at: TABS.indexOf(label), count: TABS.length })

const OPEN_PLAYER = PLAYER_COPY.open({ title: AIRBAG.title, artists: artistNames(AIRBAG) })

const queueTrack = () => act(() => useAudioQueue.getState().playTracks({ tracks: [AIRBAG] }))

type RenderShellProps = { route: string; formFactor: FormFactor; isPlaying?: boolean }

/** The app at `route` in a window as wide as `formFactor`'s layout, with a track queued or none. */
const renderShell = async ({ route, formFactor, isPlaying = false }: RenderShellProps) => {
  if (isPlaying) queueTrack()
  renderWithProviders({ ui: <AppRoutes />, route, formFactor })
  await screen.findByRole('heading', { level: 1 })
}

const tabBar = () => screen.queryByRole('link', { name: tabName(HOME_COPY.title) })
// The lockup inside the navigation: the narrow layout's Home draws one of its own above the page.
const sidebar = () =>
  screen
    .queryAllByRole('navigation')
    .flatMap((nav) => within(nav).queryAllByRole('img', { name: WREN_LOCKUP_COPY.name }))
    .at(0) ?? null
const openPlayer = () => screen.queryByRole('button', { name: OPEN_PLAYER })
const scrubber = () => screen.queryByRole('slider', { name: PLAYER_COPY.position })

describe("the shell under 48rem, the apps' phone layout", () => {
  it('sets the four tabs on the bar, the one showing marked, with no sidebar', async () => {
    await renderShell({ route: WREN_ROUTES.library, formFactor: FORM_FACTORS.phone })

    // The bar's own links: Library's rows under it are links too.
    const bar = within(screen.getByRole('navigation'))
    const links = bar.getAllByRole('link')
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual(TABS.map(tabName))
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      WREN_ROUTES.home,
      WREN_ROUTES.library,
      WREN_ROUTES.search,
      WREN_ROUTES.settings,
    ])
    expect(bar.getByRole('link', { current: 'page' })).toHaveAccessibleName(
      tabName(LIBRARY_PAGE_COPY.title),
    )
    expect(sidebar()).toBeNull()
  })

  it('shows no player until a track is queued', async () => {
    await renderShell({ route: WREN_ROUTES.home, formFactor: FORM_FACTORS.phone })

    expect(openPlayer()).toBeNull()
  })

  it('floats the mini player over the tab bar while a track is queued, with no player bar', async () => {
    await renderShell({ route: WREN_ROUTES.home, formFactor: FORM_FACTORS.phone, isPlaying: true })

    expect(openPlayer()).toBeInTheDocument()
    expect(tabBar()).toBeInTheDocument()
    expect(scrubber()).toBeNull()
  })

  it('keeps the mini player, without the tab bar, on a page opened from a tab', async () => {
    const music = mockMusicApi()
    try {
      await renderShell({
        route: albumPath(OK_COMPUTER.id),
        formFactor: FORM_FACTORS.phone,
        isPlaying: true,
      })

      expect(openPlayer()).toBeInTheDocument()
      expect(tabBar()).toBeNull()
    } finally {
      // The page is unmounted before its api is the real one again.
      cleanup()
      music.restore()
    }
  })

  it('draws Now Playing alone', async () => {
    await renderShell({
      route: WREN_ROUTES.nowPlaying,
      formFactor: FORM_FACTORS.phone,
      isPlaying: true,
    })

    expect(openPlayer()).toBeNull()
    expect(tabBar()).toBeNull()
  })

  it('opens Now Playing from the mini player, and moves between tabs from the bar', async () => {
    const user = userEvent.setup()
    await renderShell({ route: WREN_ROUTES.home, formFactor: FORM_FACTORS.phone, isPlaying: true })

    await user.click(screen.getByRole('link', { name: tabName(SEARCH_COPY.title) }))
    expect(
      await screen.findByRole('heading', { level: 1, name: SEARCH_COPY.title }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: OPEN_PLAYER }))
    expect(await screen.findByRole('heading', { level: 1, name: AIRBAG.title })).toBeInTheDocument()
  })
})

describe("the shell at 48rem and wider, the apps' tablet layout", () => {
  it("lists the sidebar's places, Library's without Downloads, over the server's status", async () => {
    await renderShell({
      route: collectionPath(COLLECTION_KINDS.albums),
      formFactor: FORM_FACTORS.tablet,
    })

    const nav = within(screen.getByRole('navigation'))
    expect(nav.getAllByRole('link').map((link) => link.getAttribute('aria-label'))).toEqual([
      HOME_COPY.title,
      SEARCH_COPY.title,
      ...SHARED_ORDER.map((segment) => LIBRARY_LABELS[segment]),
      SETTINGS_COPY.title,
    ])
    expect(nav.getByRole('heading', { name: LIBRARY_PAGE_COPY.title })).toBeInTheDocument()
    expect(nav.getByRole('link', { current: 'page' })).toHaveAccessibleName(
      LIBRARY_PAGE_COPY.albums,
    )
    expect(nav.queryByText(LIBRARY_PAGE_COPY.downloads)).toBeNull()
    expect(nav.getByText(STATUS_COPY.connected(STATUS_COPY.raven))).toBeInTheDocument()
    expect(sidebar()).toBeInTheDocument()
    expect(tabBar()).toBeNull()
  })

  it('shows no player bar until a track is queued', async () => {
    await renderShell({ route: WREN_ROUTES.home, formFactor: FORM_FACTORS.tablet })

    expect(openPlayer()).toBeNull()
    expect(scrubber()).toBeNull()
  })

  it('sets the player bar along the foot while a track is queued: what plays, the transport, the scrubber, Lyrics, Up next and the volume behind its speaker', async () => {
    await renderShell({ route: WREN_ROUTES.home, formFactor: FORM_FACTORS.tablet, isPlaying: true })

    expect(openPlayer()).toBeInTheDocument()
    expect(screen.getByText(`${artistNames(AIRBAG)} · ${AIRBAG.album.title}`)).toBeInTheDocument()
    expect(scrubber()).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: PLAYER_COPY.shuffle })).toBeNull()
    expect(screen.getByRole('button', { name: PLAYER_COPY.previous })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: PLAYER_COPY.next })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: PLAYER_COPY.lyrics })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: PLAYER_COPY.upNext })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: PLAYER_COPY.mute })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: PLAYER_COPY.volume })).toBeInTheDocument()
  })

  it('draws Now Playing alone, without the sidebar or the player bar', async () => {
    await renderShell({
      route: WREN_ROUTES.nowPlaying,
      formFactor: FORM_FACTORS.tablet,
      isPlaying: true,
    })

    expect(screen.queryByRole('navigation')).toBeNull()
    expect(openPlayer()).toBeNull()
  })

  it('opens Now Playing from the player bar', async () => {
    const user = userEvent.setup()
    await renderShell({ route: WREN_ROUTES.home, formFactor: FORM_FACTORS.tablet, isPlaying: true })

    await user.click(screen.getByRole('button', { name: PLAYER_COPY.lyrics }))

    expect(await screen.findByRole('heading', { level: 1, name: AIRBAG.title })).toBeInTheDocument()
  })

  it('trades the sidebar and player bar for the tab bar and mini player as the window narrows', async () => {
    await renderShell({ route: WREN_ROUTES.home, formFactor: FORM_FACTORS.tablet, isPlaying: true })
    expect(sidebar()).toBeInTheDocument()

    atFormFactor(FORM_FACTORS.phone)

    expect(sidebar()).toBeNull()
    expect(scrubber()).toBeNull()
    expect(tabBar()).toBeInTheDocument()
    expect(openPlayer()).toBeInTheDocument()
  })
})

describe('the Space key', () => {
  it('plays and pauses the queue from the page, and leaves a focused link its own press', async () => {
    await renderShell({
      route: WREN_ROUTES.library,
      formFactor: FORM_FACTORS.tablet,
      isPlaying: true,
    })
    const real = useAudioQueue.getState().toggle
    let presses = 0
    act(() =>
      useAudioQueue.setState({
        toggle: () => {
          presses += 1
        },
      }),
    )
    await userEvent.keyboard(' ')
    expect(presses).toBe(1)
    act(() => screen.getByRole('link', { name: HOME_COPY.title }).focus())
    await userEvent.keyboard(' ')
    expect(presses).toBe(1)
    act(() => useAudioQueue.setState({ toggle: real }))
  })
})
