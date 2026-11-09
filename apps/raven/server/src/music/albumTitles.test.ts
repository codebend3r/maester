import { describe, expect, it } from 'vitest'
import { folderFactsOf, isSamePlainTitle, plainAlbumTitle } from '@/music/albumTitles'

describe('plainAlbumTitle', () => {
  it.each([
    ["Pac's Life (Bonus Track)", "Pac's Life"],
    ['Konvicted (Platinum Edition)', 'Konvicted'],
    ['My Everything: Tenth Anniversary Edition', 'My Everything'],
    ['Doo-Wops & Hooligans Deluxe Edition', 'Doo-Wops & Hooligans'],
    ['Under Pressure (Deluxe) [Explicit Lyrics]', 'Under Pressure'],
    ['Emotions CDM', 'Emotions'],
    ['Brothers 10th Anniversary Edition', 'Brothers'],
    ['Ohio Players: Trophy Edition', 'Ohio Players'],
    ['Bizarre_Ride_II_The_Pharcyde_(25th_Anniversary_Edition)', 'Bizarre Ride II The Pharcyde'],
    ['Disc 1: Havoc And Bright Lights', 'Havoc And Bright Lights'],
    ['Back to Black 2CD (Deluxe Edition)', 'Back to Black'],
    ['Let It Be (Super Deluxe) Disc 1', 'Let It Be'],
    ['Rated R [Japanese Reissue Remastered 2010]', 'Rated R'],
  ])('takes the edition off "%s"', (title, plain) => {
    expect(plainAlbumTitle(title)).toBe(plain)
  })

  it.each([
    "(What's the Story) Morning Glory?",
    'Strictly 4 My N.I.G.G.A.Z',
    "Revenge Of The Dreamers III: Director's Cut",
    'Deluxe',
  ])('keeps "%s", whose words are its name', (title) => {
    expect(plainAlbumTitle(title)).toBe(title)
  })
})

describe('folderFactsOf', () => {
  it('reads an "Artist - Title (Year)" folder, a disc folder\'s parent and a bare one', () => {
    expect(folderFactsOf("/music/2Pac/2Pac - Pac's Life (2006)/01.flac")).toEqual({
      artist: '2Pac',
      title: "Pac's Life",
      year: 2006,
    })
    expect(
      folderFactsOf('/music/Queen/Queen - Live at Wembley Stadium (2011)/Digital Media 02/01.flac'),
    ).toEqual({ artist: 'Queen', title: 'Live at Wembley Stadium', year: 2011 })
    expect(folderFactsOf('/music/Radiohead/OK Computer/01.flac')).toEqual({
      artist: null,
      title: 'OK Computer',
      year: null,
    })
  })
})

describe('isSamePlainTitle', () => {
  it('holds two editions of a title as one, and two titles apart', () => {
    expect(isSamePlainTitle({ a: 'Wonder (Deluxe)', b: 'wonder' })).toBe(true)
    expect(isSamePlainTitle({ a: 'Wonder', b: 'Illuminate' })).toBe(false)
  })
})
