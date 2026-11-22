import { describe, expect, it } from 'bun:test'
import { APPEARANCES, type Appearance, SETTINGS_COPY } from '@raven/wren'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { SegmentedControl } from '@/ui/SegmentedControl/SegmentedControl'

const CHOICES = [
  { key: APPEARANCES.system, label: SETTINGS_COPY.system },
  { key: APPEARANCES.light, label: SETTINGS_COPY.light },
  { key: APPEARANCES.dark, label: SETTINGS_COPY.dark },
] as const

/** The control as Settings holds it: the pick kept in state. */
function HeldControl() {
  const [selected, setSelected] = useState<Appearance>(APPEARANCES.system)
  return (
    <SegmentedControl
      choices={CHOICES}
      label={SETTINGS_COPY.appearance}
      onSelect={setSelected}
      selected={selected}
    />
  )
}

const choice = (name: string) => screen.getByRole('radio', { name })

describe('SegmentedControl', () => {
  it('is a named set of choices, one of them picked', () => {
    render(<HeldControl />)
    const group = screen.getByRole('radiogroup', { name: SETTINGS_COPY.appearance })

    expect(within(group).getAllByRole('radio')).toHaveLength(CHOICES.length)
    expect(choice(SETTINGS_COPY.system)).toBeChecked()
    expect(choice(SETTINGS_COPY.dark)).not.toBeChecked()
  })

  it('moves the pick to the choice pressed', async () => {
    render(<HeldControl />)

    await userEvent.click(choice(SETTINGS_COPY.dark))

    expect(choice(SETTINGS_COPY.dark)).toBeChecked()
    expect(choice(SETTINGS_COPY.system)).not.toBeChecked()
  })
})
