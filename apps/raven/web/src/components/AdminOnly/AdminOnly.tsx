import type { ReactNode } from 'react'
import { useCanManage } from '@/lib/management'

type AdminOnlyProps = { children: ReactNode }

/**
 * A control or a dialog for a route the server marks `AdminOnly`, shown only
 * while this browser may manage: the admin lock is off, or the account is the
 * owner's. A dialog open when that ends closes with it.
 */
export const AdminOnly = ({ children }: AdminOnlyProps) => useCanManage() && children
