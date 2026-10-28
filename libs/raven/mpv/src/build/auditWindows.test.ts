import { describe, expect, test } from 'bun:test'
import { exportProblems, REQUIRED_EXPORTS } from '@/build/auditWindows'

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
