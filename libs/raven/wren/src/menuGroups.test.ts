import { describe, expect, it, mock } from 'bun:test'

import { TRACK_MENU_COPY } from '@/copy/components'
import { type MenuPlaces, menuGroupsOf } from '@/menuGroups'
import { OK_COMPUTER } from '@/testing'

// Each app hands its own drawings; a name stands in for one here.
const MENU_ICONS = {
  playNext: 'playNext',
  queueAdd: 'queueAdd',
  playlistAdd: 'playlistAdd',
  album: 'album',
  artist: 'artist',
} as const

type GroupsProps = { canAddToPlaylist?: boolean; places?: MenuPlaces }

const groupsWith = ({ canAddToPlaylist = false, places = {} }: GroupsProps = {}) => {
  const onPlayNext = mock()
  const onAddToQueue = mock()
  const onPlaylists = mock()
  const onAlbum = mock()
  const onArtist = mock()
  const groups = menuGroupsOf({
    icons: MENU_ICONS,
    canAddToPlaylist,
    places,
    onPlayNext,
    onAddToQueue,
    onPlaylists,
    onAlbum,
    onArtist,
  })
  return { groups, onPlayNext, onAddToQueue, onPlaylists, onAlbum, onArtist }
}

const labelsOf = (groups: ReturnType<typeof groupsWith>['groups']) =>
  groups.map((group) => group.map((action) => action.label))

const [ARTIST] = OK_COMPUTER.artists

describe('menuGroupsOf', () => {
  it('offers only the queue when it is given no place and no playlists', () => {
    const { groups } = groupsWith()

    expect(labelsOf(groups)).toEqual([[TRACK_MENU_COPY.playNext, TRACK_MENU_COPY.addToQueue], []])
  })

  it('ends the queue group with Add to playlist where it shows', () => {
    const { groups, onPlaylists } = groupsWith({ canAddToPlaylist: true })

    expect(labelsOf(groups)).toEqual([
      [TRACK_MENU_COPY.playNext, TRACK_MENU_COPY.addToQueue, TRACK_MENU_COPY.addToPlaylist],
      [],
    ])
    expect(groups[0]?.[2]?.icon).toBe(MENU_ICONS.playlistAdd)
    groups[0]?.[2]?.onPress()
    expect(onPlaylists).toHaveBeenCalledTimes(1)
  })

  it('lists the places it was given, the album before the artist, each opening its page', () => {
    const { groups, onAlbum, onArtist } = groupsWith({
      places: { albumId: OK_COMPUTER.id, artist: ARTIST },
    })
    const [, goes] = groups

    expect(goes?.map((action) => action.label)).toEqual([
      TRACK_MENU_COPY.goToAlbum,
      TRACK_MENU_COPY.goToArtist,
    ])
    expect(goes?.map((action) => action.icon)).toEqual([MENU_ICONS.album, MENU_ICONS.artist])
    goes?.[0]?.onPress()
    expect(onAlbum.mock.calls).toEqual([[OK_COMPUTER.id]])
    expect(onArtist).not.toHaveBeenCalled()
    goes?.[1]?.onPress()
    expect(onArtist.mock.calls).toEqual([[ARTIST?.id ?? 0]])
  })

  it('leaves out a place it was not given', () => {
    const { groups } = groupsWith({ places: { artist: ARTIST } })

    expect(labelsOf(groups)[1]).toEqual([TRACK_MENU_COPY.goToArtist])
  })

  it('hands each queue action its own drawing and its own press', () => {
    const { groups, onPlayNext, onAddToQueue } = groupsWith()

    expect(groups[0]?.map((action) => action.icon)).toEqual([
      MENU_ICONS.playNext,
      MENU_ICONS.queueAdd,
    ])
    groups[0]?.[0]?.onPress()
    expect(onPlayNext).toHaveBeenCalledTimes(1)
    expect(onAddToQueue).not.toHaveBeenCalled()
    groups[0]?.[1]?.onPress()
    expect(onAddToQueue).toHaveBeenCalledTimes(1)
  })
})
