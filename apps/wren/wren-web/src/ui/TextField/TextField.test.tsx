import { WREN_ICONS } from '@raven/wren'
import { describe, expect, it, mock } from 'bun:test'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { TextField } from '@/ui/TextField/TextField'

type HeldFieldProps = { error?: string | null }

/** The field as a screen holds it: what is typed kept in state. */
function HeldField({ error = null }: HeldFieldProps) {
  const [value, setValue] = useState('')
  return (
    <TextField
      error={error}
      icon={WREN_ICONS.mail}
      label="Email"
      onChangeText={setValue}
      placeholder="you@example.com"
      type="email"
      value={value}
    />
  )
}

describe('TextField', () => {
  it('is found by its label and holds what is typed', async () => {
    render(<HeldField />)
    const input = screen.getByLabelText('Email')

    await userEvent.type(input, 'listener@example.com')

    expect(input).toHaveValue('listener@example.com')
    expect(input).toHaveAttribute('type', 'email')
    expect(input).toBeValid()
  })

  it("says what is wrong under the field, as the field's own description", () => {
    render(<HeldField error="Enter your email" />)
    const input = screen.getByLabelText('Email')

    expect(input).toBeInvalid()
    expect(input).toHaveAccessibleDescription('Enter your email')
  })

  it('offers its action as a named button', async () => {
    const onPress = mock()
    render(
      <TextField
        action={{ icon: WREN_ICONS.eye, label: 'Show password', onPress }}
        label="Password"
        onChangeText={() => undefined}
        type="password"
        value=""
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Show password' }))

    expect(onPress).toHaveBeenCalledTimes(1)
  })
})
