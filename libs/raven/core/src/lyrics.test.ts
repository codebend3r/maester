import { describe, expect, it } from 'bun:test'
import { LYRICS_KINDS, LYRICS_SOURCES, NO_LYRICS, isLyrics } from '@/contract/lyrics'
import { lyricsOfText, parseLrc } from '@/lyrics'

describe('parseLrc', () => {
  it('reads each stamped line in seconds, in time order', () => {
    expect(
      parseLrc(['[00:12.50] Second', '[00:01.00]First', '[01:02.345] Third'].join('\n')),
    ).toEqual([
      { at: 1, text: 'First' },
      { at: 12.5, text: 'Second' },
      { at: 62.345, text: 'Third' },
    ])
  })

  it('gives a line with several stamps once for each, and keeps an empty line as a pause', () => {
    expect(parseLrc('[00:05.00][00:20.00]Chorus\r\n[00:10.00]')).toEqual([
      { at: 5, text: 'Chorus' },
      { at: 10, text: '' },
      { at: 20, text: 'Chorus' },
    ])
  })

  it('reads stamps with no fraction or a colon before it', () => {
    expect(parseLrc('[00:03]One\n[00:04:25]Two')).toEqual([
      { at: 3, text: 'One' },
      { at: 4.25, text: 'Two' },
    ])
  })

  it('leaves out tags and untimed lines, and drops word timings', () => {
    expect(
      parseLrc(
        ['[ar:Radiohead]', '[ti:Airbag]', 'no stamp', '[00:02.00]<00:02.00>In <00:02.50>a'].join(
          '\n',
        ),
      ),
    ).toEqual([{ at: 2, text: 'In a' }])
  })

  it('shows every line sooner by the offset, never before the start', () => {
    expect(parseLrc('[offset:+500]\n[00:00.20]Early\n[00:02.00]Later')).toEqual([
      { at: 0, text: 'Early' },
      { at: 1.5, text: 'Later' },
    ])
    expect(parseLrc('[offset:-250]\n[00:01.00]Late')).toEqual([{ at: 1.25, text: 'Late' }])
  })

  it('finds no lines in text with no stamps', () => {
    expect(parseLrc('Just words\nand more')).toEqual([])
  })
})

describe('lyricsOfText', () => {
  it('is synced when the text carries stamps', () => {
    const lyrics = lyricsOfText({ text: '[00:01.00]Hello', source: LYRICS_SOURCES.sidecar })
    expect(lyrics).toEqual({
      kind: LYRICS_KINDS.synced,
      source: LYRICS_SOURCES.sidecar,
      lines: [{ at: 1, text: 'Hello' }],
    })
    expect(isLyrics(lyrics)).toBe(true)
  })

  it('is plain text, trimmed, when it carries none, and none when it is empty', () => {
    expect(lyricsOfText({ text: '  Verse\nChorus \n', source: LYRICS_SOURCES.tags })).toEqual({
      kind: LYRICS_KINDS.plain,
      source: LYRICS_SOURCES.tags,
      text: 'Verse\nChorus',
    })
    expect(lyricsOfText({ text: ' \n ', source: LYRICS_SOURCES.tags })).toEqual(NO_LYRICS)
  })
})

describe('isLyrics', () => {
  it('takes each kind with its own fields, and nothing else', () => {
    expect(isLyrics(NO_LYRICS)).toBe(true)
    expect(isLyrics({ kind: LYRICS_KINDS.plain, source: LYRICS_SOURCES.lrclib, text: 'x' })).toBe(
      true,
    )
    expect(isLyrics({ kind: LYRICS_KINDS.synced, source: LYRICS_SOURCES.lrclib, text: 'x' })).toBe(
      false,
    )
    expect(isLyrics({ kind: LYRICS_KINDS.plain, source: 'radio', text: 'x' })).toBe(false)
  })
})
