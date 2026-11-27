import { type RecentSearch, isRecentPage } from '@raven/wren'
import { useRouter } from 'expo-router'

import { recentPageHref } from '@/routes'
import { useRecentSearches } from '@/stores/recentSearches'

type UseOpenRecentProps = {
  /** Searches the words again, for a recent search of words. */
  onSearch: (text: string) => void
}

/**
 * What pressing a recent search does: it moves to the top of the list, then an artist or an
 * album opens its page and words are searched again.
 */
export const useOpenRecent = ({ onSearch }: UseOpenRecentProps) => {
  const router = useRouter()
  const remember = useRecentSearches((state) => state.remember)
  return (recent: RecentSearch): void => {
    remember(recent)
    if (isRecentPage(recent)) {
      router.push(recentPageHref(recent))
      return
    }
    onSearch(recent.text)
  }
}
