import { type Artist, plural } from '@raven/core'

import { COUNT_COPY } from '@/screens/copy'

type ArtistFactsOfProps = { artist: Pick<Artist, 'albumCount' | 'trackCount'> }

/** An artist's albums and tracks on one line: "3 albums · 41 tracks". */
export const artistFactsOf = ({ artist }: ArtistFactsOfProps): string =>
  COUNT_COPY.facts([
    plural({ n: artist.albumCount, ...COUNT_COPY.albums }),
    plural({ n: artist.trackCount, ...COUNT_COPY.tracks }),
  ])
