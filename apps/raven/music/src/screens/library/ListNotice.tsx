import { Notice } from '@/components/Notice'
import type { ListState } from '@/music/merged'
import { LIBRARY_COPY } from '@/music/musicLibraries'
import { LIBRARY_PAGE_COPY } from '@/screens/copy'
import { KIT_COPY } from '@/ui/copy'

type ListNoticeOfProps = { listing: ListState; empty: string }

/**
 * What a list says in place of its entries: that it could not be read, that it is, that raven
 * holds no music, or that it is empty.
 */
const listNoticeOf = ({
  listing: { failure, isRead, hasNoMusic },
  empty,
}: ListNoticeOfProps): string => {
  if (failure !== null) return LIBRARY_PAGE_COPY.failed
  if (!isRead) return KIT_COPY.loading
  return hasNoMusic ? LIBRARY_COPY.noMusic : empty
}

type ListNoticeProps = ListNoticeOfProps

/** A list's notice, standing where its entries would. */
export function ListNotice(props: ListNoticeProps) {
  return <Notice text={listNoticeOf(props)} />
}
