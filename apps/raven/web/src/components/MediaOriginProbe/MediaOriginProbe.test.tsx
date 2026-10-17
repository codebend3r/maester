import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { useMediaOrigin } from '@raven/ui'
import { render, renderHook } from '@testing-library/react'
import { MediaOriginProbe, useReprobe } from '@/components/MediaOriginProbe/MediaOriginProbe'
import { api } from '@/lib/api'

afterEach(() => useMediaOrigin.setState({ pick: null, isProbing: false }))

describe('MediaOriginProbe', () => {
  it('asks for the media origins as it mounts', () => {
    const origins = spyOn(api, 'getMediaOrigins').mockImplementation(() => new Promise(() => {}))
    render(
      <MediaOriginProbe>
        <p>The app</p>
      </MediaOriginProbe>,
    )
    expect(origins).toHaveBeenCalledTimes(1)
    origins.mockRestore()
  })

  it('hands reprobe to what plays media beneath it', () => {
    const origins = spyOn(api, 'getMediaOrigins').mockImplementation(() => new Promise(() => {}))
    const { result } = renderHook(() => useReprobe(), { wrapper: MediaOriginProbe })
    expect(typeof result.current).toBe('function')
    origins.mockRestore()
  })

  it('fails loudly for a player with no probe around it', () => {
    const quiet = spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useReprobe())).toThrow('MediaOriginProbe')
    quiet.mockRestore()
  })
})
