import { describe, expect, test } from 'bun:test'
import { exportProblems, importProblems, REQUIRED_EXPORTS } from '@/build/auditWindows'

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
})

describe('exportProblems', () => {
  test('answers nothing when every required export is there', () => {
    expect(exportProblems({ exports: [...REQUIRED_EXPORTS, 'mpv_free'] })).toEqual([])
  })

  test('names the required exports a DLL lacks', () => {
    expect(exportProblems({ exports: ['mpv_create'] })).toEqual(
      REQUIRED_EXPORTS.filter((name) => name !== 'mpv_create'),
    )
  })
})
