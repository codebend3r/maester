import { describe, expect, it } from 'bun:test'
import { SETTINGS_COPY } from '@raven/wren'
import { screen } from '@testing-library/react'
import { renderKitWithRoutes } from '@/test/render'
import { FactRow } from '@/ui/FactRow/FactRow'

describe('FactRow', () => {
  it('reads a row with nothing to open as a fact, not a control', () => {
    renderKitWithRoutes(<FactRow label={SETTINGS_COPY.version} value="0.9.0" />)

    expect(screen.getByText(SETTINGS_COPY.version)).toBeInTheDocument()
    expect(screen.getByText('0.9.0')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
