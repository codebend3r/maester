import { useQuery } from '@tanstack/react-query'
import { ITEM_TYPES, type ItemDetails, bingeCardFacts, itemPath } from '@raven/core'
import { bingeStatusWords } from '@/components/BingeCard/bingeStatus'
import { itemQuery, nextEpisodeQuery } from '@/lib/queries'

type UseBingeFactsProps = { details: ItemDetails }

/**
 * What a binged title shows wherever it is drawn, a card or a row: its
 * facts, the video it resumes (a show's next episode), how far along it is
 * in words, its page and its year and length as one line's parts.
 */
export const useBingeFacts = ({ details }: UseBingeFactsProps) => {
  const isShow = details.type === ITEM_TYPES.show
  const next = useQuery({ ...nextEpisodeQuery(details.id), enabled: isShow })
  const episodeId = isShow ? (next.data?.item?.id ?? null) : null
  const episode = useQuery(itemQuery(episodeId))
  const facts = bingeCardFacts({
    details,
    next: next.data ?? null,
    episode: episode.data ?? null,
  })
  return {
    facts,
    media: next.data ?? null,
    status: bingeStatusWords(facts.status),
    page: itemPath(details) ?? '/',
    meta: [facts.year, facts.runtime].filter((fact): fact is string => fact != null),
  }
}
