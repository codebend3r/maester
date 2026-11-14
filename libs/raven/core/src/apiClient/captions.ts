import type { Transport } from '@/apiClient/transport'
import { ROUTES } from '@/routes'
import { type CaptionStyle } from '@/contract'

/** How an account's subtitles look, kept on the server so every device draws them the same. */
export const captionCalls = ({ ask }: Transport) => ({
  /** The account's subtitle size and colour; the defaults until it picks. */
  getCaptionStyle: (): Promise<CaptionStyle> => ask({ route: ROUTES.getCaptionStyle }),

  /** Changes the account's subtitle size and colour, and answers with them as kept. */
  setCaptionStyle: (style: CaptionStyle): Promise<CaptionStyle> =>
    ask({ route: ROUTES.setCaptionStyle, body: style }),
})
