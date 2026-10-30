import { useRouter } from 'expo-router'
import type { ReactNode } from 'react'
import { ScrollView } from 'react-native'

import { IconButton } from '@/components/Controls'
import { Notice } from '@/components/Notice'
import { pageStyles, usePageTop } from '@/components/TabPage'
import { WREN_ICONS } from '@/theme/icons'

const BACK = 'Back'

type DetailPageProps = { children: ReactNode }

/** A page a listing opens, an album, an artist or a playlist, with the way back at its top. */
export function DetailPage({ children }: DetailPageProps) {
  const router = useRouter()
  const top = usePageTop()
  return (
    <ScrollView
      contentContainerStyle={[pageStyles.content, { paddingTop: top }]}
      style={pageStyles.ground}
    >
      <IconButton icon={WREN_ICONS.back} label={BACK} onPress={() => router.back()} />
      {children}
    </ScrollView>
  )
}

type DetailNoticeProps = { text: string }

/** A page that has nothing to show yet, or will not: what it says, and the way back. */
export function DetailNotice({ text }: DetailNoticeProps) {
  return (
    <DetailPage>
      <Notice text={text} />
    </DetailPage>
  )
}
