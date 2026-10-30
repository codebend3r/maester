import { ROUTE_STATES, routeState } from '@raven/core'
import { useRouter } from 'expo-router'
import type { ReactNode } from 'react'
import { ScrollView } from 'react-native'

import { IconButton } from '@/components/Controls'
import { Notice } from '@/components/Notice'
import { pageStyles, usePageTop } from '@/components/TabPage'
import { WREN_ICONS } from '@/theme/icons'

const BACK = 'Back'

/** The way back from a page a listing opened. */
export function BackButton() {
  const router = useRouter()
  return <IconButton icon={WREN_ICONS.back} label={BACK} onPress={() => router.back()} />
}

type DetailPageProps = { children: ReactNode }

/** A page a listing opens, an album, an artist or a playlist, with the way back at its top. */
export function DetailPage({ children }: DetailPageProps) {
  const top = usePageTop()
  return (
    <ScrollView
      contentContainerStyle={[pageStyles.content, { paddingTop: top }]}
      style={pageStyles.ground}
    >
      <BackButton />
      {children}
    </ScrollView>
  )
}

type DetailNoticeProps = { text: string }

/** A page that has nothing to show yet, or will not: what it says, and the way back. */
function DetailNotice({ text }: DetailNoticeProps) {
  return (
    <DetailPage>
      <Notice text={text} />
    </DetailPage>
  )
}

type DetailRouteProps<T> = {
  /** The id the address names, or null when it names none. */
  id: number | null
  query: Parameters<typeof routeState<T>>[0]['query']
  copy: { opening: string; missing: string }
  children: (data: T) => ReactNode
}

/**
 * A page reading one thing from its address: the page once it is read, else that it is
 * opening, missing from the server, or could not be read, with the way back.
 */
export function DetailRoute<T>({ id, query, copy, children }: DetailRouteProps<T>) {
  const page = routeState({ id, query })
  switch (page.state) {
    case ROUTE_STATES.missing:
      return <DetailNotice text={copy.missing} />
    case ROUTE_STATES.error:
      return <DetailNotice text={page.message} />
    case ROUTE_STATES.loading:
      return <DetailNotice text={copy.opening} />
    case ROUTE_STATES.ready:
      return children(page.data)
    default: {
      const unknown: never = page
      return unknown
    }
  }
}
