import {
  DRAWINGS,
  type Drawing,
  ICON_STROKE_WIDTH,
  ICON_TINT,
  ICON_VIEW_BOX,
  type IconName,
} from '@raven/ui/iconDrawings'
import Svg, { Path } from 'react-native-svg'

type IconProps = { name: IconName; size: number; colour: string; isFocused?: boolean }

/**
 * One of the web's line icons, from the same drawings, through react-native-svg: its outline,
 * the soft tint under it, which deepens while its control has the focus, and its solid marks.
 * Decorative: the control around it carries the label.
 */
export const Icon = ({ name, size, colour, isFocused = false }: IconProps) => {
  const { stroke, fill, marks }: Drawing = DRAWINGS[name]
  return (
    <Svg fill="none" height={size} viewBox={ICON_VIEW_BOX} width={size}>
      {!!fill && (
        <Path d={fill} fill={colour} fillOpacity={isFocused ? ICON_TINT.active : ICON_TINT.rest} />
      )}
      {!!stroke && (
        <Path
          d={stroke}
          stroke={colour}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={ICON_STROKE_WIDTH}
        />
      )}
      {!!marks && <Path d={marks} fill={colour} />}
    </Svg>
  )
}
