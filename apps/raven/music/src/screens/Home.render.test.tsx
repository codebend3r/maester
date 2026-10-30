import { describe, expect, it } from '@jest/globals'
import { render, screen } from '@testing-library/react-native'

import { Home } from '@/screens/Home'

describe('Home', () => {
  it('says it is Wren', async () => {
    await render(<Home />)
    expect(screen.getByRole('header', { name: 'Wren' })).toBeTruthy()
  })
})
