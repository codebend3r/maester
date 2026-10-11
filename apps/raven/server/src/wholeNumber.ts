/** A whole number at or above zero written as text, or null when it is not one (blank included). */
export const wholeNumber = (value: string | undefined): number | null => {
  const parsed = Number(value)
  return value != null && value.trim() !== '' && Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : null
}
