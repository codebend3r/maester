import { describe, expect, it } from 'bun:test'
import { ApiError } from '@raven/core'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import {
  UNLOCK_SECRETS,
  type UnlockSecret,
  UnlockDialog,
} from '@/components/UnlockDialog/UnlockDialog'
import { renderWithProviders } from '@/test/render'

type RenderDialogProps = {
  secret?: UnlockSecret
  hint?: string
  unlock?: (entered: string) => Promise<unknown>
}

/** Renders the dialog for `secret`, noting each host callback in `calls` as it runs. */
const renderDialog = ({
  secret = 'pin',
  hint,
  unlock = async () => ({ available: true, unlocked: true }),
}: RenderDialogProps = {}) => {
  const calls: string[] = []
  const entered: string[] = []
  renderWithProviders({
    ui: (
      <UnlockDialog
        secret={secret}
        hint={hint}
        unlock={(value) => {
          entered.push(value)
          return unlock(value)
        }}
        onUnlocked={() => {
          calls.push('onUnlocked')
        }}
        onClose={() => {
          calls.push('onClose')
        }}
      />
    ),
  })
  return { calls, entered }
}

type RefusingWithProps = { status: number; message: string }

const refusingWith =
  ({ status, message }: RefusingWithProps) =>
  async () => {
    throw new ApiError({ status, message })
  }

const openDialog = () => {
  const dialog = screen.getByRole('dialog')
  if (!(dialog instanceof HTMLDialogElement)) throw new Error('The dialog is not a dialog element.')
  return dialog
}

type WaitUntilClosedProps = { dialog: HTMLDialogElement }

/**
 * Retries on a boolean, never an element: a failed `expect(element)` makes Bun print the whole
 * happy-dom node graph, which blocks the event loop for seconds and timed the tests out under load.
 */
const waitUntilClosed = async ({ dialog }: WaitUntilClosedProps) => {
  await waitFor(() => expect(dialog.open).toBe(false))
  expect(screen.queryByRole('dialog')).toBeNull()
}

type AdminThenPinProps = {
  unlock: (entered: string) => Promise<unknown>
  calls: string[]
}

/** A host that asks for the admin password, then the PIN, keying the dialog by its secret. */
const AdminThenPin = ({ unlock, calls }: AdminThenPinProps) => {
  const [secret, setSecret] = useState<UnlockSecret | null>('adminPassword')
  return (
    secret && (
      <UnlockDialog
        key={secret}
        secret={secret}
        unlock={unlock}
        onUnlocked={() => {
          calls.push(`unlocked ${secret}`)
          setSecret(secret === UNLOCK_SECRETS.adminPassword ? UNLOCK_SECRETS.pin : null)
        }}
        onClose={() => {
          calls.push('onClose')
          setSecret(null)
        }}
      />
    )
  )
}

