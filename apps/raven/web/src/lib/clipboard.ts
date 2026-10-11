/**
 * Copies `text`, saying whether it worked. The Clipboard API is only there
 * on HTTPS or localhost, and raven is often reached over plain HTTP on the
 * home network, so there it copies the old way, from a selection; that
 * must run inside the click that asked for it.
 */
export const copyText = async (text: string): Promise<boolean> => {
  if (window.isSecureContext) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => false,
    )
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.className = 'visually-hidden'
  document.body.append(area)
  area.select()
  const copied = document.execCommand('copy')
  area.remove()
  return copied
}
