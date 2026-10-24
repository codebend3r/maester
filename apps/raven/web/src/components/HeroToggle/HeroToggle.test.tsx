import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { HeroPicks } from '@raven/core'
import { HeroToggle } from '@/components/HeroToggle/HeroToggle'
import { api } from '@/lib/api'
import { held } from '@/test/held'
import { renderWithProviders } from '@/test/render'

describe('HeroToggle', () => {
  const spies = { picks: spyOn(api, 'getHeroPicks'), set: spyOn(api, 'setHeroPick') }

  const open = (picks: HeroPicks) => {
    spies.picks.mockImplementation(async () => picks)
    renderWithProviders({ ui: <HeroToggle itemId={7} /> })
  }

  afterEach(() => {
    cleanup()
    spies.picks.mockReset()
    spies.set.mockReset()
  })

  it('shows nothing until the picks are read', () => {
    spies.picks.mockImplementation(() => held<HeroPicks>().promise)
    renderWithProviders({ ui: <HeroToggle itemId={7} /> })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('adds a title that is not in the hero, and says so once it is', async () => {
    spies.set.mockImplementation(async () => ({ itemIds: [7], limit: 10 }))
    open({ itemIds: [], limit: 10 })
    const button = await screen.findByRole('button', { name: 'Add to hero' })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    spies.picks.mockImplementation(async () => ({ itemIds: [7], limit: 10 }))
    await userEvent.click(button)
    expect(spies.set).toHaveBeenCalledWith({ itemId: 7, isShown: true })
    expect(await screen.findByRole('button', { name: 'In hero' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('takes a title out of the hero', async () => {
    spies.set.mockImplementation(async () => ({ itemIds: [], limit: 10 }))
    open({ itemIds: [3, 7], limit: 10 })
    await userEvent.click(await screen.findByRole('button', { name: 'In hero' }))
    await waitFor(() => expect(spies.set).toHaveBeenCalledWith({ itemId: 7, isShown: false }))
  })

  it('holds a title back while the hero is full, but still lets one in it come out', async () => {
    open({ itemIds: [1, 2], limit: 2 })
    expect(await screen.findByRole('button', { name: 'Add to hero' })).toBeDisabled()
    cleanup()
    open({ itemIds: [7, 2], limit: 2 })
    expect(await screen.findByRole('button', { name: 'In hero' })).toBeEnabled()
  })
})
