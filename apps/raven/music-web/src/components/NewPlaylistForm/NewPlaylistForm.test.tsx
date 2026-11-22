import { describe, expect, it, mock } from 'bun:test'
import { NEW_PLAYLIST_COPY } from '@raven/wren'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewPlaylistForm } from '@/components/NewPlaylistForm/NewPlaylistForm'
import { ROAD_TRIP, mockMusicAndWritesEach } from '@/test/music'
import { renderKitWithRoutes } from '@/test/render'

describe('NewPlaylistForm', () => {
  const mocked = mockMusicAndWritesEach()

  it('makes a playlist once it has a name, and hands back the one the server made', async () => {
    const onCreated = mock()
    renderKitWithRoutes(<NewPlaylistForm onCreated={onCreated} />)
    const create = screen.getByRole('button', { name: NEW_PLAYLIST_COPY.create })
    expect(create).toBeDisabled()

    await userEvent.type(screen.getByLabelText(NEW_PLAYLIST_COPY.name), `${ROAD_TRIP.name}{Enter}`)

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(ROAD_TRIP))
    expect(mocked().writes.createPlaylist).toHaveBeenCalledWith({ name: ROAD_TRIP.name })
  })
})
