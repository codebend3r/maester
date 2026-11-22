import { type ListState, isListLoading, listNoticeOf } from '@raven/wren'
import type { ComponentType } from 'react'
import { ListSkeleton, type ListShape } from '@/components/ListSkeleton/ListSkeleton'
import { Notice } from '@/components/Notice/Notice'

type ListNoticeProps = {
  listing: ListState
  empty: string
  /** The shape of the entries on their way, which the stand-ins take while the list is read. */
  shape: ListShape
}

const LIST_NOTICE_KEYS = { loading: 'loading', words: 'words' } as const

type ListNoticeKey = (typeof LIST_NOTICE_KEYS)[keyof typeof LIST_NOTICE_KEYS]

const LoadingNotice = ({ shape }: ListNoticeProps) => <ListSkeleton shape={shape} />

const WordsNotice = ({ listing, empty }: ListNoticeProps) => (
  <Notice text={listNoticeOf({ listing, empty })} />
)

const LIST_NOTICE_VIEWS = {
  [LIST_NOTICE_KEYS.loading]: LoadingNotice,
  [LIST_NOTICE_KEYS.words]: WordsNotice,
} as const satisfies Record<ListNoticeKey, ComponentType<ListNoticeProps>>

/** A list's notice, standing where its entries would: stand-ins in their shape while it is read, else its words. */
export function ListNotice(props: ListNoticeProps) {
  const key = isListLoading(props.listing) ? LIST_NOTICE_KEYS.loading : LIST_NOTICE_KEYS.words
  const View = LIST_NOTICE_VIEWS[key]
  return <View {...props} />
}
