import type { Transport } from '@/apiClient/transport'
import { CAPTION_PATHS, type CaptionStyle, isCaptionStyle } from '@/contract'

/** How an account's subtitles look, kept on the server so every device draws them the same. */
export const captionCalls = ({ send, expect }: Transport) => ({
  /** The account's subtitle size and colour; the defaults until it picks. */
  getCaptionStyle: (): Promise<CaptionStyle> =>
    expect({ request: send({ path: CAPTION_PATHS.style }), guard: isCaptionStyle }),

  /** Changes the account's subtitle size and colour, and answers with them as kept. */
  setCaptionStyle: (style: CaptionStyle): Promise<CaptionStyle> =>
    expect({
      request: send({ path: CAPTION_PATHS.style, method: 'PUT', body: style }),
      guard: isCaptionStyle,
    }),
})
