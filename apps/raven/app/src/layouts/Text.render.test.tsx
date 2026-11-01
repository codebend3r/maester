import { describe, expect, it } from '@jest/globals'
import { render, screen } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { BODY_FONT, DISPLAY_FONT } from '@/theme/fonts'

describe('Text', () => {
  it('sets running text in the body face and keeps the weight the caller asked for', async () => {
    await render(<Text style={{ fontWeight: '600' }}>Synopsis</Text>)
    const style = StyleSheet.flatten(screen.getByText('Synopsis').props.style)
    expect(style.fontFamily).toBe(BODY_FONT)
    expect(style.fontWeight).toBe('600')
  })

  it('sets a heading in the display face at its one weight', async () => {
    await render(
      <Text style={{ fontWeight: 'bold' }} variant={TEXT_VARIANTS.display}>
        Heading
      </Text>,
    )
    const style = StyleSheet.flatten(screen.getByText('Heading').props.style)
    expect(style.fontFamily).toBe(DISPLAY_FONT)
    expect(style.fontWeight).toBe('normal')
  })
})
