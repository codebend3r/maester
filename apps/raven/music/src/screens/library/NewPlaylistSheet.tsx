import { useRouter } from 'expo-router'
import { View } from 'react-native'

import { LIBRARY_PAGE_COPY, NEW_PLAYLIST_COPY } from '@raven/wren'
import { WREN_PAGES, pageHref } from '@/routes'
import { useToast } from '@/stores/toast'
import { themedStyles } from '@/theme/wrenTheme'
import { SPACE } from '@/theme/wrenTokens'
import { BottomSheet } from '@/ui/BottomSheet'
import { NewPlaylistForm } from '@/ui/NewPlaylistForm'
import type { WrenSession } from '@/useWren'

const useStyles = themedStyles(() => ({
  body: { padding: SPACE.s3 },
}))

type NewPlaylistSheetProps = {
  session: WrenSession
  isOpen: boolean
  onClose: () => void
}

/** A sheet asking a new playlist's name; Create makes it, says so and opens its page. */
export function NewPlaylistSheet({ session, isOpen, onClose }: NewPlaylistSheetProps) {
  const styles = useStyles()
  const router = useRouter()
  return (
    <BottomSheet head={{ title: NEW_PLAYLIST_COPY.title }} isOpen={isOpen} onClose={onClose}>
      <View style={styles.body}>
        <NewPlaylistForm
          onCreated={(playlist) => {
            useToast.getState().show(LIBRARY_PAGE_COPY.created(playlist.name))
            onClose()
            router.push(pageHref({ page: WREN_PAGES.playlist, id: playlist.id }))
          }}
          session={session}
        />
      </View>
    </BottomSheet>
  )
}
