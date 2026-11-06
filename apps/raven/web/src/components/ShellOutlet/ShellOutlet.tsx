import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'
import { PageSkeleton } from '@/components/Skeleton/Skeleton'
import { TopCardNote } from '@/lib/useScrollReset'

type ShellOutletProps = { pageKey: string }

/**
 * Where a shell draws its page: under the top card's note, and while a
 * page's code loads on its first visit, its shape inside the shell rather
 * than the whole-screen loader.
 */
export const ShellOutlet = ({ pageKey }: ShellOutletProps) => (
  <TopCardNote pageKey={pageKey}>
    <Suspense fallback={<PageSkeleton />}>
      <Outlet />
    </Suspense>
  </TopCardNote>
)
