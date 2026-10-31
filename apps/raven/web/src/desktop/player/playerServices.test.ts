import {
  DESKTOP_PATHS,
  DESKTOP_REQUESTS,
  type LocalFile,
  MENU_PLAYER_ACTIONS,
  type MenuPlayerAction,
  PLAYER_ACTIONS,
  type PlayerAction,
} from '@raven/core'
import { describe, expect, it } from 'bun:test'
import { createMenuHub } from '@/desktop/menuHub'
import { type DownloadsPage, playPathOf } from '@/desktop/paths'
import { MUSIC_PATHS } from '@/lib/music'
import {
  ENGINE_NOTES,
  ENGINE_USES,
  type EngineUse,
  fileServicesFor,
  isPlayState,
  playerActionFor,
} from '@/desktop/player/playerServices'
import { DL_1, DL_2, fakeClient, FILE_ID, sentOfType, settled } from '@/test/desktop'
import { useWindowChrome } from '@/stores/windowChrome'

const FILE: LocalFile = {
  fileId: FILE_ID,
  label: 'Clip 01',
  folder: 'Clips',
  isDownload: false,
  resumeAt: 42,
  next: null,
  tracks: null,
}

type SetupProps = { file?: LocalFile; engine?: EngineUse; downloadsPage?: DownloadsPage }

const setup = ({
  file = FILE,
  engine = ENGINE_USES.native,
  downloadsPage = DESKTOP_PATHS.downloads,
}: SetupProps = {}) => {
  const client = fakeClient()
  const menu = createMenuHub()
  return {
    client,
    menu,
    services: fileServicesFor({ file, client, menu, engine, downloadsPage }),
  }
}

describe('playerActionFor', () => {
  const table: Array<[MenuPlayerAction, PlayerAction | null]> = [
    [MENU_PLAYER_ACTIONS.togglePlay, { type: PLAYER_ACTIONS.togglePlay }],
    [MENU_PLAYER_ACTIONS.skipBack, { type: PLAYER_ACTIONS.skip, direction: -1 }],
    [MENU_PLAYER_ACTIONS.skipForward, { type: PLAYER_ACTIONS.skip, direction: 1 }],
    [MENU_PLAYER_ACTIONS.showShortcuts, { type: PLAYER_ACTIONS.showShortcuts }],
    [MENU_PLAYER_ACTIONS.next, null],
    [MENU_PLAYER_ACTIONS.stats, { type: PLAYER_ACTIONS.toggleStats }],
  ]
  it.each(table)('maps %s', (action, expected) => {
    expect(playerActionFor(action)).toEqual(expected)
  })
})

describe('fileServicesFor', () => {
  it('describes a local file, going back to On this Mac', () => {
    expect(setup().services.title).toEqual({
      label: 'Clip 01',
      context: null,
      duration: null,
      resumeAt: 42,
      backTo: DESKTOP_PATHS.local,
      next: null,
    })
  })

  it('links the next video with its queue', () => {
    const { services } = setup({
      file: { ...FILE, next: { fileId: DL_1, label: 'Clip 02', queue: [DL_2] } },
    })
    expect(services.title.next).toEqual({
      to: playPathOf(DL_1),
      state: { queue: [DL_2], from: DESKTOP_PATHS.downloads },
      label: 'Clip 02',
    })
  })

  it('takes a download opened from the music mode back to its Downloads, and the next file too', () => {
    const { services } = setup({
      file: { ...FILE, isDownload: true, next: { fileId: DL_1, label: 'Clip 02', queue: [] } },
      downloadsPage: MUSIC_PATHS.downloads,
    })
    expect(services.title.backTo).toBe('/music/downloads')
    expect(services.title.next?.state).toEqual({ queue: [], from: '/music/downloads' })
  })

  it('saves the position with the length the engine learned, and none before playback began', async () => {
    const { client, services } = setup()
    services.progress.left(5)
    services.progress.save({ position: 10, audio: null })
    services.progress.duration?.(90)
    services.progress.started()
    services.progress.left(20)
    await settled(0)
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.savePosition })).toEqual([
      { type: DESKTOP_REQUESTS.savePosition, fileId: FILE_ID, position: 10, duration: null },
      { type: DESKTOP_REQUESTS.savePosition, fileId: FILE_ID, position: 20, duration: 90 },
    ])
  })

  it('starts from the stored track pick and saves a pick by hand for this file', async () => {
    const tracks = { audio: 1, subtitle: 'embedded-0' }
    const { client, services } = setup({ file: { ...FILE, tracks } })
    expect(services.trackPicks?.start).toEqual(tracks)
    services.trackPicks?.save({ audio: 2, subtitle: null })
    await settled(0)
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.saveTracks })).toEqual([
      { type: DESKTOP_REQUESTS.saveTracks, fileId: FILE_ID, audio: 2, subtitle: null },
    ])
  })

  it('forwards the menu actions the player understands and drops Next', () => {
    const { menu, services } = setup()
    const heard: PlayerAction[] = []
    const stop = services.hostActions?.subscribe((action) => heard.push(action))
    menu.emit(MENU_PLAYER_ACTIONS.togglePlay)
    menu.emit(MENU_PLAYER_ACTIONS.next)
    stop?.()
    menu.emit(MENU_PLAYER_ACTIONS.togglePlay)
    expect(heard).toEqual([{ type: PLAYER_ACTIONS.togglePlay }])
  })

  it('shows and hides the window buttons with the controls', async () => {
    const { client, services } = setup()
    services.chrome?.shown(false)
    await settled(0)
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.windowButtons })).toEqual([
      { type: DESKTOP_REQUESTS.windowButtons, isVisible: false },
    ])
    expect(useWindowChrome.getState().isShown).toBe(false)
  })

  it('says why a video cannot play per engine', () => {
    Object.values(ENGINE_USES).forEach((engine) =>
      expect(setup({ engine }).services.unplayableNote).toBe(ENGINE_NOTES[engine]),
    )
  })
})

describe('isPlayState', () => {
  it('accepts a queue of ids and nothing else', () => {
    expect(isPlayState({ queue: [DL_1] })).toBe(true)
    expect(isPlayState({ queue: ['../x'] })).toBe(false)
    expect(isPlayState(null)).toBe(false)
  })
})
