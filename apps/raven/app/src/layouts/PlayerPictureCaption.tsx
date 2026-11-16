import type { PictureCue } from '@raven/core'
import { useState } from 'react'
import { Image, type LayoutChangeEvent, StyleSheet, View } from 'react-native'

import { type FrameSize, placedPictureOf } from '@/layouts/pictureCaptionFit'

/** What opens the address of a PNG held in the address itself, as a cue's pictures are. */
const PNG_ADDRESS = 'data:image/png;base64,'

type PictureCaptionsProps = {
  /** The picture cues showing now. */
  cues: readonly PictureCue[]
}

/**
 * The picture subtitles showing now (Blu-ray PGS), as raven draws them over the video wherever
 * it draws the subtitles itself: each of the disc's pictures as it is, where the disc puts it
 * (`placedPictureOf`), under the controls. A picture is a picture of text, so it keeps the
 * disc's own look, not the account's. Nothing here takes a touch or the remote's focus.
 */
export const PictureCaptions = ({ cues }: PictureCaptionsProps) => {
  const [frame, setFrame] = useState<FrameSize | null>(null)
  const measure = ({ nativeEvent: { layout } }: LayoutChangeEvent) =>
    setFrame({ width: layout.width, height: layout.height })
  return (
    <View onLayout={measure} pointerEvents="none" style={StyleSheet.absoluteFill}>
      {frame !== null &&
        cues.flatMap((cue) =>
          cue.pictures.map((picture, index) => {
            const placed = placedPictureOf({ frame, canvas: cue.canvas, picture })
            // A cue's pictures keep their order, and a picture track shows one cue at a time.
            const key = `${String(cue.start)}-${String(index)}`
            return (
              placed !== null && (
                <Image
                  key={key}
                  accessible={false}
                  resizeMode="stretch"
                  source={{ uri: `${PNG_ADDRESS}${picture.png}` }}
                  style={[styles.picture, placed]}
                />
              )
            )
          }),
        )}
    </View>
  )
}

const styles = StyleSheet.create({
  picture: { position: 'absolute' },
})
