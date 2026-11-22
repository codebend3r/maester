import { describe, expect, it } from 'bun:test'

import { aboutFactsOf, hasAbout } from '@/artistAbout'

const DRAKE = {
  bio: 'Aubrey Drake Graham is a Canadian rapper.',
  birthName: 'Aubrey Drake Graham',
  born: '1986-10-24',
  birthplace: 'Toronto',
  nationality: ['Canada', 'United States'],
  awards: ['Grammy Award for Best Rap Album', 'Juno Award'],
}

describe('aboutFactsOf', () => {
  it('lists the birth name, the birthday in words, the birthplace, the countries and the awards', () => {
    expect(aboutFactsOf(DRAKE)).toEqual([
      { label: 'Birth name', value: 'Aubrey Drake Graham' },
      { label: 'Born', value: 'October 24, 1986' },
      { label: 'Birthplace', value: 'Toronto' },
      { label: 'Nationality', value: 'Canada, United States' },
      { label: 'Awards', value: 'Grammy Award for Best Rap Album, Juno Award' },
    ])
  })

  it('leaves out what is not known', () => {
    expect(
      aboutFactsOf({ ...DRAKE, birthName: null, birthplace: null, nationality: [], awards: [] }),
    ).toEqual([{ label: 'Born', value: 'October 24, 1986' }])
  })
})

describe('hasAbout', () => {
  it('is false only when nothing at all is known', () => {
    expect(hasAbout(DRAKE)).toBe(true)
    expect(
      hasAbout({
        bio: null,
        birthName: null,
        born: null,
        birthplace: null,
        nationality: [],
        awards: [],
      }),
    ).toBe(false)
  })
})
