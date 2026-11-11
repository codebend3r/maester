import { afterAll, afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  CAPTION_COLOURS,
  CAPTION_SIZES,
  type CaptionStyle,
  DEFAULT_CAPTION_STYLE,
} from '@raven/core'
import { usePlayerPrefs } from '@raven/ui/headless'
import { api } from '@/lib/api'
import { CaptionSettings } from '@/pages/SettingsPage/CaptionSettings'
import { renderWithProviders } from '@/test/render'

const LARGE_YELLOW: CaptionStyle = { size: CAPTION_SIZES.large, colour: CAPTION_COLOURS.yellow }

describe('CaptionSettings', () => {
  const spies = { get: spyOn(api, 'getCaptionStyle'), set: spyOn(api, 'setCaptionStyle') }

  // The server keeps the account's look, and what the page saves; this device starts with none.
  beforeEach(() => {
    usePlayerPrefs.setState({ captionStyle: DEFAULT_CAPTION_STYLE })
    const server = { style: LARGE_YELLOW }
    spies.get.mockImplementation(async () => server.style)
    spies.set.mockImplementation(async (style) => {
      server.style = style
      return style
    })
  })

  afterEach(() => Object.values(spies).forEach((spy) => spy.mockReset()))

  // The client is the app's one, so the next file gets it back as it was.
  afterAll(() => Object.values(spies).forEach((spy) => spy.mockRestore()))

  const sizes = () => within(screen.getByRole('group', { name: 'Subtitle size' }))
  const colours = () => within(screen.getByRole('group', { name: 'Subtitle colour' }))

  it("offers the four sizes and the four colours, the account's checked", async () => {
    renderWithProviders({ ui: <CaptionSettings /> })
    expect(screen.getByRole('region', { name: 'Subtitles' })).toHaveTextContent(
      'How subtitles look for this account, on every video and on every device it is signed in on.',
    )
    await waitFor(() => expect(sizes().getByRole('radio', { name: /^Large(?!st)/ })).toBeChecked())
    expect(colours().getByRole('radio', { name: /^Yellow/ })).toBeChecked()
    expect(sizes().getAllByRole('radio')).toHaveLength(4)
    expect(colours().getAllByRole('radio')).toHaveLength(4)
  })

  it('saves a pick to the account with the rest of its look, and keeps it on this device', async () => {
    renderWithProviders({ ui: <CaptionSettings /> })
    await waitFor(() => expect(sizes().getByRole('radio', { name: /^Large(?!st)/ })).toBeChecked())
    await userEvent.click(colours().getByRole('radio', { name: /^Cyan/ }))
    const cyan = { ...LARGE_YELLOW, colour: CAPTION_COLOURS.cyan }
    await waitFor(() => expect(spies.set).toHaveBeenCalledWith(cyan))
    await waitFor(() => expect(colours().getByRole('radio', { name: /^Cyan/ })).toBeChecked())
    await userEvent.click(sizes().getByRole('radio', { name: /^Small/ }))
    const smallCyan = { ...cyan, size: CAPTION_SIZES.small }
    await waitFor(() => expect(spies.set).toHaveBeenLastCalledWith(smallCyan))
    await waitFor(() => expect(usePlayerPrefs.getState().captionStyle).toEqual(smallCyan))
  })

  it('puts the pick back when the server refuses it', async () => {
    spies.set.mockImplementation(async () => {
      throw new Error('The server is away.')
    })
    renderWithProviders({ ui: <CaptionSettings /> })
    await waitFor(() => expect(sizes().getByRole('radio', { name: /^Large(?!st)/ })).toBeChecked())
    await userEvent.click(sizes().getByRole('radio', { name: /^Largest/ }))
    await waitFor(() => expect(spies.set).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(sizes().getByRole('radio', { name: /^Large(?!st)/ })).toBeChecked())
  })
})
