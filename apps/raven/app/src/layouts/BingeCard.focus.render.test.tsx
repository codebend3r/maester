import { describe, expect, it, jest } from '@jest/globals'
import { render, screen } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'

import { BingeCardFocus } from '@/layouts/BingeCard.focus'
import type { BingeCard } from '@/queries/bingeCards'
import { CARD_SHAPES, CARD_SUBJECTS } from '@/queries/cards'
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

const SYNOPSIS = 'Mark leads a team of office workers whose memories have been split.'

const CARD: BingeCard = {
  key: 'binge:4',
  title: 'Severance',
  line: null,
  shape: CARD_SHAPES.wide,
  picture: null,
  progress: 0,
  logo: null,
  subject: { kind: CARD_SUBJECTS.item, itemId: 4 },
  isWatched: false,
  target: { kind: ROUTE_TARGETS.play, mediaId: 70, at: 0 },
  meta: '2022 · 50m',
  episodeLine: 'S01E02 · Half Loop',
  stars: 'Adam Scott, Britt Lower',
  synopsis: SYNOPSIS,
  status: 'S01E02',
  page: { kind: ROUTE_TARGETS.item, itemId: 4, libraryId: null, fileId: null },
}

const renderCard = (hasSynopsis: boolean) =>
  render(
    <BingeCardFocus
      card={CARD}
      hasSynopsis={hasSynopsis}
      height={540}
      isPreferred={false}
      onPress={() => undefined}
      place="binge/binge:4"
      shelf="binge"
      width={1920}
    />,
  )

describe('BingeCardFocus', () => {
  it('sets the synopsis in the top right with a shadow under it, on the card across the width', async () => {
    await renderCard(true)
    const synopsis = screen.getByText(SYNOPSIS)
    const style = StyleSheet.flatten(synopsis.props.style)
    expect(style.textAlign).toBe('right')
    expect(style.textShadowRadius).toBeGreaterThan(0)
    expect(style.textShadowColor).toBeTruthy()
  })

  it('leaves the synopsis off a half card, where the words would crowd the rest', async () => {
    await renderCard(false)
    expect(screen.queryByText(SYNOPSIS)).toBeNull()
    expect(screen.getByText('S01E02 · Half Loop')).toBeTruthy()
    expect(screen.getByText('S01E02')).toBeTruthy()
  })
})
