import {
  DEFAULT_OUTPUT_SETTINGS,
  isOutputSettings,
  isPassthroughFormat,
  object,
  oneOf,
  type Infer,
  type OutputSettings,
} from '@raven/core'
import type { JsonStore } from '@/main/stateStore'

export const CONFIG_FILE = 'desktop-config.json'

export const isDesktopConfig = object({
  version: oneOf([1]),
  output: isOutputSettings,
})

export type DesktopConfig = Infer<typeof isDesktopConfig>

export type ConfigStore = JsonStore<DesktopConfig>

export const EMPTY_CONFIG: DesktopConfig = { version: 1, output: DEFAULT_OUTPUT_SETTINGS }

export const setOutput = ({
  config,
  output,
}: {
  config: DesktopConfig
  output: OutputSettings
}): DesktopConfig => ({
  ...config,
  output,
})

/** Rebuilds the settings from the four known fields, so nothing else a caller sent is stored. */
export const pickOutput = (output: OutputSettings): OutputSettings => ({
  profile: output.profile,
  device: output.device,
  passthrough: isPassthroughFormat.values.filter((format) => output.passthrough.includes(format)),
  spatial: output.spatial,
})
