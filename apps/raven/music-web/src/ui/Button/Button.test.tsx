import { describe, expect, it, mock } from 'bun:test'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BUTTON_VARIANTS, Button } from '@/ui/Button/Button'
import { ICONS } from '@/ui/WrenIcon/icons'

/** What the form hands its submit handler, as far as the test reads it. */
type Submitted = { preventDefault: () => void }

describe('Button', () => {
  it('is named by its label and does what a press asks', async () => {
    const onPress = mock()
    render(<Button icon={ICONS.play} label="Play" onPress={onPress} />)

    await userEvent.click(screen.getByRole('button', { name: 'Play' }))

    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('answers no press while it is off', async () => {
    const onPress = mock()
    render(<Button isDisabled label="Create" onPress={onPress} />)

    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
    expect(onPress).not.toHaveBeenCalled()
  })

  it('keeps its name, says it is busy and answers no press while it waits', async () => {
    const onPress = mock()
    render(<Button isLoading label="Sign in" onPress={onPress} />)
    const button = screen.getByRole('button', { name: 'Sign in' })

    await userEvent.click(button)

    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toBeDisabled()
    expect(onPress).not.toHaveBeenCalled()
  })

  it('submits the form it sits in when it is its submit, and never otherwise', async () => {
    const onSubmit = mock((event: Submitted) => event.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <Button label="Cancel" onPress={() => undefined} variant={BUTTON_VARIANTS.secondary} />
        <Button isSubmit label="Create" />
      </form>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onSubmit).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})
