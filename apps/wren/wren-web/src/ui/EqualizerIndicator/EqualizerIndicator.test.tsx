import { describe, expect, it } from 'bun:test'
import { renderKitWithRoutes } from '@/test/render'
import { EqualizerIndicator } from '@/ui/EqualizerIndicator/EqualizerIndicator'

describe('EqualizerIndicator', () => {
  it('keeps the equalizer from a screen reader, which hears the row instead', () => {
    const { container } = renderKitWithRoutes(<EqualizerIndicator isPlaying />)

    expect(container.querySelector('[aria-hidden="true"]')?.children ?? []).toHaveLength(4)
  })
})
