import { describe, expect, it } from 'bun:test'
import { KEYS, type KeyPress } from '@raven/core'

import { KEY_ANSWERS, PLAYER_KEYS, keyAnswerOf } from '@/player/keyActions'
import { SUBTITLE_CHOICES } from '@/player/playerTracks'

const pressOf = (key: string): KeyPress => ({ key, metaKey: false, ctrlKey: false, altKey: false })

const OFF = SUBTITLE_CHOICES.off

const playing = {
  position: 100,
  duration: 1000,
  volume: 0.5,
  isMuted: false,
  subtitles: { options: [{ key: OFF }, { key: 'en' }, { key: 'fr' }], value: OFF },
}

describe('PLAYER_KEYS', () => {
  it("lists the web table's keys and nothing the player ignores", () => {
    expect(PLAYER_KEYS).toEqual(expect.arrayContaining(['k', ' ', 'j', 'l', 'm', 'c', '0', '9']))
    expect(PLAYER_KEYS).toEqual(
      expect.arrayContaining([KEYS.arrowUp, KEYS.arrowLeft, KEYS.escape, KEYS.home, KEYS.end]),
    )
    expect(PLAYER_KEYS).not.toContain('a')
    expect(PLAYER_KEYS).not.toContain(KEYS.enter)
  })
})

describe('keyAnswerOf', () => {
  it('plays or pauses on k and Space', () => {
    expect(keyAnswerOf({ ...playing, press: pressOf('k') })).toEqual({
      type: KEY_ANSWERS.togglePlay,
    })
    expect(keyAnswerOf({ ...playing, press: pressOf(KEYS.space) })).toEqual({
      type: KEY_ANSWERS.togglePlay,
    })
  })

  it("asks for a skip either way, leaving how far to the chrome's ladder", () => {
    expect(keyAnswerOf({ ...playing, press: pressOf('l') })).toEqual({
      type: KEY_ANSWERS.skip,
      direction: 1,
    })
    expect(keyAnswerOf({ ...playing, press: pressOf(KEYS.arrowLeft) })).toEqual({
      type: KEY_ANSWERS.skip,
      direction: -1,
    })
  })

  it('seeks to a tenth of the video on a digit, and nowhere while the length is unknown', () => {
    expect(keyAnswerOf({ ...playing, press: pressOf('3') })).toEqual({
      type: KEY_ANSWERS.seek,
      to: 300,
    })
    expect(keyAnswerOf({ ...playing, press: pressOf('3'), duration: null })).toBeNull()
  })

  it('seeks to the start on Home and the end on End', () => {
    expect(keyAnswerOf({ ...playing, press: pressOf(KEYS.home) })).toEqual({
      type: KEY_ANSWERS.seek,
      to: 0,
    })
    expect(keyAnswerOf({ ...playing, press: pressOf(KEYS.end) })).toEqual({
      type: KEY_ANSWERS.seek,
      to: 1000,
    })
  })

  it("moves the volume by the web's step with the arrows, from silence when muted", () => {
    expect(keyAnswerOf({ ...playing, press: pressOf(KEYS.arrowUp) })).toEqual({
      type: KEY_ANSWERS.volume,
      volume: 0.55,
      isMuted: false,
    })
    expect(keyAnswerOf({ ...playing, press: pressOf(KEYS.arrowDown), isMuted: true })).toEqual({
      type: KEY_ANSWERS.volume,
      volume: 0,
      isMuted: true,
    })
  })

  it('mutes and unmutes on m, keeping the volume', () => {
    expect(keyAnswerOf({ ...playing, press: pressOf('M') })).toEqual({
      type: KEY_ANSWERS.volume,
      volume: 0.5,
      isMuted: true,
    })
  })

  it('turns the first subtitles on with c, and off again', () => {
    expect(keyAnswerOf({ ...playing, press: pressOf('c') })).toEqual({
      type: KEY_ANSWERS.subtitle,
      key: 'en',
    })
    expect(
      keyAnswerOf({
        ...playing,
        press: pressOf('c'),
        subtitles: { ...playing.subtitles, value: 'fr' },
      }),
    ).toEqual({ type: KEY_ANSWERS.subtitle, key: OFF })
    expect(keyAnswerOf({ ...playing, press: pressOf('c'), subtitles: null })).toBeNull()
  })

  it('leaves on Escape and ignores the keys the chrome has no control for', () => {
    expect(keyAnswerOf({ ...playing, press: pressOf(KEYS.escape) })).toEqual({
      type: KEY_ANSWERS.leave,
    })
    expect(keyAnswerOf({ ...playing, press: pressOf('f') })).toBeNull()
    expect(keyAnswerOf({ ...playing, press: pressOf('>') })).toBeNull()
    expect(keyAnswerOf({ ...playing, press: pressOf('a') })).toBeNull()
    expect(keyAnswerOf({ ...playing, press: { ...pressOf('k'), metaKey: true } })).toBeNull()
  })
})
