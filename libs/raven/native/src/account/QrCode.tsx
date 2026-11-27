import Svg, { Path, Rect } from 'react-native-svg'

import { qrDrawingOf } from '@/account/qrPath'

/** The light margin a scanner needs round a code, in modules, as the QR standard asks. */
const QUIET_ZONE = 4

/** A camera reads contrast, not a palette, so a code is black on white under every theme. */
const QR_COLOURS = { dark: '#000000', light: '#ffffff' } as const

type QrCodeProps = {
  value: string
  /** The side of the whole square, margin included. */
  size: number
  label: string
}

/** A QR code a phone's camera reads off the TV, with the quiet margin round it. */
export const QrCode = ({ value, size, label }: QrCodeProps) => {
  const drawing = qrDrawingOf(value)
  const side = drawing.size + QUIET_ZONE * 2
  return (
    <Svg
      accessibilityLabel={label}
      accessible
      height={size}
      viewBox={`${-QUIET_ZONE} ${-QUIET_ZONE} ${side} ${side}`}
      width={size}
    >
      <Rect fill={QR_COLOURS.light} height={side} width={side} x={-QUIET_ZONE} y={-QUIET_ZONE} />
      <Path d={drawing.path} fill={QR_COLOURS.dark} />
    </Svg>
  )
}
