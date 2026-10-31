import { StyleSheet, Text } from 'react-native'

import { PALETTE, SIZES } from '@/theme/wrenTheme'

/** Whether a page shows what it lists, or a notice in its place. */
export const NOTICE_STATES = { notice: 'notice', ready: 'ready' } as const

export type NoticeState = (typeof NOTICE_STATES)[keyof typeof NOTICE_STATES]

/** Whether `notice` stands in for what the page lists. */
export const noticeStateOf = (notice: string | null): NoticeState =>
  notice === null ? NOTICE_STATES.ready : NOTICE_STATES.notice

type NoticeProps = { text: string }

/** What a page says in place of what it lists: that it is loading, empty, or could not be read. */
export function Notice({ text }: NoticeProps) {
  return (
    <Text accessibilityLiveRegion="polite" style={styles.notice}>
      {text}
    </Text>
  )
}

type MaybeNoticeProps = { notice: string | null }

/** The notice a page has in place of its list, if it has one. */
export function MaybeNotice({ notice }: MaybeNoticeProps) {
  return notice !== null && <Notice text={notice} />
}

const styles = StyleSheet.create({
  notice: { color: PALETTE.muted, fontSize: SIZES.text },
})
