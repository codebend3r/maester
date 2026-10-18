import { describe, expect, it } from 'bun:test'
import { BARE_LINK_LABEL, parseRichText } from '@/lib/richText'

describe('parseRichText', () => {
  it('turns Markdown links and bold into their own segments, keeping the text between', () => {
    expect(
      parseRichText(
        '**Dune** is here: [watch it in raven](http://raven.test/movies/277?library=4).',
      ),
    ).toEqual([
      { kind: 'strong', text: 'Dune' },
      { kind: 'text', text: ' is here: ' },
      { kind: 'link', text: 'watch it in raven', href: 'http://raven.test/movies/277?library=4' },
      { kind: 'text', text: '.' },
    ])
  })

  it('links a bare address without spelling it out, leaving the full stop after it', () => {
    expect(parseRichText('See https://raven.test/shows/9?library=7.')).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'link', text: BARE_LINK_LABEL, href: 'https://raven.test/shows/9?library=7' },
      { kind: 'text', text: '.' },
    ])
  })

  it('opens only http and https, and leaves everything else as written', () => {
    expect(parseRichText('[click](javascript:alert(1)) <b>hi</b>')).toEqual([
      { kind: 'text', text: '[click](javascript:alert(1)) <b>hi</b>' },
    ])
    expect(parseRichText('')).toEqual([])
  })
})
