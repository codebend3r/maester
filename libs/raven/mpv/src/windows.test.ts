import { describe, expect, test } from 'bun:test'
import { ADDON_DLLS, importProblems } from '@/windows'

describe('importProblems', () => {
  test('allows Windows, the CRT api sets and the Vulkan loader, in any case', () => {
    expect(
      importProblems({
        imports: ['KERNEL32.dll', 'user32.dll', 'api-ms-win-crt-heap-l1-1-0.dll', 'vulkan-1.dll'],
      }),
    ).toEqual([])
  })

  test('names every DLL that should have been linked in', () => {
    expect(
      importProblems({ imports: ['KERNEL32.dll', 'avcodec-62.dll', 'libplacebo-351.dll'] }),
    ).toEqual(['avcodec-62.dll', 'libplacebo-351.dll'])
  })

  test('lets the addon load libmpv and Node, in any case, and nothing else of ours', () => {
    expect(
      importProblems({
        imports: ['LIBMPV-2.dll', 'node.exe', 'KERNEL32.dll', 'electron.exe'],
        allowed: ADDON_DLLS,
      }),
    ).toEqual(['electron.exe'])
  })
})
