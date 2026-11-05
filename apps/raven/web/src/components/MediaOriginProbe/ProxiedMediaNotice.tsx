import { useMediaOrigin, useToasts } from '@raven/ui'
import { useEffect, useRef, useState } from 'react'
import { PROXIED_MEDIA_COPY, PROXIED_MEDIA_WARNING } from '@/components/MediaOriginProbe/copy'
import { useCanManage } from '@/lib/management'

/**
 * The toast for whoever can manage raven, since the fix is on the server.
 * Mounted only once the fallback has been seen: reading who may manage
 * subscribes to the account query, which fetches `/api/me` again, and a
 * page that never falls back owes no such call.
 */
const ProxiedMediaToast = () => {
  const canManage = useCanManage()
  const showToast = useToasts((state) => state.show)
  const hasToasted = useRef(false)
  useEffect(() => {
    if (!canManage || hasToasted.current) return
    hasToasted.current = true
    showToast(PROXIED_MEDIA_COPY.toast)
  }, [canManage, showToast])
  return null
}

type ProxiedMediaNoticeProps = {
  /** Whether this page's `/api` is a proxy to raven, as on Netlify, rather than raven itself. */
  isProxiedHost: boolean
}

/**
 * Says so when a probe ends with no media origin on a host whose `/api` is
 * a proxy: media then streams through that proxy, which its host bills.
 * Every browser gets a console warning once, and whoever can manage raven
 * a toast once too. Nothing is said before the first probe ends, as the
 * pick is empty until then.
 */
export const ProxiedMediaNotice = ({ isProxiedHost }: ProxiedMediaNoticeProps) => {
  const origin = useMediaOrigin((state) => state.pick?.origin ?? null)
  const isProbing = useMediaOrigin((state) => state.isProbing)
  const hasProbed = useMediaOrigin((state) => state.hasProbed)
  const [hasFallenBack, setFallenBack] = useState(false)
  const isFallback = isProxiedHost && hasProbed && !isProbing && origin === null
  if (isFallback && !hasFallenBack) setFallenBack(true)
  useEffect(() => {
    if (hasFallenBack) console.warn(PROXIED_MEDIA_WARNING)
  }, [hasFallenBack])
  return hasFallenBack && <ProxiedMediaToast />
}
