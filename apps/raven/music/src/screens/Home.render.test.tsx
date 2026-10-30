import { describe, expect, it } from '@jest/globals'
import { render, screen } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { Home } from '@/screens/Home'

/** An iPhone's window, its notch and its home indicator. */
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
}

describe('Home', () => {
  it('says it is Home', async () => {
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <Home />
      </SafeAreaProvider>,
    )
    expect(screen.getByRole('header', { name: 'Home' })).toBeTruthy()
  })
})
