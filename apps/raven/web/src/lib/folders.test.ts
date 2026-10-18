import { describe, expect, it } from 'bun:test'
import { foldersByParent } from '@/lib/folders'

describe('foldersByParent', () => {
  it('gives one path one group holding one name', () => {
    expect(foldersByParent(['/media/Movies'])).toEqual([{ parent: '/media', names: ['Movies'] }])
  })

  it('groups the TV Shows library by drive, in the order each first appears', () => {
    expect(
      foldersByParent([
        '/media/vermithor/Media/TV',
        '/media/caraxes/Media/TV',
        '/media/syrax/Media/Sitcoms',
        '/media/vermithor/Media/Mini-Series',
        '/media/meleys/Media/Documentary Shows',
        '/media/caraxes/Media/Reality TV Shows',
        '/media/syrax/Media/Classics',
      ]),
    ).toEqual([
      { parent: '/media/vermithor/Media', names: ['TV', 'Mini-Series'] },
      { parent: '/media/caraxes/Media', names: ['TV', 'Reality TV Shows'] },
      { parent: '/media/syrax/Media', names: ['Sitcoms', 'Classics'] },
      { parent: '/media/meleys/Media', names: ['Documentary Shows'] },
    ])
  })

  it('gives a path straight under the root the parent /', () => {
    expect(foldersByParent(['/media'])).toEqual([{ parent: '/', names: ['media'] }])
  })
})
