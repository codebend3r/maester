import { describe, expect, it } from 'bun:test'
import { isPrivateAddress } from '@/networkAddress'

describe('isPrivateAddress', () => {
  it.each([
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.50.6',
    '127.0.0.1',
    '169.254.10.20',
    '100.64.0.1',
    '100.127.255.255',
    '0.0.0.0',
    '::ffff:172.17.0.1',
    '::FFFF:192.168.1.2',
    '::1',
    '::',
    'fd12:3456:789a::1',
    'fc00::1',
    'fe80::1%eth0',
    'febf::1',
  ])('counts %s as private', (address) => {
    expect(isPrivateAddress(address)).toBe(true)
  })

  it.each([
    '8.8.8.8',
    '172.15.255.255',
    '172.32.0.1',
    '192.169.0.1',
    '100.63.255.255',
    '100.128.0.1',
    '203.0.113.4',
    '::ffff:8.8.4.4',
    '2001:db8::1',
    '2606:4700::1111',
    'fec0::1',
  ])('counts %s as public', (address) => {
    expect(isPrivateAddress(address)).toBe(false)
  })

  it('counts what is not an address as private, so a refusal of private ones refuses it', () => {
    expect(isPrivateAddress('raven.example.com')).toBe(true)
    expect(isPrivateAddress('')).toBe(true)
    expect(isPrivateAddress('300.1.1.1')).toBe(true)
  })
})
