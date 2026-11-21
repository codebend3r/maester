import { describe, expect, it, mock } from 'bun:test'
import { LIBRARY_PAGE_COPY, NEW_PLAYLIST_COPY } from '@raven/wren'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderKitWithRoutes } from '@/test/render'
import { Card } from '@/ui/Card/Card'
import { EmptyState } from '@/ui/EmptyState/EmptyState'
import { ICONS } from '@/ui/WrenIcon/icons'

describe('EmptyState', () => {
  it('says what an empty list holds and offers what to do about it', async () => {
    const onPress = mock()
    renderKitWithRoutes(
      <Card>
        <EmptyState
          action={{ label: NEW_PLAYLIST_COPY.title, onPress }}
          body={LIBRARY_PAGE_COPY.noPlaylistsHint}
          icon={ICONS.playlist}
          title={LIBRARY_PAGE_COPY.noPlaylists}
        />
      </Card>,
    )

    expect(screen.getByRole('heading', { name: LIBRARY_PAGE_COPY.noPlaylists })).toBeInTheDocument()
    expect(screen.getByText(LIBRARY_PAGE_COPY.noPlaylistsHint)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: NEW_PLAYLIST_COPY.title }))

    expect(onPress).toHaveBeenCalledTimes(1)
  })
})
