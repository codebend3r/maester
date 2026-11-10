import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Modal } from '@/components/Modal/Modal'

const Harness = () => {
  const [isOpen, setOpen] = useState(true)
  return (
    <>
      {isOpen && (
        <Modal title="Edit images" onClose={() => setOpen(false)}>
          <p>Pictures</p>
        </Modal>
      )}
      {!isOpen && <p>Closed</p>}
    </>
  )
}

describe('Modal', () => {
  afterEach(cleanup)

  it('opens as a dialog named by its title, with its body inside', () => {
    render(<Harness />)
    const dialog = screen.getByRole('dialog', { name: 'Edit images' })
    expect(within(dialog).getByRole('heading', { name: 'Edit images' })).toBeInTheDocument()
    expect(within(dialog).getByText('Pictures')).toBeInTheDocument()
  })

  it('puts the X before the title and Full screen after it', () => {
    render(<Harness />)
    const buttons = within(screen.getByRole('dialog')).getAllByRole('button')
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Close',
      'Full screen',
    ])
  })

  it('fills the window and back with Full screen', async () => {
    render(<Harness />)
    const dialog = screen.getByRole('dialog')
    const size = within(dialog).getByRole('button', { name: 'Full screen' })
    expect(size).toHaveAttribute('aria-pressed', 'false')
    const framed = dialog.className
    await userEvent.click(size)
    const leave = within(dialog).getByRole('button', { name: 'Leave full screen' })
    expect(leave).toHaveAttribute('aria-pressed', 'true')
    expect(dialog.className).not.toBe(framed)
    await userEvent.click(leave)
    expect(dialog.className).toBe(framed)
  })

  it('closes with the X, at either size', async () => {
    render(<Harness />)
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Full screen' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Closed')).toBeInTheDocument()
  })

  it('closes with Escape', async () => {
    render(<Harness />)
    // A browser moves focus into a modal as it opens; happy-dom does not.
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }).focus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
