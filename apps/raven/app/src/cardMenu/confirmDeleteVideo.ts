import { Alert } from 'react-native'

import { CARD_MENU_COPY } from '@/cardMenu/menuOptions'

type ConfirmDeleteVideoProps = {
  /** The video as its card names it, in the alert's title. */
  name: string
  /** The file that goes, named since a movie's copies share a title. */
  fileName: string
  /** Deletes it; a rejection is told in an alert of its own. */
  onDelete: () => Promise<unknown>
}

/**
 * The alert the owner's delete goes through: Keep, or Delete for good. The file leaves the
 * server's disk, so nothing is deleted on the menu's press alone, and a delete the server
 * refuses says why.
 */
export const confirmDeleteVideo = ({ name, fileName, onDelete }: ConfirmDeleteVideoProps): void =>
  Alert.alert(CARD_MENU_COPY.deleteAsk(name), `${fileName}\n\n${CARD_MENU_COPY.deleteHint}`, [
    { text: CARD_MENU_COPY.keep, style: 'cancel' },
    {
      text: CARD_MENU_COPY.deleteForGood,
      style: 'destructive',
      onPress: () => {
        onDelete().catch((error: unknown) =>
          Alert.alert(
            CARD_MENU_COPY.deleteFailed(name),
            error instanceof Error ? error.message : undefined,
          ),
        )
      },
    },
  ])
