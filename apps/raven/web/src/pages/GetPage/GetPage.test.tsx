import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { AppRoutes } from '@/AppRoutes'
import { GetPage } from '@/pages/GetPage/GetPage'
import { renderWithProviders } from '@/test/render'

const LATEST = 'https://github.com/codebend3r/maester/releases/latest'
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

const renderGet = (route = '/get') =>
  renderWithProviders(
    <Routes>
      <Route path="/get" element={<GetPage />} />
      <Route path="/" element={<p>home</p>} />
      <Route path="/libraries" element={<p>libraries</p>} />
    </Routes>,
    { route },
  )

/** Pretends to be another browser until the test is done. */
const browseWith = (userAgent: string) =>
  Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true })

const card = (name: string) => screen.getByRole('article', { name })

describe('GetPage', () => {
  afterEach(() => {
    cleanup()
    Reflect.deleteProperty(window.navigator, 'userAgent')
  })

  it("offers the browser's own system first, its card outlined", () => {
    renderGet()

    expect(screen.getByRole('link', { name: 'Download for Linux' })).toHaveAttribute('href', LATEST)
    expect(screen.getByText(/AppImage and \.deb · x86-64/)).toBeInTheDocument()
    expect(within(card('Linux')).getByText('Your system')).toBeInTheDocument()
    expect(within(card('macOS')).queryByText('Your system')).toBeNull()
    const [first, second] = within(card('Linux')).getAllByRole('link')
    expect(first).toHaveAccessibleName('Linux, AppImage .AppImage')
    expect(first?.className).toMatch(/_primary_/)
    expect(second?.className).toMatch(/_quiet_/)
  })

  it('offers the system ?os= names instead, to try each', () => {
    renderGet('/get?os=windows')

    expect(screen.getByRole('link', { name: 'Download for Windows' })).toBeInTheDocument()
    expect(screen.getByText(/Windows 10 or later · 64-bit/)).toBeInTheDocument()
    expect(within(card('Windows')).getByText('Your system')).toBeInTheDocument()
    expect(within(card('Linux')).queryByText('Your system')).toBeNull()
    expect(within(card('Windows')).getAllByRole('link')[0]?.className).toMatch(/_primary_/)
    expect(within(card('Linux')).getAllByRole('link')[0]?.className).toMatch(/_quiet_/)
  })

  it('reads the system off the browser when ?os= names none', () => {
    browseWith(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    )
    renderGet('/get?os=amiga')

    expect(screen.getByRole('link', { name: 'Download for macOS' })).toBeInTheDocument()
    expect(within(card('macOS')).getByText('Your system')).toBeInTheDocument()
  })

  it('offers a plain Download to a phone, no card outlined', () => {
    browseWith(IPHONE)
    renderGet()

    const hero = screen.getByRole('region', { name: 'Your films and shows, from your own server.' })
    expect(within(hero).getByRole('link', { name: 'Download' })).toHaveAttribute('href', LATEST)
    expect(within(hero).getByRole('link', { name: 'Choose yours' })).toHaveAttribute(
      'href',
      '#download',
    )
    expect(screen.queryByText('Your system')).toBeNull()
  })

  it('points every download at the newest release, saying what each file is', () => {
    renderGet('/get?os=mac')
    const files = ['macOS', 'Windows', 'Linux'].flatMap((name) =>
      within(card(name)).getAllByRole('link'),
    )

    expect(files.map((file) => file.textContent)).toEqual([
      'macOS, Apple silicon.dmg',
      'macOS, Intel.dmg',
      'Windows, Installer.exe',
      'Windows, Portable.zip',
      'Linux, AppImage.AppImage',
      'Linux, Debian, Ubuntu.deb',
    ])
    expect(files.every((file) => file.getAttribute('href') === LATEST)).toBe(true)
  })

  it('jumps to the downloads from the header and the hero', () => {
    renderGet('/get?os=mac')
    const header = screen.getByRole('navigation', { name: 'Get raven' })

    expect(within(header).getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      '#download',
    )
    expect(screen.getByRole('link', { name: 'Other platforms' })).toHaveAttribute(
      'href',
      '#download',
    )
    expect(screen.getByRole('region', { name: 'Get raven' })).toHaveAttribute('id', 'download')
    expect(within(header).getByRole('link', { name: 'Open web app' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Open in your browser' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('button', { name: 'Theme' })).toBeInTheDocument()
  })

  it('opens the web app at the server typed in', async () => {
    const user = userEvent.setup()
    renderGet()
    const web = card('In the browser')
    const field = within(web).getByLabelText('Your server')
    const open = within(web).getByRole('link', { name: 'Open web app' })

    expect(field).toHaveValue('http://localhost:8484')
    expect(open).toHaveAttribute('href', 'http://localhost:8484/')

    await user.clear(field)
    await user.type(field, 'raven.home:8096')
    expect(open).toHaveAttribute('href', 'http://raven.home:8096/')
  })

  it('goes there on Enter in the field', async () => {
    const user = userEvent.setup()
    renderGet()
    const field = within(card('In the browser')).getByLabelText('Your server')
    await user.clear(field)
    await user.type(field, 'http://localhost:8484/libraries{Enter}')

    expect(await screen.findByText('libraries')).toBeInTheDocument()
  })

  it('links the source, the releases and the web app at its foot', () => {
    renderGet()
    const footer = screen.getByRole('contentinfo')

    expect(within(footer).getByRole('link', { name: 'Source on GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/codebend3r/maester',
    )
    expect(within(footer).getByRole('link', { name: 'Release notes' })).toHaveAttribute(
      'href',
      'https://github.com/codebend3r/maester/releases',
    )
    expect(within(footer).getByRole('link', { name: 'Open web app' })).toHaveAttribute('href', '/')
  })

  it('takes the whole screen at /get, outside the side menu', () => {
    renderWithProviders(<AppRoutes />, { route: '/get' })

    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Your films and shows, from your own server.',
      }),
    ).toBeInTheDocument()
  })
})
