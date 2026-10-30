import { plural } from '@raven/core'

const count = new Intl.NumberFormat()

export const LIBRARIES_COPY = {
  libraries: (n: number) => plural({ n, one: 'library', many: 'libraries' }),
  pinnedTitle:
    'Pinned: this library has its own link in the side menu and a row on Home. Press to unpin it.',
  pinTitle: 'Pin this library: give it its own link in the side menu and a row on Home.',
  pinned: 'Pinned',
  pin: 'Pin',
  pinName: (name: string) => `Pin ${name}`,
  heroLockedTitle: 'A locked library never shows in the hero',
  heroTitle: "Let Home's hero show this library's movies and shows",
  includeInHero: 'Include in hero display',
  heroFor: (name: string) => ` for ${name}`,
  locked: ' · Locked',
  unlocked: ' · Unlocked',
  notMatched: (n: number) => ` · ${count.format(n)} not matched`,
  collapse: (name: string) => `Collapse ${name}`,
  expand: (name: string) => `Expand ${name}`,
  showLess: 'Show less',
  showMore: 'Show its folders, scan and actions',
  folders: 'Folders',
  gathering: 'Gathering your libraries',
  noAnswer: 'The server did not answer',
  askAgain: 'Ask the server for the libraries again',
  tryAgain: 'Try again',
  emptyTitle: 'Point raven at your videos',
  emptyBody:
    'A library is a set of folders. Pick the ones that hold your movies or shows, and every video inside is indexed, given a thumbnail, and ready to play.',
  addTitle: 'Add a library: a name, a type and the folders that hold its videos',
  addAction: 'add a library',
  saveOrderTitle: 'Save the order and show the libraries in full again',
  editOrderTitle: 'Drag the libraries into the order they list in',
  finish: 'Finish',
  editOrder: 'Edit order',
  inOrder: 'Libraries, in order',
  moveUp: (name: string) => `Move ${name} up`,
  moveDown: (name: string) => `Move ${name} down`,
} as const
