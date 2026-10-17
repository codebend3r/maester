import { describe, expect, it, spyOn } from 'bun:test'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '@raven/core'
import { PinPrompt } from '@/components/PinPrompt/PinPrompt'
import { api } from '@/lib/api'
import { useUnlockPrompt } from '@/stores/unlockPrompt'
import { renderWithProviders } from '@/test/render'

describe('PinPrompt', () => {
  it('stays away until something asks for the PIN', () => {
    renderWithProviders({ ui: <PinPrompt /> })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('says a wrong PIN is wrong, and opens with the right one', async () => {
    const rightPin = '3001'
    const entered: string[] = []
    const unlock = spyOn(api, 'unlock').mockImplementation(async (pin) => {
      entered.push(pin)
      if (pin !== rightPin) throw new ApiError({ status: 401, message: 'That PIN is not right.' })
      return { available: true, unlocked: true }
    })
    useUnlockPrompt.getState().ask()
    renderWithProviders({ ui: <PinPrompt /> })
    const pin = await screen.findByLabelText('PIN')
    await userEvent.type(pin, '1234{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('That PIN is not right.')
    expect(pin).toHaveValue('')

    await userEvent.type(pin, rightPin)
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    unlock.mockRestore()
    expect(entered).toEqual(['1234', rightPin])
    expect(useUnlockPrompt.getState().open).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
