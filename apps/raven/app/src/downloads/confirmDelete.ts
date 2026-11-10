import { Alert } from 'react-native'

import { DOWNLOAD_COPY } from '@/downloads/copy'

type ConfirmDeleteProps = {
  /** What is about to go, named in the alert's title; null for every download on the device. */
  name: string | null
  onDelete: () => void
}

/** The one alert every delete of a download goes through: Keep, or Delete download. */
export const confirmDelete = ({ name, onDelete }: ConfirmDeleteProps): void =>
  Alert.alert(
    name === null ? DOWNLOAD_COPY.deleteAllAsk : DOWNLOAD_COPY.deleteTitle(name),
    undefined,
    [
      { text: DOWNLOAD_COPY.keep, style: 'cancel' },
      { text: DOWNLOAD_COPY.deleteDownload, style: 'destructive', onPress: onDelete },
    ],
  )
