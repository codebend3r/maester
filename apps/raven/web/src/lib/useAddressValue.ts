import { useSearchParams } from 'react-router-dom'

type AddressValue = [string | null, (next: string | null) => void]

/** One of the address's search params, and a setter that drops it for null and keeps the rest. */
export const useAddressValue = (name: string): AddressValue => {
  const [searchParams, setSearchParams] = useSearchParams()
  const set = (next: string | null) =>
    setSearchParams(
      (params) => {
        const kept = new URLSearchParams(params)
        if (next === null) kept.delete(name)
        else kept.set(name, next)
        return kept
      },
      { replace: true },
    )
  return [searchParams.get(name), set]
}
