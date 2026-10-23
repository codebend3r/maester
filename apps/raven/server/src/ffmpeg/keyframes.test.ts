import { describe, expect, it } from 'vitest'
import { parseKeyframes } from '@/ffmpeg/keyframes'

describe('parseKeyframes', () => {
  it('keeps the keyframes, sorted, from packets that come in decode order', () => {
    const output = ['4.000000,K__', '2.000000,K__', '2.041000,___', '0.000000,K__', ''].join('\n')
    expect(parseKeyframes(output)).toEqual([0, 2, 4])
  })

  it('reads the key flag wherever it sits among the others', () => {
    expect(parseKeyframes('1.000000,_K_\n2.000000,__D\n3.000000,K_D')).toEqual([1, 3])
  })

  it('drops a packet with no time', () => {
    expect(parseKeyframes('N/A,K__\n1.000000,K__\n,K__')).toEqual([1])
  })

  it('truncates to three decimals, never rounds', () => {
    expect(parseKeyframes('0.000000,K__\n30.488792,K__\n79.996583,K__')).toEqual([
      0, 30.488, 79.996,
    ])
  })

  it('keeps a time that float multiplication lands a hair under', () => {
    expect(4.004 * 1000).toBeLessThan(4004)
    expect(parseKeyframes('4.004000,K__\n1.001000,K__\n0.007000,K__')).toEqual([
      0.007, 1.001, 4.004,
    ])
  })

  it('truncates a time before zero toward the earlier one', () => {
    expect(parseKeyframes('-0.083416,K__')).toEqual([-0.084])
  })

  it('answers nothing for an empty report', () => {
    expect(parseKeyframes('')).toEqual([])
  })
})
