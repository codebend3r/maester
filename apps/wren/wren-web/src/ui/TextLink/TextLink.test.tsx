import { describe, expect, it } from 'bun:test'
import { screen } from '@testing-library/react'
import { WREN_ROUTES } from '@/routes'
import { renderKitWithRoutes } from '@/test/render'
import { TextLink } from '@/ui/TextLink/TextLink'

describe('TextLink', () => {
  it('is a link where a text link goes somewhere, and a button where it acts', () => {
    renderKitWithRoutes(
      <>
        <TextLink href={WREN_ROUTES.library} label="Manage" />
        <TextLink label="Clear" onPress={() => undefined} />
      </>,
    )

    expect(screen.getByRole('link', { name: 'Manage' })).toHaveAttribute(
      'href',
      WREN_ROUTES.library,
    )
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument()
  })
})
