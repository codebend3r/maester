import Svg, { Circle } from 'react-native-svg'

import { useWrenTheme } from '@/theme/wrenTheme'
import { SIZE } from '@/theme/wrenTokens'

type ProgressRingProps = {
  /** How much is done, from 0 to 1. */
  share: number
  size?: number
}

/** A download's progress as a ring filling clockwise from the top, in place of its icon. */
export function ProgressRing({ share, size = SIZE.icon }: ProgressRingProps) {
  const { colors } = useWrenTheme()
  const radius = (size - SIZE.activeStroke) / 2
  const around = 2 * Math.PI * radius
  const centre = size / 2
  const filled = Math.min(1, Math.max(0, share)) * around
  return (
    <Svg
      accessibilityElementsHidden
      height={size}
      importantForAccessibility="no-hide-descendants"
      width={size}
    >
      <Circle
        cx={centre}
        cy={centre}
        fill="none"
        r={radius}
        stroke={colors.line2}
        strokeWidth={SIZE.activeStroke}
      />
      <Circle
        cx={centre}
        cy={centre}
        fill="none"
        r={radius}
        rotation={-90}
        origin={`${centre}, ${centre}`}
        stroke={colors.accentText}
        strokeDasharray={`${filled} ${around}`}
        strokeLinecap="round"
        strokeWidth={SIZE.activeStroke}
      />
    </Svg>
  )
}
