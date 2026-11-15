import { useEffect } from 'react'

/** The tab names `label` while the component is mounted, and the host's title again after. */
export const useDocumentTitle = (label: string): void => {
  useEffect(() => {
    const previousTitle = document.title
    document.title = label
    return () => {
      document.title = previousTitle
    }
  }, [label])
}
