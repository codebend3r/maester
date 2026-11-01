import { describe, expect, it } from '@jest/globals'
import { render, screen } from '@testing-library/react-native'

import { TouchCard } from '@/layouts/TouchCard'
import { CARD_SHAPES, type ShelfCard } from '@/queries/cards'
import { ROUTE_TARGETS } from '@/routes'

const CARD: ShelfCard = {
  key: 'media-12',
  title: 'Severance',
  line: null,
  shape: CARD_SHAPES.wide,
  picture: null,
  progress: 0.4,
  logo: { uri: 'https://nas.example/api/items/4/images/logo', headers: {} },
  episode: { name: 'Half Loop', mark: 'S1.E2' },
  resume: { timeLeft: '42m left' },
  target: { kind: ROUTE_TARGETS.play, mediaId: 12, at: 0 },
}

describe('TouchCard', () => {
  it('draws a resume card with the episode name, its S1.E2 place and the time left over the picture', async () => {
    await render(<TouchCard card={CARD} onPress={() => undefined} width={288} />)
    expect(screen.getByRole('button', { name: 'Severance, S1.E2, Half Loop' })).toBeTruthy()
    expect(screen.getByText('Half Loop')).toBeTruthy()
    expect(screen.getByText('S1.E2')).toBeTruthy()
    expect(screen.getByText('42m left')).toBeTruthy()
    expect(screen.queryByText('Severance')).toBeNull()
  })

  it("prints the show's name over a resume card whose title art is missing", async () => {
    await render(<TouchCard card={{ ...CARD, logo: null }} onPress={() => undefined} width={288} />)
    expect(screen.getByText('Severance')).toBeTruthy()
  })

  it('wears title art in place of the title on a plain card, still named for a screen reader', async () => {
    const plain = { ...CARD, episode: null, resume: null, line: '2026' }
    await render(<TouchCard card={plain} onPress={() => undefined} width={128} />)
    expect(screen.getByRole('button', { name: 'Severance' })).toBeTruthy()
    expect(screen.queryByText('Severance')).toBeNull()
    expect(screen.getByText('2026')).toBeTruthy()
  })

  it('names a plain card with no title art in type', async () => {
    const plain = { ...CARD, episode: null, resume: null, logo: null }
    await render(<TouchCard card={plain} onPress={() => undefined} width={128} />)
    expect(screen.getByText('Severance')).toBeTruthy()
  })
})
