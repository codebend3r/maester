import { describe, expect, it } from 'vitest'
import { birthNameOf, bornOf } from '@/music/artistAbout'
import { entityIdsOf } from '@/music/wikidata'

const snak = (value: unknown) => ({ mainsnak: { datavalue: { value } } })

const CLAIMS = {
  P1477: [snak({ text: 'Aubrey Drake Graham', language: 'en' })],
  P569: [snak({ time: '+1986-10-24T00:00:00Z', precision: 11 })],
  P19: [snak({ id: 'Q172' })],
  P27: [snak({ id: 'Q16' }), snak({ id: 'Q30' })],
  P166: [snak({ id: 'Q41254' }), snak({ id: 'Q1' }), snak({ id: 'Q41254' })],
}

describe('the Wikidata claims of an artist', () => {
  it('reads the birth name, the birthday, and each birthplace, country and award once', () => {
    expect(birthNameOf({ claims: CLAIMS })).toBe('Aubrey Drake Graham')
    expect(bornOf({ claims: CLAIMS })).toBe('1986-10-24')
    expect(entityIdsOf({ claims: CLAIMS, property: 'P166' })).toEqual(['Q41254', 'Q1'])
    expect(entityIdsOf({ claims: CLAIMS, property: 'P19' })).toEqual(['Q172'])
    expect(entityIdsOf({ claims: CLAIMS, property: 'P27' })).toEqual(['Q16', 'Q30'])
  })

  it('leaves out a birthday known only to the year, and what is not there', () => {
    const claims = { P569: [snak({ time: '+1986-00-00T00:00:00Z', precision: 9 })] }
    expect(bornOf({ claims })).toBeNull()
    expect(birthNameOf({ claims })).toBeNull()
    expect(entityIdsOf({ claims, property: 'P166' })).toEqual([])
  })
})