describe('UnlockDialog', () => {
  it('asks for the PIN by default words', () => {
    renderDialog({ secret: 'pin' })
    expect(screen.getByRole('heading', { name: 'Locked library' })).toBeInTheDocument()
    const field = screen.getByLabelText('PIN')
    expect(field).toHaveAttribute('type', 'password')
    expect(field).toHaveAttribute('inputmode', 'numeric')
    expect(field).toHaveAttribute('autocomplete', 'off')
    expect(
      screen.getByText('Enter the PIN to open the locked libraries in this browser.'),
    ).toBeInTheDocument()
  })

  it("uses the host's hint", () => {
    renderDialog({ secret: 'pin', hint: 'Enter the PIN for Vhagar.' })
    expect(screen.getByText('Enter the PIN for Vhagar.')).toBeInTheDocument()
    expect(
      screen.queryByText('Enter the PIN to open the locked libraries in this browser.'),
    ).toBeNull()
  })

  it('asks for the admin password', () => {
    renderDialog({ secret: 'adminPassword' })
    expect(screen.getByRole('heading', { name: 'Admin lock' })).toBeInTheDocument()
    const field = screen.getByLabelText('Admin password')
    expect(field).toHaveAttribute('type', 'password')
    expect(field).not.toHaveAttribute('inputmode')
    expect(field).toHaveAttribute('autocomplete', 'off')
    expect(
      screen.getByText('Enter the admin password to see the locked libraries in this browser.'),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('PIN')).toBeNull()
  })

  it('says a wrong secret is wrong and clears it', async () => {
    const { calls } = renderDialog({
      unlock: refusingWith({ status: 401, message: 'That PIN is not right.' }),
    })
    const field = screen.getByLabelText('PIN')
    await userEvent.type(field, '1234{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('That PIN is not right.')
    expect(field).toHaveValue('')
    expect(calls).toEqual([])
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('says when the server wants a pause', async () => {
    renderDialog({
      unlock: refusingWith({ status: 429, message: 'Too many wrong PINs. Try again in a minute.' }),
    })
    await userEvent.type(screen.getByLabelText('PIN'), '1234{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many wrong PINs. Try again in a minute.',
    )
  })

  it('unlocks and closes, which is not a dismissal', async () => {
    const { calls, entered } = renderDialog()
    const dialog = openDialog()
    await userEvent.type(screen.getByLabelText('PIN'), '3001')
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    await waitUntilClosed({ dialog })
    expect(entered).toEqual(['3001'])
    expect(calls).toEqual(['onUnlocked'])
  })

  it('asks for the PIN afresh after the admin password when the host keys it by secret', async () => {
    const calls: string[] = []
    const entered: string[] = []
    const wrongPassword = 'wrong'
    renderWithProviders({
      ui: (
        <AdminThenPin
          calls={calls}
          unlock={async (value) => {
            entered.push(value)
            if (value === wrongPassword)
              throw new ApiError({ status: 401, message: 'That is not it.' })
            return { state: 'off' }
          }}
        />
      ),
    })
    await userEvent.type(screen.getByLabelText('Admin password'), `${wrongPassword}{Enter}`)
    expect(await screen.findByRole('alert')).toHaveTextContent('That is not it.')
    await userEvent.type(screen.getByLabelText('Admin password'), 'hunter2{Enter}')

    const pin = await screen.findByLabelText('PIN')
    expect(screen.getByRole('heading', { name: 'Locked library' })).toBeInTheDocument()
    const pinDialog = openDialog()
    expect(pinDialog.open).toBe(true)
    expect(pin).toHaveValue('')
    expect(screen.queryByRole('alert')).toBeNull()

    await userEvent.type(pin, '3001{Enter}')
    await waitUntilClosed({ dialog: pinDialog })
    expect(entered).toEqual([wrongPassword, 'hunter2', '3001'])
    expect(calls).toEqual(['unlocked adminPassword', 'unlocked pin'])
  })

  it('keeps Unlock off until something is typed, and while it waits', async () => {
    const held = Promise.withResolvers<unknown>()
    renderDialog({ unlock: () => held.promise })
    const dialog = openDialog()
    const button = screen.getByRole('button', { name: 'Unlock' })
    expect(button).toBeDisabled()
    await userEvent.type(screen.getByLabelText('PIN'), '   ')
    expect(button).toBeDisabled()
    await userEvent.type(screen.getByLabelText('PIN'), '3001')
    expect(button).toBeEnabled()
    await userEvent.click(button)
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(true))
    expect(button).toBeDisabled()
    held.resolve({ available: true, unlocked: true })
    await waitUntilClosed({ dialog })
  })

  it('Escape closes without unlocking', async () => {
    const { calls, entered } = renderDialog()
    await userEvent.type(screen.getByLabelText('PIN'), '3001')
    const dialog = openDialog()
    // What the browser does on Escape: a cancelable cancel, then the dialog closes.
    expect(dialog.dispatchEvent(new Event('cancel', { cancelable: true }))).toBe(true)
    dialog.close()
    await waitFor(() => expect(calls).toEqual(['onClose']))
    expect(entered).toEqual([])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Cancel closes without unlocking', async () => {
    const { calls, entered } = renderDialog()
    await userEvent.type(screen.getByLabelText('PIN'), '3001')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(calls).toEqual(['onClose'])
    expect(entered).toEqual([])
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
