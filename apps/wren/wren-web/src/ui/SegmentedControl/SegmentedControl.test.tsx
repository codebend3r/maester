import { describe, expect, it } from 'bun:test'
import { SETTINGS_COPY, THEME_MODES, type ThemeMode } from '@raven/wren'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { SegmentedControl } from '@/ui/SegmentedControl/SegmentedControl'

const LABELS = SETTINGS_COPY.themeModes

const CHOICES = [
  { key: THEME_MODES.system, label: LABELS[THEME_MODES.system] },
  { key: THEME_MODES.single, label: LABELS[THEME_MODES.single] },
] as const

/** The control as Settings holds it: the pick kept in state. */
function HeldControl() {
  const [selected, setSelected] = useState<ThemeMode>(THEME_MODES.system)
  return (
    <SegmentedControl
      choices={CHOICES}
      label={SETTINGS_COPY.themeMode}
      onSelect={setSelected}
      selected={selected}
    />
  )
}

const choice = (name: string) => screen.getByRole('radio', { name })

describe('SegmentedControl', () => {
  it('is a named set of choices, one of them picked', () => {
    render(<HeldControl />)
    const group = screen.getByRole('radiogroup', { name: SETTINGS_COPY.themeMode })

    expect(within(group).getAllByRole('radio')).toHaveLength(CHOICES.length)
    expect(choice(LABELS[THEME_MODES.system])).toBeChecked()
    expect(choice(LABELS[THEME_MODES.single])).not.toBeChecked()
  })

  it('moves the pick to the choice pressed', async () => {
    render(<HeldControl />)

    await userEvent.click(choice(LABELS[THEME_MODES.single]))

    expect(choice(LABELS[THEME_MODES.single])).toBeChecked()
    expect(choice(LABELS[THEME_MODES.system])).not.toBeChecked()
  })
})
