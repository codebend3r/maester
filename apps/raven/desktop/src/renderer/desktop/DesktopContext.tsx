import { createContext, type ReactNode, useContext, useMemo } from 'react'
import type { DesktopClient } from '@/renderer/desktop/client'
import type { MenuHub } from '@/renderer/desktop/menuHub'

type Desktop = { client: DesktopClient; menu: MenuHub }

const DesktopContext = createContext<Desktop | null>(null)

export const DesktopProvider = ({ client, menu, children }: Desktop & { children: ReactNode }) => {
  const desktop = useMemo(() => ({ client, menu }), [client, menu])
  return <DesktopContext.Provider value={desktop}>{children}</DesktopContext.Provider>
}

export const useDesktop = (): Desktop => {
  const desktop = useContext(DesktopContext)
  if (desktop === null) throw new Error('useDesktop needs a DesktopProvider above it.')
  return desktop
}
