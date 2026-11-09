import { useRouter } from 'expo-router'

import { BingeShelf, ShelfPage } from '@/layouts'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { useBingeIds } from '@/queries/useBinge'
import { useBingeCards } from '@/queries/useBingeCards'
import { usePictures } from '@/queries/usePictures'
import { hrefOf } from '@/routes'
import { BINGE_PAGE_COPY } from '@/screens/copy'

type ServerBingeProps = { session: AppQueries }

const ServerBinge = ({ session }: ServerBingeProps) => {
  const { server, api, queries } = session
  const router = useRouter()
  const pictures = usePictures({ server, api })
  const ids = useBingeIds()
  const cards = useBingeCards({ queries, pictures })
  return (
    <ShelfPage
      note={ids.length === 0 ? BINGE_PAGE_COPY.none : null}
      onBack={() => router.back()}
      title={BINGE_PAGE_COPY.title}
    >
      {cards.length > 0 && (
        <BingeShelf cards={cards} isFirst onOpen={(target) => router.push(hrefOf(target))} />
      )}
    </ShelfPage>
  )
}

/**
 * `/binge`: the shows the account binges, at most `BINGE_LIMIT`, as Home's Binge section draws
 * them, or a word in Young Serif that none is set. A card plays the episode it is on and its
 * title art opens the show's page. Each server gets a page of its own.
 */
export const Binge = () => {
  const session = useAppQueries()
  return session !== null && <ServerBinge key={session.server.id} session={session} />
}
