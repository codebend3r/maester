import { LaunchIntro, type LaunchProps } from '@raven/native'
import { BRAND, LOCKUP_DRAWING, LOCKUP_VIEW_BOX } from '@raven/wren'
import { type ReactNode } from 'react'
import Svg, { Circle, Path } from 'react-native-svg'

import { SIZE } from '@/theme/tvTokens'

const { x, y, width, height } = LOCKUP_VIEW_BOX

type LockupLayerProps = { children: ReactNode }

/** One layer of the lockup at the launch size: the layers share its box, so they line up. */
const LockupLayer = ({ children }: LockupLayerProps) => (
  <Svg
    height={SIZE.launchLogo}
    viewBox={`${x} ${y} ${width} ${height}`}
    width={(SIZE.launchLogo * width) / height}
  >
    {children}
  </Svg>
)

/** The bird as the TV icon wears it on the Leaf: Bark, with a Night eye. */
const LaunchMark = () => (
  <LockupLayer>
    <Path d={LOCKUP_DRAWING.body} fill={BRAND.bark} fillRule="evenodd" />
    {LOCKUP_DRAWING.parts.map((part) => (
      <Path d={part} fill={BRAND.bark} key={part} />
    ))}
    <Circle {...LOCKUP_DRAWING.eye} fill={BRAND.night} />
  </LockupLayer>
)

const LaunchWordmark = () => (
  <LockupLayer>
    <Path d={LOCKUP_DRAWING.wordmark} fill={BRAND.bark} />
  </LockupLayer>
)

/**
 * Wren's lockup as it opens, on the splash's Leaf: the bird comes in, then its name beside it,
 * and once the stores are read the lockup fades to show the first screen.
 */
export const WrenLaunch = ({ isReady, onShown }: LaunchProps) => (
  <LaunchIntro
    follow={<LaunchWordmark />}
    ground={BRAND.leaf}
    isReady={isReady}
    mark={<LaunchMark />}
    onShown={onShown}
  />
)
