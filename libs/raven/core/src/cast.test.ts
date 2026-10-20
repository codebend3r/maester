import { describe, expect, it } from 'bun:test'
import { castMembers, initialsOf } from '@/cast'
import { CREDIT_JOBS } from '@/contract'

describe('castMembers', () => {
  it('lists someone who acts and directs once, with both roles', () => {
    expect(
      castMembers([
        {
          personId: 1,
          name: 'Mark Kimball',
          job: CREDIT_JOBS.cast,
          role: 'Rudy',
          photoVersion: 'k1',
        },
        { personId: 2, name: 'Ana Ortiz', job: CREDIT_JOBS.cast, role: 'Lena', photoVersion: null },
        {
          personId: 1,
          name: 'Mark Kimball',
          job: CREDIT_JOBS.director,
          role: 'Director',
          photoVersion: 'k1',
        },
        {
          personId: 3,
          name: 'Jo Park',
          job: CREDIT_JOBS.writer,
          role: 'Screenplay',
          photoVersion: null,
        },
      ]).map((member) => [member.name, member.roles]),
    ).toEqual([
      ['Mark Kimball', ['Rudy', 'Director']],
      ['Ana Ortiz', ['Lena']],
      ['Jo Park', ['Screenplay']],
    ])
  })

  it('names the job where TMDB gives no role', () => {
    expect(
      castMembers([
        { personId: 4, name: 'Sam Lee', job: CREDIT_JOBS.guest, role: null, photoVersion: null },
      ]).map((member) => member.roles),
    ).toEqual([['Guest star']])
  })
})

describe('initialsOf', () => {
  it("takes the first letters of a name's first two words", () => {
    expect(initialsOf('Ana Ortiz')).toBe('AO')
    expect(initialsOf('  Mary  Jo Kate ')).toBe('MJ')
    expect(initialsOf('Cher')).toBe('C')
  })
})
