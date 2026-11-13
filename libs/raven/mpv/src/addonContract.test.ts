import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { REMOTE_COMMANDS } from '@raven/core'
import { MPV_END_FILE_REASONS, MPV_EVENTS, MPV_TIME_THROTTLE_MS, NATIVE_MESSAGES } from '@/mpv'
import { MPV_OPTIONS } from '@/options'
import { MPV_CHOICES, MPV_PROPERTIES } from '@/properties'

/*
 * The addon is C++ and cannot import these constants, so this reads its source and holds the
 * words it sends to the ones the wrapper guards against: a renamed event fails here, not at run
 * time on a Mac.
 */
const addon = readFileSync(resolve(import.meta.dir, '..', 'native', 'addon.cpp'), 'utf8')

const quotedAfter = (marker: string): string[] =>
  [...addon.matchAll(new RegExp(`${marker}"([^"]+)"`, 'gu'))].map((match) => match[1] ?? '')

describe('the addon and the wrapper', () => {
  test('name the same messages and events', () => {
    const sent = new Set(quotedAfter('result\\.Set\\("type", '))
    // `error` is the wrapper's own, for a message the addon never sends.
    const expected = new Set([
      NATIVE_MESSAGES.reply,
      ...Object.values(MPV_EVENTS).filter((type) => type !== MPV_EVENTS.error),
    ])
    expect(sent).toEqual(expected)
  })

  test('name the same end-file reasons', () => {
    const block = /result\.Set\("reason",([^;]+);/u.exec(addon)?.[1] ?? ''
    const reasons = new Set([...block.matchAll(/"([^"]+)"/gu)].map((match) => match[1]))
    expect(reasons).toEqual(new Set(Object.values(MPV_END_FILE_REASONS)))
  })

  test('throttle time-pos by the same interval', () => {
    expect(addon).toContain(`strcmp(property->name, "${MPV_PROPERTIES.timePos}")`)
    expect(addon).toContain(`std::chrono::milliseconds(${MPV_TIME_THROTTLE_MS})`)
  })

  test('the seek remote command carries its time', () => {
    expect(addon).toContain(`command.name == "${REMOTE_COMMANDS.seek}"`)
  })

  test('the audio surface starts with replaygain off, as each track asks', () => {
    expect(addon).toContain(`option("${MPV_OPTIONS.replaygain}", "${MPV_CHOICES.no}")`)
  })
})
