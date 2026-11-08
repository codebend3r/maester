import { describe, expect, it, jest } from '@jest/globals'
import { fireEvent, render, screen } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'
import { FocusCard } from '@/layouts/FocusCard'
import { CARD_SHAPES, type ShelfCard } from '@/queries/cards'
import { ROUTE_TARGETS } from '@/routes'
import { useReduceMotion } from '@/stores/reduceMotion'
import { NATIVE_EVENTS } from '@/test/nativeEvents'
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
  line: null,
  shape: CARD_SHAPES.wide,
  picture: null,
  progress: 0.4,
  subject: null,
  isWatched: false,
  logo: { uri: 'https://nas.example/api/items/4/images/logo', headers: {} },
  episode: { name: 'Half Loop', mark: 'S1.E2' },
  resume: { timeLeft: '42m left' },
  target: { kind: ROUTE_TARGETS.play, mediaId: 12, at: 0 },
}

describe('FocusCard', () => {
  it("says an episode's name and its S1.E2 place under the picture, each on its own line", async () => {
    await render(
      <FocusCard card={CARD} isPreferred={false} onPress={() => undefined} width={400} />,
    )
    expect(screen.getByText('Half Loop')).toBeTruthy()
    expect(screen.getByText('S1.E2')).toBeTruthy()
    expect(screen.queryByText('Severance')).toBeNull()
  })

  it('leaves the words of a film that wears title art to the art, and names one without it', async () => {
    const film = { ...CARD, episode: null, line: '2026' }
    const { rerender } = await render(
      <FocusCard card={film} isPreferred={false} onPress={() => undefined} width={400} />,
    )
    expect(screen.queryByText('Severance')).toBeNull()
    await rerender(
      <FocusCard
        card={{ ...film, logo: null }}
        isPreferred={false}
        onPress={() => undefined}
        width={400}
      />,
    )
    expect(screen.getByText('Severance')).toBeTruthy()
  })
})

describe('FocusCard watched', () => {
  it('says a watched title is watched, and a title not yet watched nothing more', async () => {
    const watched = { ...CARD, episode: null, isWatched: true }
    const { rerender } = await render(
      <FocusCard card={watched} isPreferred={false} onPress={() => undefined} width={400} />,
    )
    expect(screen.getByRole('button', { name: 'Severance, Watched' })).toBeTruthy()
    await rerender(
      <FocusCard
        card={{ ...watched, isWatched: false }}
        isPreferred={false}
        onPress={() => undefined}
        width={400}
      />,
    )
    expect(screen.getByRole('button', { name: 'Severance' })).toBeTruthy()
  })
})

describe('FocusCard focus', () => {
  it('rests inside its box and grows to fill it while focused, never standing in front by zIndex', async () => {
    useReduceMotion.setState({ isReduced: true })
    await render(
      <FocusCard card={CARD} isPreferred={false} onPress={() => undefined} width={400} />,
    )
    const card = screen.getByRole('button')
    const scaleOf = () => {
      const [face] = card.children
      if (typeof face !== 'object' || face === null) throw new Error('No card face')
      return StyleSheet.flatten(face.props.style)?.transform ?? null
    }
    expect(scaleOf()).toEqual([{ scale: 1 / 1.08 }])
    expect(StyleSheet.flatten(card.props.style)?.zIndex).toBeUndefined()

    await fireEvent(card, NATIVE_EVENTS.focus)
    expect(scaleOf()).toEqual([{ scale: 1 }])
    expect(StyleSheet.flatten(card.props.style)?.zIndex).toBeUndefined()

    await fireEvent(card, NATIVE_EVENTS.blur)
    expect(scaleOf()).toEqual([{ scale: 1 / 1.08 }])
  })
})
