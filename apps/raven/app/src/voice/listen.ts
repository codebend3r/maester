import { requireOptionalNativeModule } from 'expo'

/** Android's speech module (`modules/raven-voice`); absent on Apple devices, whose keyboard dictates. */
type RavenVoice = {
  isAvailable: () => boolean
  listen: (prompt: string) => Promise<unknown>
}

const voice = requireOptionalNativeModule<RavenVoice>('RavenVoice')

/** Whether the device can hear an answer: the module is there and has a recognizer to ask. */
export const CAN_LISTEN = voice?.isAvailable() ?? false

type ListenProps = { prompt: string }

/**
 * What the system's recognizer heard, or null when nothing was said, it was cancelled, or the
 * device could not listen: every way it ends is an answer, so a caller has nothing to catch.
 */
export const listen = async ({ prompt }: ListenProps): Promise<string | null> => {
  const heard = await (voice?.listen(prompt) ?? Promise.resolve(null)).catch(() => null)
  return typeof heard === 'string' ? heard : null
}
