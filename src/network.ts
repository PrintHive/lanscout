import type { NetworkInterfaceInfo } from "node:os"
import type { Ipv4, Network } from "./domain.ts"
import { intToIpv4, ipv4ToInt, parseIpv4 } from "./domain.ts"

const CGNAT = ipv4ToInt("100.64.0.0" as Ipv4)

const mask = (prefix: number): number => (prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0)

/** Tailscale assigns tailnet addresses from 100.64.0.0/10. */
export const isTailnetIp = (ip: Ipv4): boolean => ((ipv4ToInt(ip) & mask(10)) >>> 0) === CGNAT

export const inCidr = (ip: Ipv4, base: Ipv4, prefix: number): boolean =>
  ((ipv4ToInt(ip) & mask(prefix)) >>> 0) === ((ipv4ToInt(base) & mask(prefix)) >>> 0)

export const parseCidr = (raw: string): { readonly base: Ipv4; readonly prefix: number } | undefined => {
  const [addr, bits = "32"] = raw.split("/")
  const base = addr === undefined ? undefined : parseIpv4(addr)
  const prefix = Number(bits)
  return base && Number.isInteger(prefix) && prefix >= 0 && prefix <= 32 ? { base, prefix } : undefined
}

export const localNetworks = (
  interfaces: Record<string, ReadonlyArray<NetworkInterfaceInfo> | undefined>
): ReadonlyArray<Network> =>
  Object.entries(interfaces).flatMap(([iface, infos]) =>
    (infos ?? []).flatMap((info) => {
      const address = info.family === "IPv4" && !info.internal ? parseIpv4(info.address) : undefined
      if (!address) return []
      const prefix = parseCidr(info.cidr ?? `${address}/32`)?.prefix ?? 32
      return [{ iface, address, prefix, kind: isTailnetIp(address) ? "tailnet" : "lan" } as const]
    })
  )

export const networkOf = (ip: Ipv4, networks: ReadonlyArray<Network>): Network | undefined => {
  if (isTailnetIp(ip)) return networks.find((n) => n.kind === "tailnet") ?? { iface: "tailnet", kind: "tailnet", address: ip, prefix: 10 }
  let best: Network | undefined
  for (const n of networks) {
    if (n.kind === "lan" && inCidr(ip, n.address, n.prefix) && (!best || n.prefix > best.prefix)) best = n
  }
  return best
}

/**
 * Usable hosts in `base/prefix`, excluding network, broadcast, and `self`. Subnets wider than
 * `cap` hosts shrink to the aligned block around `around`, so a /16 LAN sweeps the
 * neighbourhood of this machine instead of 65k addresses.
 */
export const hostsOf = (base: Ipv4, prefix: number, cap: number, around: Ipv4 = base, self?: Ipv4): Array<Ipv4> => {
  let p = prefix
  while (p < 30 && 2 ** (32 - p) - 2 > cap) p++
  if (prefix >= 31) return [base]
  const net = (ipv4ToInt(around) & mask(p)) >>> 0
  const size = 2 ** (32 - p)
  const selfInt = self === undefined ? -1 : ipv4ToInt(self)
  const out: Array<Ipv4> = []
  for (let i = 1; i < size - 1; i++) {
    const n = net + i
    if (n !== selfInt) out.push(intToIpv4(n))
  }
  return out
}

export const broadcastOf = (n: Network): Ipv4 => intToIpv4((ipv4ToInt(n.address) | ~mask(n.prefix)) >>> 0)
