import {
  type AudioDevice,
  carriesPassthrough,
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  type OutputSettings,
} from '@raven/core'
import { useQuery } from '@tanstack/react-query'
import { type DesktopClient, refusalText } from '@/desktop/client'
import { DESKTOP_QUERY_KEYS } from '@/desktop/queryKeys'
import { useDesktop } from '@/stores/desktop'

const UNREADABLE = 'raven player could not read its sound settings.'

/** How raven player sends sound from this Mac, the devices it can send it to, and whether mpv runs. */
export type OutputRead = { output: OutputSettings; devices: AudioDevice[]; isEngineReady: boolean }

/** Main's sound output, read once: Settings writes it back into the cache as it changes. */
export const outputQuery = (client: DesktopClient) => ({
  queryKey: DESKTOP_QUERY_KEYS.output,
  queryFn: async (): Promise<OutputRead> => {
    const reply = await client.request({ type: DESKTOP_REQUESTS.readOutput })
    if (reply.type === DESKTOP_REPLIES.output) return reply
    throw new Error(refusalText({ reply, fallback: UNREADABLE }))
  },
  staleTime: Infinity,
  retry: false,
})

/**
 * Whether "This computer" sends the bitstream untouched, which leaves mpv's volume nothing to
 * do. Until main answers, or when it cannot, the volume stays free, as the default profile has it.
 */
export const useIsOutputFixed = (): boolean => {
  const { client } = useDesktop()
  const output = useQuery(outputQuery(client)).data?.output ?? null
  return output !== null && carriesPassthrough(output)
}
