import { describe, expect, it, jest } from '@jest/globals'
import { render, screen } from '@testing-library/react-native'
import { FocusCard } from '@/layouts/FocusCard'
import { CARD_SHAPES, type ShelfCard } from '@/queries/cards'
import { ROUTE_TARGETS } from '@/routes'
import type * as NavigationFocus from '@/test/navigationFocus'

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof NavigationFocus>('@/test/navigationFocus').navigationFocusMocks,
)
jest.mock(
  '@/layouts/tvFocus',
  () => jest.requireActual<typeof NavigationFocus>('@/test/navigationFocus').tvFocusMocks,
)

const CARD: ShelfCard = {
  key: 'media-12',
  title: 'Severance',
  line: 'S01E02 · Half Loop',
  shape: CARD_SHAPES.wide,
  picture: null,
  progress: 0.4,
  logo: { uri: 'https://nas.example/api/items/4/images/logo', headers: {} },
  target: { kind: ROUTE_TARGETS.play, mediaId: 12, at: 0 },
}

describe('FocusCard', () => {
  it("leads a Continue watching card's caption with its title art in the name's place", async () => {
    await render(
      <FocusCard card={CARD} isPreferred={false} onPress={() => undefined} width={400} />,
    )
    expect(screen.getByRole('image', { name: 'Severance' })).toBeTruthy()
    expect(screen.queryByText('Severance')).toBeNull()
    expect(screen.getByText('S01E02 · Half Loop')).toBeTruthy()
  })

  it('names a card with no title art in type', async () => {
    await render(
      <FocusCard
        card={{ ...CARD, logo: null }}
        isPreferred={false}
        onPress={() => undefined}
        width={400}
      />,
    )
    expect(screen.getByText('Severance')).toBeTruthy()
  })
})
