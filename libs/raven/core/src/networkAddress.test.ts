import { describe, expect, it } from 'bun:test'
import { isPrivateAddress, keyOfAddress } from '@/networkAddress'

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
    '::ffff:c0a8:102',
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

  it.each(['raven.example.com', '', 'unknown', '300.1.1.1', 'fc00::zz', 'fe80:1', '1::2::3'])(
    'counts %s, which is no address, as not private',
    (address) => {
      expect(isPrivateAddress(address)).toBe(false)
    },
  )
})

describe('keyOfAddress', () => {
  it('counts an IPv4 client by its address, mapped into IPv6 or not', () => {
    expect(keyOfAddress({ address: '198.51.100.20', prefixBits: 64 })).toBe('198.51.100.20')
    expect(keyOfAddress({ address: '::ffff:198.51.100.20', prefixBits: 64 })).toBe('198.51.100.20')
    expect(keyOfAddress({ address: '::FFFF:c633:6414', prefixBits: 48 })).toBe('198.51.100.20')
  })

  it('counts an IPv6 client by the /64 it lies in, however the address is written', () => {
    expect(keyOfAddress({ address: '2001:db8:1:2:3:4:5:6', prefixBits: 64 })).toBe(
      '2001:db8:1:2::/64',
    )
    expect(keyOfAddress({ address: '2001:0DB8:0001:0002:ffff::1', prefixBits: 64 })).toBe(
      '2001:db8:1:2::/64',
    )
    expect(keyOfAddress({ address: '2001:db8::1%eth0', prefixBits: 64 })).toBe('2001:db8:0:0::/64')
  })

  it('counts a /48 as one client where the strict tier asks', () => {
    const one = keyOfAddress({ address: '2001:db8:1:2a00::1', prefixBits: 48 })
    expect(one).toBe('2001:db8:1:0::/48')
    expect(keyOfAddress({ address: '2001:db8:1:ffff::1', prefixBits: 48 })).toBe(one)
    expect(keyOfAddress({ address: '2001:db8:2::1', prefixBits: 48 })).not.toBe(one)
  })

  it('keys what is not an address as itself, trimmed and in lower case', () => {
    expect(keyOfAddress({ address: ' Unknown ', prefixBits: 64 })).toBe('unknown')
  })
})
