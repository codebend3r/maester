import { type ListState, isListLoading, listNoticeOf } from '@raven/wren'
import type { ComponentType } from 'react'
import { Text } from 'react-native'

import { TYPE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { Loading } from '@/ui/Loading'

const useStyles = themedStyles(({ colors }) => ({ notice: { ...TYPE.body, color: colors.text2 } }))

type ListNoticeProps = {
  listing: ListState
  /** What the list says when it holds nothing. */
  empty: string
}

const LIST_NOTICE_KEYS = { loading: 'loading', words: 'words' } as const

type ListNoticeKey = (typeof LIST_NOTICE_KEYS)[keyof typeof LIST_NOTICE_KEYS]

function WordsNotice({ listing, empty }: ListNoticeProps) {
  const styles = useStyles()
  return (
    <Text accessibilityLiveRegion="polite" style={styles.notice}>
      {listNoticeOf({ listing, empty })}
    </Text>
  )
}

const LIST_NOTICE_VIEWS = {
  [LIST_NOTICE_KEYS.loading]: Loading,
  [LIST_NOTICE_KEYS.words]: WordsNotice,
} as const satisfies Record<ListNoticeKey, ComponentType<ListNoticeProps>>

const noticeKeyOf = (listing: ListState): ListNoticeKey =>
  isListLoading(listing) ? LIST_NOTICE_KEYS.loading : LIST_NOTICE_KEYS.words

/**
 * A list's notice, standing where its entries would: Loading while it is read, else its words in
 * `@raven/wren`'s `listNoticeOf`, why it could not be read or that it holds nothing.
 */
export function ListNotice(props: ListNoticeProps) {
  const Body = LIST_NOTICE_VIEWS[noticeKeyOf(props.listing)]
  return <Body {...props} />
}
