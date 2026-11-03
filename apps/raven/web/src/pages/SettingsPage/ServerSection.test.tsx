import { afterEach, describe, expect, it } from 'bun:test'
import { serverNameFor } from '@raven/core'
import { cleanup, screen, within } from '@testing-library/react'
import { ServerSection } from '@/pages/SettingsPage/ServerSection'
import { renderWithProviders } from '@/test/render'

afterEach(cleanup)

describe('ServerSection', () => {
  it("names the current server and links its address, this page's own when /api is raven", () => {
    renderWithProviders({ ui: <ServerSection /> })
    const origin = window.location.origin
    const section = screen.getByRole('region', { name: 'Server' })
    expect(within(section).getByText(serverNameFor(origin))).toBeInTheDocument()
    expect(within(section).getByRole('link', { name: origin })).toHaveAttribute('href', origin)
    expect(within(section).getByText(/Switching between servers/)).toBeInTheDocument()
  })
})
