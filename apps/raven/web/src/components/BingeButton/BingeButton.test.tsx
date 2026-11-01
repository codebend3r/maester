import { describe, expect, it } from 'bun:test'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ITEM_TYPES } from '@raven/core'
import { BingeButton } from '@/components/BingeButton/BingeButton'
import { BINGE_COPY } from '@/lib/binge'
import { useAuthSession } from '@/stores/authSession'
import { useBinge } from '@/stores/binge'
import { renderWithProviders } from '@/test/render'

const show = { id: 4, type: ITEM_TYPES.show } as const

describe('BingeButton', () => {
  it('highlights a first visit, explains the feature, and remembers dismissal', async () => {
    const view = renderWithProviders({ ui: <BingeButton item={show} /> })
    expect(screen.getByRole('note')).toHaveTextContent(BINGE_COPY.tip)
    expect(screen.getByRole('button', { name: BINGE_COPY.add })).toHaveAccessibleDescription(
      BINGE_COPY.tip,
    )
    await userEvent.click(screen.getByRole('button', { name: BINGE_COPY.dismiss }))
    view.rerender(<BingeButton item={show} />)
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('marks and unmarks a show and dismisses the introduction when used', async () => {
    renderWithProviders({ ui: <BingeButton item={show} /> })
    await userEvent.click(screen.getByRole('button', { name: BINGE_COPY.add }))
    expect(screen.getByRole('button', { name: BINGE_COPY.binging })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.queryByRole('note')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: BINGE_COPY.binging }))
    expect(screen.getByRole('button', { name: BINGE_COPY.add })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(useBinge.getState().profiles[0]?.ids).toEqual([])
  })

  it('explains the three-show limit without disabling removal', async () => {
    ;[1, 2, 3].forEach((id) =>
      useBinge.getState().toggle({ account: 'local', item: { ...show, id } }),
    )
    renderWithProviders({ ui: <BingeButton item={show} /> })
    const button = screen.getByRole('button', { name: BINGE_COPY.add })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveAccessibleDescription(BINGE_COPY.limit)
    await userEvent.click(button)
    expect(useBinge.getState().profiles[0]?.ids).toEqual([3, 2, 1])
  })

  it('changes selections and onboarding immediately when the account changes', async () => {
    renderWithProviders({ ui: <BingeButton item={show} /> })
    await userEvent.click(screen.getByRole('button', { name: BINGE_COPY.add }))
    act(() => useAuthSession.setState({ session: { userId: 'other', accessToken: 't' } }))
    expect(screen.getByRole('button', { name: BINGE_COPY.add })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('note')).toBeInTheDocument()
  })
})
