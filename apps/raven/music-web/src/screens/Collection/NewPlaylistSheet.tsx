import { LIBRARY_PAGE_COPY, NEW_PLAYLIST_COPY } from '@raven/wren'
import { useNavigate } from 'react-router-dom'
import { playlistPath } from '@/routes'
import { useToast } from '@/stores/toast'
import { BottomSheet } from '@/ui/BottomSheet/BottomSheet'
import { NewPlaylistForm } from '@/ui/NewPlaylistForm/NewPlaylistForm'
import styles from '@/screens/Collection/NewPlaylistSheet.module.scss'

type NewPlaylistSheetProps = {
  isOpen: boolean
  onClose: () => void
}

/** A sheet asking a new playlist's name; Create makes it, says so and opens its page. */
export function NewPlaylistSheet({ isOpen, onClose }: NewPlaylistSheetProps) {
  const navigate = useNavigate()
  return (
    <BottomSheet head={{ title: NEW_PLAYLIST_COPY.title }} isOpen={isOpen} onClose={onClose}>
      <div className={styles.body}>
        <NewPlaylistForm
          onCreated={(playlist) => {
            useToast.getState().show(LIBRARY_PAGE_COPY.created(playlist.name))
            onClose()
            navigate(playlistPath(playlist.id))
          }}
        />
      </div>
    </BottomSheet>
  )
}
