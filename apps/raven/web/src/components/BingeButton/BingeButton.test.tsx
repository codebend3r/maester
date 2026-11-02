import { afterEach, describe, expect, it } from 'bun:test'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ITEM_TYPES } from '@raven/core'
import { BingeButton } from '@/components/BingeButton/BingeButton'
import { BINGE_COPY } from '@/lib/binge'
import { useAuthSession } from '@/stores/authSession'
import { fakeBinge } from '@/test/fakeBinge'
import { renderWithProviders } from '@/test/render'

const show = { id: 4, type: ITEM_TYPES.show } as const

describe('BingeButton', () => {
  let binge = fakeBinge()
  afterEach(() => binge.restore())

  it('highlights a first visit, explains the feature, and remembers dismissal', async () => {
    binge = fakeBinge()
    renderWithProviders({ ui: <BingeButton item={show} /> })
    expect(await screen.findByRole('note')).toHaveTextContent(BINGE_COPY.tip)
    expect(
      screen.getByRole('button', { name: BINGE_COPY.add }).querySelector('[data-icon="popcorn"]'),
    ).not.toBeNull()
    expect(screen.getByRole('button', { name: BINGE_COPY.add })).toHaveAccessibleDescription(
      BINGE_COPY.tip,
    )
    await userEvent.click(screen.getByRole('button', { name: BINGE_COPY.dismiss }))
    await waitFor(() => expect(screen.queryByRole('note')).toBeNull())
    expect(binge.state().hasSeenTip).toBe(true)
  })

  it('never flashes the tip for an account that has dismissed it', async () => {
    binge = fakeBinge({ hasSeenTip: true })
    renderWithProviders({ ui: <BingeButton item={show} /> })
    await waitFor(() => expect(binge.get).toHaveBeenCalled())
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('marks and unmarks a show on the server and dismisses the introduction when used', async () => {
    binge = fakeBinge()
    renderWithProviders({ ui: <BingeButton item={show} /> })
    await userEvent.click(await screen.findByRole('button', { name: BINGE_COPY.add }))
    expect(await screen.findByRole('button', { name: BINGE_COPY.binging })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(binge.state().ids).toEqual([4])
    expect(screen.queryByRole('note')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: BINGE_COPY.binging }))
    expect(await screen.findByRole('button', { name: BINGE_COPY.add })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(binge.state().ids).toEqual([])
  })

  it('shows what the server already holds, as another device left it', async () => {
    binge = fakeBinge({ ids: [4], hasSeenTip: true })
    renderWithProviders({ ui: <BingeButton item={show} /> })
    expect(await screen.findByRole('button', { name: BINGE_COPY.binging })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('explains the three-show limit without disabling removal', async () => {
    binge = fakeBinge({ ids: [3, 2, 1], hasSeenTip: true })
    renderWithProviders({ ui: <BingeButton item={show} /> })
    const button = await screen.findByRole('button', { name: BINGE_COPY.add })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveAccessibleDescription(BINGE_COPY.limit)
    await userEvent.click(button)
    expect(binge.set).not.toHaveBeenCalled()
    expect(binge.state().ids).toEqual([3, 2, 1])
  })

  it('reads the signed-in account’s list, and another’s when the account changes', async () => {
    binge = fakeBinge({ ids: [4], hasSeenTip: true })
    renderWithProviders({ ui: <BingeButton item={show} /> })
    expect(await screen.findByRole('button', { name: BINGE_COPY.binging })).toBeInTheDocument()
    binge.get.mockImplementation(async () => ({ ids: [], hasSeenTip: false }))
    act(() => useAuthSession.setState({ session: { userId: 'other', accessToken: 't' } }))
    expect(await screen.findByRole('button', { name: BINGE_COPY.add })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(await screen.findByRole('note')).toBeInTheDocument()
  })
})
