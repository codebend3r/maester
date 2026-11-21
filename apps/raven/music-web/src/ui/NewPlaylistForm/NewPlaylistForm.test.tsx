import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { NEW_PLAYLIST_COPY } from '@raven/wren'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '@/lib/api'
import { MIXTAPE, mockMusicApi } from '@/test/music'
import { renderKitWithRoutes } from '@/test/render'
import { NewPlaylistForm } from '@/ui/NewPlaylistForm/NewPlaylistForm'

describe('NewPlaylistForm', () => {
  const state: { music: ReturnType<typeof mockMusicApi> | null } = { music: null }

  afterEach(() => {
    cleanup()
    state.music?.restore()
    state.music = null
  })

  it('makes a playlist once it has a name, and hands back the one the server made', async () => {
    state.music = mockMusicApi()
    const created = { ...MIXTAPE, id: 9, name: 'Road trip', trackCount: 0 }
    const createPlaylist = spyOn(api, 'createPlaylist').mockResolvedValue({
      playlist: created,
      tracks: [],
    })
    const onCreated = mock()
    renderKitWithRoutes(<NewPlaylistForm onCreated={onCreated} />)
    const create = screen.getByRole('button', { name: NEW_PLAYLIST_COPY.create })
    expect(create).toBeDisabled()

    await userEvent.type(screen.getByLabelText(NEW_PLAYLIST_COPY.name), 'Road trip{Enter}')

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created))
    expect(createPlaylist).toHaveBeenCalledWith({ name: 'Road trip' })
    createPlaylist.mockRestore()
  })
})
