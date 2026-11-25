import { NOW_PLAYING_COPY } from '@raven/wren'

import { FORM_FACTORS, type FormFactor } from '@/theme/wrenTokens'

/** What a song is played on, as `Platform.OS` names it. */
const PLATFORMS = { android: 'android' } as const

type DeviceOfProps = { os: string; formFactor: FormFactor }

const APPLE_DEVICES = {
  [FORM_FACTORS.phone]: NOW_PLAYING_COPY.devices.iPhone,
  [FORM_FACTORS.tablet]: NOW_PLAYING_COPY.devices.iPad,
} as const satisfies Record<FormFactor, string>

/** The word for the device Wren plays on: iPhone, iPad or Android. */
export const deviceOf = ({ os, formFactor }: DeviceOfProps): string =>
  os === PLATFORMS.android ? NOW_PLAYING_COPY.devices.android : APPLE_DEVICES[formFactor]
