import { describe, expect, it } from 'vitest'
import {
  activeCues,
  cueRuns,
  mergeCues,
  parseWebVtt,
  subtitleWindowRange,
  subtitleWindows,
} from '@/subtitles'

describe('parseWebVtt', () => {
  it('reads cues with and without hours, identifiers and settings', () => {
    const vtt = [
      'WEBVTT',
      '',
      'NOTE made by ffmpeg',
      '',
      'STYLE',
      '::cue { color: red }',
      '',
      '00:01.000 --> 00:03.500',
      'First <i>line</i>',
      '',
      'intro-2',
      '01:02:03.250 --> 01:02:05.000 line:10% align:start',
      'Second',
      'two lines',
      '',
    ].join('\n')
    expect(parseWebVtt(vtt)).toEqual([
      { start: 1, end: 3.5, text: 'First <i>line</i>' },
      { start: 3723.25, end: 3725, text: 'Second\ntwo lines' },
    ])
  })

  it('accepts CRLF, a byte order mark, and SRT commas', () => {
    const vtt = '﻿WEBVTT\r\n\r\n1\r\n00:00:02,000 --> 00:00:04,000\r\nHi\r\n'
    expect(parseWebVtt(vtt)).toEqual([{ start: 2, end: 4, text: 'Hi' }])
  })

  it('drops empty and backwards cues, and sorts what is left', () => {
    const vtt = [
      'WEBVTT',
      '',
      '00:10.000 --> 00:11.000',
      'Later',
      '',
      '00:05.000 --> 00:04.000',
      'Backwards',
      '',
      '00:06.000 --> 00:07.000',
      '',
      '00:01.000 --> 00:02.000',
      'Sooner',
    ].join('\n')
    expect(parseWebVtt(vtt).map((cue) => cue.text)).toEqual(['Sooner', 'Later'])
  })
})

describe('subtitle windows', () => {
  it('starts each window ten seconds early, except the first', () => {
    expect(subtitleWindowRange(0)).toEqual({ start: 0, duration: 300 })
    expect(subtitleWindowRange(2)).toEqual({ start: 590, duration: 310 })
  })

  it('asks for the next window a minute before it is needed', () => {
    expect(subtitleWindows({ time: 100, duration: 5000 })).toEqual([0])
    expect(subtitleWindows({ time: 240, duration: 5000 })).toEqual([0, 1])
    expect(subtitleWindows({ time: 601, duration: 5000 })).toEqual([2])
  })

  it('never asks past the end of the file', () => {
    expect(subtitleWindows({ time: 550, duration: 590 })).toEqual([1])
    expect(subtitleWindows({ time: 550, duration: null })).toEqual([1, 2])
  })
})

describe('mergeCues and activeCues', () => {
  const a = { start: 1, end: 2, text: 'a' }
  const b = { start: 3, end: 6, text: 'b' }
  const c = { start: 4, end: 5, text: 'c' }

  it('keeps one copy of a cue two windows both carry', () => {
    expect(mergeCues({ existing: [a, b], incoming: [b, c] })).toEqual([a, b, c])
  })

  it('finds every cue on screen at a time', () => {
    expect(activeCues({ cues: [a, b, c], time: 4.5 })).toEqual([b, c])
    expect(activeCues({ cues: [a, b, c], time: 2 })).toEqual([])
  })
})

describe('cueRuns', () => {
  const plain = { italic: false, bold: false, underline: false }

  it('keeps italic, bold and underline and drops every other tag', () => {
    expect(cueRuns('<v Joe>Well, <i>maybe</i> <b><u>not</u></b><c.yellow>!</c>')).toEqual([
      { ...plain, text: 'Well, ' },
      { ...plain, italic: true, text: 'maybe' },
      { ...plain, text: ' ' },
      { ...plain, bold: true, underline: true, text: 'not' },
      { ...plain, text: '!' },
    ])
  })

  it('decodes entities and strips leftover ASS overrides', () => {
    expect(cueRuns('{\\an8}Fish &amp; chips&nbsp;&lt;3')).toEqual([
      { ...plain, text: 'Fish & chips <3' },
    ])
  })

  it('survives an unbalanced closing tag', () => {
    expect(cueRuns('</i>fine')).toEqual([{ ...plain, text: 'fine' }])
  })
})
