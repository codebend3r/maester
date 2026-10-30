import { PlateButton } from '@/layouts/tvControls'
import { CAN_LISTEN, listen } from '@/voice/listen'
import { LISTEN_COPY } from '@/voice/copy'
import { typedFrom } from '@/voice/spokenText'

type ListenButtonProps = {
  label: string
  isEmail: boolean
  onHeard: (text: string) => void
}

/**
 * Fills a TV field from speech, for a remote with a microphone and no keys: it opens the
 * system's recognizer and types what it heard as the field takes it (`typedFrom`). Drawn only
 * where the device can listen. A secret field gets one too, at the viewer's asking, though the
 * recognizer shows what it heard on screen.
 */
export const ListenButton = ({ label, isEmail, onHeard }: ListenButtonProps) => {
  const hear = async () => {
    const heard = await listen({ prompt: label })
    if (heard !== null) onHeard(typedFrom({ heard, isEmail }))
  }
  return (
    CAN_LISTEN && (
      <PlateButton
        label={LISTEN_COPY.byVoice(label)}
        onPress={() => {
          void hear()
        }}
        text={LISTEN_COPY.byVoice(label)}
      />
    )
  )
}
