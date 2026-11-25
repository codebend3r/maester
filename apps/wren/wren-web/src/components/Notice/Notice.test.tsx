import { describe, expect, it } from 'bun:test'
import { ALBUM_COPY } from '@raven/wren'
import { render, screen } from '@testing-library/react'
import { Notice } from '@/components/Notice/Notice'

describe('Notice', () => {
  it('says its text, and says it again to a screen reader when it changes', () => {
    render(<Notice text={ALBUM_COPY.opening} />)
    expect(screen.getByText(ALBUM_COPY.opening)).toHaveAttribute('aria-live', 'polite')
  })
})
