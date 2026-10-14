import type { ReactNode } from 'react'
import { useCanManage } from '@/lib/adminLock'

/**
 * A control or a dialog for a route the server marks `AdminOnly`, shown only
 * while this browser has the admin lock off. A dialog open when the lock
 * comes back on closes with it.
 */
export const AdminOnly = ({ children }: { children: ReactNode }) => useCanManage() && children
