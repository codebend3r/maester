import { useEffect } from 'react'
import type { Engine } from '@/components/Player/engine'
import { PlayerChrome } from '@/components/Player/Stage'
import { useNativeEngine } from '@/components/Player/useNativeEngine'
import { useFullscreen } from '@/components/Player/useStageChrome'

/** The stage for a player in another process: the picture is its own surface under a transparent page. */
export const NativeStage = ({
  engine,
  onBack,
  onFailure,
}: {
  engine: Extract<Engine, { kind: 'native' }>
  onBack: () => void
  onFailure: (message: string) => void
}) => {
  const fullscreen = useFullscreen()
  const native = useNativeEngine({
    player: engine.player,
    source: engine.source,
    onFailure,
    toggleFullscreen: fullscreen.toggle,
  })
  useEffect(() => {
    document.documentElement.dataset.surface = 'native'
    return () => {
      delete document.documentElement.dataset.surface
    }
  }, [])
  return (
    <PlayerChrome
      engine={native.engine}
      onBack={onBack}
      mode="direct"
      selection={native.selection}
      subtitleStatus={native.selection.subtitle ? 'ready' : 'off'}
      fullscreen={fullscreen}
    />
  )
}
