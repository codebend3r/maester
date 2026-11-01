import type { Transport } from '@/apiClient/transport'
import {
  isScanControlState,
  SCAN_CONTROL_PATH,
  type ScanControlState,
  type DisplaySettings,
  type DisplaySettingsChange,
  isDisplaySettings,
  isPlaybackSettingsState,
  type PlaybackSettings,
  type PlaybackSettingsState,
} from '@/contract'

/** The server's settings, set once for every viewer. */
export const settingsCalls = ({ send, expect }: Transport) => ({
  getScanControl: (): Promise<ScanControlState> =>
    expect({ request: send({ path: SCAN_CONTROL_PATH }), guard: isScanControlState }),

  setScanControl: (state: ScanControlState): Promise<ScanControlState> =>
    expect({
      request: send({ path: SCAN_CONTROL_PATH, method: 'PUT', body: state }),
      guard: isScanControlState,
    }),
  /** How the server plays video, and what that comes to on this machine. */
  getPlaybackSettings: (): Promise<PlaybackSettingsState> =>
    expect({
      request: send({ path: '/api/settings/playback' }),
      guard: isPlaybackSettingsState,
    }),

  /** Changes one or more playback settings; the rest stay as they are. */
  setPlaybackSettings: (change: Partial<PlaybackSettings>): Promise<PlaybackSettingsState> =>
    expect({
      request: send({ path: '/api/settings/playback', method: 'PUT', body: change }),
      guard: isPlaybackSettingsState,
    }),

  /** How pages look for every viewer: whether a movie's title shows as its logo. */
  getDisplaySettings: (): Promise<DisplaySettings> =>
    expect({ request: send({ path: '/api/settings/display' }), guard: isDisplaySettings }),

  /** Changes one or more display settings; the rest stay as they are. */
  setDisplaySettings: (change: DisplaySettingsChange): Promise<DisplaySettings> =>
    expect({
      request: send({ path: '/api/settings/display', method: 'PUT', body: change }),
      guard: isDisplaySettings,
    }),
})
