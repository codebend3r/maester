import { NOTICE_KINDS, type NoticeKind } from '@/lib/events'

export const NOTICE_LIST_COPY = {
  label: 'Notices',
  to: (name: string) => ` to ${name}`,
  headings: {
    [NOTICE_KINDS.adminPost]: 'To the admin',
    [NOTICE_KINDS.directMessage]: 'Direct message',
  } as const satisfies Record<NoticeKind, string>,
} as const
