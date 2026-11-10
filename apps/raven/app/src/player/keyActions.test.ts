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
  lastSkip: null,
  now: 10_000,
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
    expect(keyAnswerOf({ ...playing, press: pressOf('k') }).answer).toEqual({
      type: KEY_ANSWERS.togglePlay,
    })
    expect(keyAnswerOf({ ...playing, press: pressOf(KEYS.space) }).answer).toEqual({
      type: KEY_ANSWERS.togglePlay,
    })
  })

  it('skips ten seconds, and further when pressed again within a second', () => {
    const first = keyAnswerOf({ ...playing, press: pressOf('l') })
    expect(first.answer).toEqual({ type: KEY_ANSWERS.seek, to: 110 })
    const second = keyAnswerOf({
      ...playing,
      press: pressOf('l'),
      lastSkip: first.lastSkip,
      now: 10_500,
    })
    expect(second.answer).toEqual({ type: KEY_ANSWERS.seek, to: 120 })
    const back = keyAnswerOf({
      ...playing,
      press: pressOf(KEYS.arrowLeft),
      lastSkip: second.lastSkip,
      now: 10_900,
    })
    expect(back.answer).toEqual({ type: KEY_ANSWERS.seek, to: 90 })
  })

  it('seeks to a tenth of the video on a digit, and nowhere while the length is unknown', () => {
    expect(keyAnswerOf({ ...playing, press: pressOf('3') }).answer).toEqual({
      type: KEY_ANSWERS.seek,
      to: 300,
    })
    expect(keyAnswerOf({ ...playing, press: pressOf('3'), duration: null }).answer).toBeNull()
  })

  it('seeks to the start on Home and the end on End', () => {
    expect(keyAnswerOf({ ...playing, press: pressOf(KEYS.home) }).answer).toEqual({
      type: KEY_ANSWERS.seek,
      to: 0,
    })
    expect(keyAnswerOf({ ...playing, press: pressOf(KEYS.end) }).answer).toEqual({
      type: KEY_ANSWERS.seek,
      to: 1000,
    })
  })

  it("moves the volume by the web's step with the arrows, from silence when muted", () => {
    expect(keyAnswerOf({ ...playing, press: pressOf(KEYS.arrowUp) }).answer).toEqual({
      type: KEY_ANSWERS.volume,
      volume: 0.55,
      isMuted: false,
    })
    expect(
      keyAnswerOf({ ...playing, press: pressOf(KEYS.arrowDown), isMuted: true }).answer,
    ).toEqual({
      type: KEY_ANSWERS.volume,
      volume: 0,
      isMuted: true,
    })
  })

  it('mutes and unmutes on m, keeping the volume', () => {
    expect(keyAnswerOf({ ...playing, press: pressOf('M') }).answer).toEqual({
      type: KEY_ANSWERS.volume,
      volume: 0.5,
      isMuted: true,
    })
  })

  it('turns the first subtitles on with c, and off again', () => {
    expect(keyAnswerOf({ ...playing, press: pressOf('c') }).answer).toEqual({
      type: KEY_ANSWERS.subtitle,
      key: 'en',
    })
    expect(
      keyAnswerOf({
        ...playing,
        press: pressOf('c'),
        subtitles: { ...playing.subtitles, value: 'fr' },
      }).answer,
    ).toEqual({ type: KEY_ANSWERS.subtitle, key: OFF })
    expect(keyAnswerOf({ ...playing, press: pressOf('c'), subtitles: null }).answer).toBeNull()
  })

  it('leaves on Escape and ignores the keys the chrome has no control for', () => {
    expect(keyAnswerOf({ ...playing, press: pressOf(KEYS.escape) }).answer).toEqual({
      type: KEY_ANSWERS.leave,
    })
    expect(keyAnswerOf({ ...playing, press: pressOf('f') }).answer).toBeNull()
    expect(keyAnswerOf({ ...playing, press: pressOf('>') }).answer).toBeNull()
    expect(keyAnswerOf({ ...playing, press: pressOf('a') }).answer).toBeNull()
    expect(keyAnswerOf({ ...playing, press: { ...pressOf('k'), metaKey: true } }).answer).toBeNull()
  })
})
