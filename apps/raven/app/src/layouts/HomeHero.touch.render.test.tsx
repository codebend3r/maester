import { describe, expect, it, jest } from '@jest/globals'
import { fireEvent, render, screen } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { touchHero } from '@/layouts/HomeHero.touch'
import { CARD_SUBJECTS } from '@/queries/cards'
import type { HeroSlide } from '@/queries/heroSlides'
import { ROUTE_TARGETS, type RouteTarget } from '@/routes'

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
}

const PICTURE = { uri: 'https://nas.example/api/items/4/images/backdrop', headers: {} }

const PLAY: RouteTarget = { kind: ROUTE_TARGETS.play, mediaId: 12, at: 0 }

const FILM: HeroSlide = {
  key: 'media:12',
  eyebrow: 'Featured in Films',
  title: 'Night Train',
  facts: ['2026', '1h 52m'],
  line: 'A train runs all night.',
  poster: PICTURE,
  backdrop: PICTURE,
  play: PLAY,
  details: { kind: ROUTE_TARGETS.item, itemId: 4, libraryId: 1, fileId: null },
  subject: { kind: CARD_SUBJECTS.video, mediaId: 12 },
}

const SHOW: HeroSlide = {
  ...FILM,
  key: 'show:5',
  eyebrow: 'Featured in Series',
  title: 'Pluribus',
  facts: ['2025', '9 episodes'],
  line: null,
  play: null,
  details: { kind: ROUTE_TARGETS.item, itemId: 5, libraryId: null, fileId: null },
}

const { HomeHero } = touchHero

type RenderHeroProps = { slides: readonly HeroSlide[]; onOpen?: (target: RouteTarget) => void }

const renderHero = async ({ slides, onOpen = () => undefined }: RenderHeroProps) =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <HomeHero isPreferred onOpen={onOpen} slides={slides} />
    </SafeAreaProvider>,
  )

describe('HomeHero under the thumb', () => {
  it('draws each slide with its title, its facts and its line', async () => {
    await renderHero({ slides: [FILM, SHOW] })
    expect(screen.getByText('Night Train')).toBeTruthy()
    expect(screen.getByText('Pluribus')).toBeTruthy()
    expect(screen.getByText('A train runs all night.')).toBeTruthy()
    expect(screen.getByText('FEATURED IN FILMS')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Details for Night Train' })).toBeTruthy()
  })

  it("opens a slide's page as it is pressed, and plays it from its button", async () => {
    const onOpen = jest.fn<(target: RouteTarget) => void>()
    await renderHero({ slides: [FILM, SHOW], onOpen })
    await fireEvent.press(screen.getByRole('button', { name: 'Details for Night Train' }))
    expect(onOpen).toHaveBeenLastCalledWith(FILM.details)
    await fireEvent.press(screen.getByRole('button', { name: 'Play Night Train' }))
    expect(onOpen).toHaveBeenLastCalledWith(PLAY)
  })

  it('offers Details in place of Play for a show with nothing left to watch', async () => {
    const onOpen = jest.fn<(target: RouteTarget) => void>()
    await renderHero({ slides: [SHOW], onOpen })
    expect(screen.queryByRole('button', { name: 'Play Pluribus' })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Details for Pluribus' })).toHaveLength(2)
    expect(screen.getByText('Details')).toBeTruthy()
  })

  it('draws nothing with no slides', async () => {
    await renderHero({ slides: [] })
    expect(screen.queryByLabelText('Featured')).toBeNull()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
