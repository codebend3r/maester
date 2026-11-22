import { type ListState, listNoticeOf } from '@raven/wren'
import { Notice } from '@/components/Notice/Notice'

type ListNoticeProps = { listing: ListState; empty: string }

/** A list's notice, standing where its entries would. */
export function ListNotice(props: ListNoticeProps) {
  return <Notice text={listNoticeOf(props)} />
}
