import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { act, waitFor } from '@testing-library/react'
import type { PlaylistDetails, PlaylistSummary } from '@raven/core'
import { queryKeys } from '@/query/queryClient'
import { playlistMutationsFor } from '@/query/usePlaylistMutations'
import { playlistDetails, track } from '@/test/fixtures'
import { recordingApi } from '@/test/recordingApi'
import { renderQueryHook } from '@/test/renderQueryHook'

const PAGE = playlistDetails()

const { api } = recordingApi({ body: null })
const { usePlaylistMutations } = playlistMutationsFor({ api })

/** A cache holding the playlist's page and the list of playlists, as the playlist page leaves it. */
const holdingPlaylist = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(queryKeys.playlist(PAGE.playlist.id), PAGE)
  client.setQueryData(queryKeys.playlistList, [PAGE.playlist])
  return client
}

const pageIn = (client: QueryClient) =>
  client.getQueryData<PlaylistDetails>(queryKeys.playlist(PAGE.playlist.id))

const listIn = (client: QueryClient) =>
  client.getQueryData<PlaylistSummary[]>(queryKeys.playlistList)

describe('usePlaylistMutations', () => {
  const create = spyOn(api, 'createPlaylist')
  const rename = spyOn(api, 'renamePlaylist')
  const replace = spyOn(api, 'replacePlaylistTracks')
  const append = spyOn(api, 'appendPlaylistTracks')
  const remove = spyOn(api, 'deletePlaylist')
  const list = spyOn(api, 'listPlaylists')
  const share = spyOn(api, 'setPlaylistSharing')
  const copy = spyOn(api, 'copyPlaylist')

  afterEach(() =>
    [create, rename, replace, append, remove, list, share, copy].forEach((spy) => spy.mockReset()),
  )

  it('renames the playlist on its page and in the list before the server answers', async () => {
    const answer = Promise.withResolvers<PlaylistDetails>()
    rename.mockImplementation(() => answer.promise)
    const client = holdingPlaylist()
    const { result } = renderQueryHook({ client, hook: () => usePlaylistMutations() })

    act(() => result.current.rename.mutate({ id: PAGE.playlist.id, name: 'Night' }))

    await waitFor(() => expect(pageIn(client)?.playlist.name ?? null).toBe('Night'))
    expect(listIn(client)?.[0]?.name ?? null).toBe('Night')
    expect(rename).toHaveBeenCalledWith({ id: PAGE.playlist.id, name: 'Night' })
    answer.resolve({ ...PAGE, playlist: { ...PAGE.playlist, name: 'Night' } })
  })

  it('sends the whole new order, counting the tracks again on the page at once', async () => {
    const answer = Promise.withResolvers<PlaylistDetails>()
    replace.mockImplementation(() => answer.promise)
    const client = holdingPlaylist()
    const { result } = renderQueryHook({ client, hook: () => usePlaylistMutations() })
    const kept = [track({ id: 102, duration: 150 })]

    act(() => result.current.setTracks.mutate({ id: PAGE.playlist.id, tracks: kept }))

    await waitFor(() => expect(pageIn(client)?.tracks.map(({ id }) => id) ?? null).toEqual([102]))
    expect(pageIn(client)?.playlist ?? null).toMatchObject({ trackCount: 1, duration: 150 })
    expect(listIn(client)?.[0] ?? null).toMatchObject({ trackCount: 1, duration: 150 })
    expect(replace).toHaveBeenCalledWith({ id: PAGE.playlist.id, mediaIds: [102] })
    answer.resolve(PAGE)
  })

  it("makes a playlist and keeps the server's answer as its page", async () => {
    const made = playlistDetails({
      playlist: { ...PAGE.playlist, id: 9, name: 'New', trackCount: 0, duration: 0 },
      tracks: [],
    })
    create.mockResolvedValue(made)
    list.mockResolvedValue([made.playlist])
    const client = holdingPlaylist()
    const { result } = renderQueryHook({ client, hook: () => usePlaylistMutations() })

    await act(() => result.current.create.mutateAsync('New'))

    expect(create).toHaveBeenCalledWith({ name: 'New' })
    expect(client.getQueryData<PlaylistDetails>(queryKeys.playlist(9))).toEqual(made)
  })

  it('adds tracks at the end of the page and the count in the list before the server answers', async () => {
    const answer = Promise.withResolvers<PlaylistDetails>()
    append.mockImplementation(() => answer.promise)
    list.mockResolvedValue([PAGE.playlist])
    const client = holdingPlaylist()
    const { result } = renderQueryHook({ client, hook: () => usePlaylistMutations() })
    const added = track({ id: 103, duration: 200 })

    act(() => result.current.append.mutate({ id: PAGE.playlist.id, tracks: [added] }))

    await waitFor(() => expect(pageIn(client)?.tracks.at(-1)?.id ?? null).toBe(103))
    const grown = {
      trackCount: PAGE.playlist.trackCount + 1,
      duration: PAGE.playlist.duration + 200,
    }
    expect(pageIn(client)?.playlist ?? null).toMatchObject(grown)
    expect(listIn(client)?.[0] ?? null).toMatchObject(grown)
    expect(append).toHaveBeenCalledWith({ id: PAGE.playlist.id, mediaIds: [103] })
    answer.resolve(PAGE)
  })

  it('puts the page and the list back when the server refuses the tracks', async () => {
    append.mockRejectedValue(new Error('refused'))
    list.mockResolvedValue([PAGE.playlist])
    const client = holdingPlaylist()
    const { result } = renderQueryHook({ client, hook: () => usePlaylistMutations() })

    await act(() =>
      result.current.append
        .mutateAsync({ id: PAGE.playlist.id, tracks: [track({ id: 103 })] })
        .catch(() => undefined),
    )

    expect(pageIn(client)).toEqual(PAGE)
    expect(listIn(client)).toEqual([PAGE.playlist])
    expect(result.current.append.failure?.message ?? null).toBe('refused')
  })

  it('takes a playlist out of the list before the server answers, and its page once it agrees', async () => {
    const answer = Promise.withResolvers<undefined>()
    remove.mockImplementation(() => answer.promise)
    list.mockResolvedValue([])
    const client = holdingPlaylist()
    const { result } = renderQueryHook({ client, hook: () => usePlaylistMutations() })

    act(() => result.current.remove.mutate(PAGE.playlist.id))

    await waitFor(() => expect(listIn(client)).toEqual([]))
    expect(pageIn(client)).toEqual(PAGE)
    answer.resolve(undefined)
    await waitFor(() => expect(pageIn(client)).toBeUndefined())
  })

  it('puts a playlist back in the list when the server refuses to delete it', async () => {
    remove.mockRejectedValue(new Error('refused'))
    list.mockResolvedValue([PAGE.playlist])
    const client = holdingPlaylist()
    const { result } = renderQueryHook({ client, hook: () => usePlaylistMutations() })

    await act(() => result.current.remove.mutateAsync(PAGE.playlist.id).catch(() => undefined))

    expect(listIn(client)).toEqual([PAGE.playlist])
    expect(pageIn(client)).toEqual(PAGE)
  })

  it('shares a playlist and keeps the page the server answers with', async () => {
    const shared = playlistDetails({ playlist: { ...PAGE.playlist, isShared: true } })
    share.mockResolvedValue(shared)
    list.mockResolvedValue([shared.playlist])
    const client = holdingPlaylist()
    const { result } = renderQueryHook({ client, hook: () => usePlaylistMutations() })

    await act(() => result.current.share.mutateAsync({ id: PAGE.playlist.id, isShared: true }))

    expect(share).toHaveBeenCalledWith({ id: PAGE.playlist.id, isShared: true })
    expect(pageIn(client)?.playlist.isShared ?? null).toBe(true)
  })

  it("copies a playlist and keeps the copy's page", async () => {
    const copied = playlistDetails({ playlist: { ...PAGE.playlist, id: 12, isOwn: true } })
    copy.mockResolvedValue(copied)
    list.mockResolvedValue([PAGE.playlist, copied.playlist])
    const client = holdingPlaylist()
    const { result } = renderQueryHook({ client, hook: () => usePlaylistMutations() })

    await act(() => result.current.copy.mutateAsync(PAGE.playlist.id))

    expect(copy).toHaveBeenCalledWith({ id: PAGE.playlist.id })
    expect(client.getQueryData<PlaylistDetails>(queryKeys.playlist(12))).toEqual(copied)
  })
})
