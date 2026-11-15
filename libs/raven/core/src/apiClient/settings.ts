import type { Transport } from '@/apiClient/transport'
import { ROUTES } from '@/routes'
import {
  type ScanControlState,
  type DisplaySettings,
  type DisplaySettingsChange,
  type PlaybackSettings,
  type PlaybackSettingsState,
} from '@/contract'

/** The server's settings, set once for every viewer. */
export const settingsCalls = ({ ask }: Transport) => ({
  getScanControl: (): Promise<ScanControlState> => ask({ route: ROUTES.getScanControl }),

  setScanControl: (state: ScanControlState): Promise<ScanControlState> =>
    ask({ route: ROUTES.setScanControl, body: state }),
  /** How the server plays video, and what that comes to on this machine. */
  getPlaybackSettings: (): Promise<PlaybackSettingsState> =>
    ask({ route: ROUTES.getPlaybackSettings }),

  /** Changes one or more playback settings; the rest stay as they are. */
  setPlaybackSettings: (change: Partial<PlaybackSettings>): Promise<PlaybackSettingsState> =>
    ask({ route: ROUTES.setPlaybackSettings, body: change }),

  /** How pages look for every viewer: whether a movie's title shows as its logo. */
  getDisplaySettings: (): Promise<DisplaySettings> => ask({ route: ROUTES.getDisplaySettings }),

  /** Changes one or more display settings; the rest stay as they are. */
  setDisplaySettings: (change: DisplaySettingsChange): Promise<DisplaySettings> =>
    ask({ route: ROUTES.setDisplaySettings, body: change }),
})
