import { describe, expect, it, mock } from 'bun:test'
import { artistNames } from '@raven/core'
import { KIT_COPY, SONG_LEADS } from '@raven/wren'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PARANOID } from '@/test/music'
import { renderKitWithRoutes } from '@/test/render'
import { SongRow } from '@/ui/SongRow/SongRow'

describe('SongRow', () => {
  it('plays from a song row, marks the one playing and offers its menu', async () => {
    const onPress = mock()
    const onMore = mock()
    renderKitWithRoutes(
      <SongRow
        duration="5:00"
        isCurrent
        isPlaying
        label={PARANOID.title}
        lead={{ kind: SONG_LEADS.number, number: String(PARANOID.number) }}
        onMore={onMore}
        onPress={onPress}
        subtitle={artistNames(PARANOID)}
        title={PARANOID.title}
      />,
    )
    const row = screen.getByRole('button', { name: PARANOID.title, current: true })

    // The row playing shows the equalizer in its number's place.
    expect(within(row).queryByText(String(PARANOID.number))).toBeNull()
    expect(within(row).getByText('5:00')).toBeInTheDocument()
    await userEvent.click(row)
    await userEvent.click(screen.getByRole('button', { name: KIT_COPY.more(PARANOID.title) }))

    expect(onPress).toHaveBeenCalledTimes(1)
    expect(onMore).toHaveBeenCalledTimes(1)
  })

  it('numbers a song row on its album, and leads one in a list with its cover', () => {
    const { container } = renderKitWithRoutes(
      <>
        <SongRow
          duration="5:00"
          label="Numbered"
          lead={{ kind: SONG_LEADS.number, number: '2' }}
          onPress={() => undefined}
          title="Numbered"
        />
        <SongRow
          duration="5:00"
          label="Covered"
          lead={{ kind: SONG_LEADS.art, cover: { src: '/api/pictures/cover' } }}
          onPress={() => undefined}
          title="Covered"
        />
      </>,
    )

    expect(screen.getByText('2')).toBeInTheDocument()
    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: KIT_COPY.more('Numbered') })).toBeNull()
  })
})
