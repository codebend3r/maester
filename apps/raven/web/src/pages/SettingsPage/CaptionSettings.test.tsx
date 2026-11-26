import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  CAPTION_COLOURS,
  CAPTION_SIZES,
  type CaptionStyle,
  DEFAULT_CAPTION_STYLE,
} from '@raven/core'
import { usePlayerPrefs } from '@raven/ui/headless'
import { CaptionSettings } from '@/pages/SettingsPage/CaptionSettings'
import { renderWithProviders } from '@/test/render'

const LARGE_YELLOW: CaptionStyle = { size: CAPTION_SIZES.large, colour: CAPTION_COLOURS.yellow }

describe('CaptionSettings', () => {
  beforeEach(() => usePlayerPrefs.setState({ captionStyle: LARGE_YELLOW }))

  afterEach(() => {
    cleanup()
    usePlayerPrefs.setState({ captionStyle: DEFAULT_CAPTION_STYLE })
  })

  const sizes = () => within(screen.getByRole('group', { name: 'Subtitle size' }))
  const colours = () => within(screen.getByRole('group', { name: 'Subtitle colour' }))

  it("offers the four sizes and the four colours, this device's checked", () => {
    renderWithProviders({ ui: <CaptionSettings /> })
    expect(screen.getByRole('region', { name: 'Subtitles' })).toHaveTextContent(
      'How subtitles look on this device, on every video. Each device keeps its own.',
    )
    expect(sizes().getByRole('radio', { name: /^Large(?!st)/ })).toBeChecked()
    expect(colours().getByRole('radio', { name: /^Yellow/ })).toBeChecked()
    expect(sizes().getAllByRole('radio')).toHaveLength(4)
    expect(colours().getAllByRole('radio')).toHaveLength(4)
  })

  it('keeps a pick on this device with the rest of its look', async () => {
    renderWithProviders({ ui: <CaptionSettings /> })
    await userEvent.click(colours().getByRole('radio', { name: /^Cyan/ }))
    const cyan = { ...LARGE_YELLOW, colour: CAPTION_COLOURS.cyan }
    expect(usePlayerPrefs.getState().captionStyle).toEqual(cyan)
    expect(colours().getByRole('radio', { name: /^Cyan/ })).toBeChecked()
    await userEvent.click(sizes().getByRole('radio', { name: /^Small/ }))
    expect(usePlayerPrefs.getState().captionStyle).toEqual({ ...cyan, size: CAPTION_SIZES.small })
  })
})
