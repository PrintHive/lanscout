import * as Schema from "effect/Schema"

export type Ipv4 = string & { readonly Ipv4: unique symbol }
export type Mac = string & { readonly Mac: unique symbol }

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

export const parseIpv4 = (raw: string): Ipv4 | undefined => (IPV4.test(raw) ? (raw as Ipv4) : undefined)

export const ipv4ToInt = (ip: Ipv4): number => {
  const [a, b, c, d] = ip.split(".").map(Number) as [number, number, number, number]
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0
}

export const intToIpv4 = (n: number): Ipv4 =>
  `${n >>> 24}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}` as Ipv4

/** Normalizes `8c:3b:ad:1:2:3` (BSD drops leading zeros) to `8c:3b:ad:01:02:03`. */
export const parseMac = (raw: string): Mac | undefined => {
  const parts = raw.toLowerCase().split(/[:-]/)
  if (parts.length !== 6 || !parts.every((p) => /^[0-9a-f]{1,2}$/.test(p))) return undefined
  const mac = parts.map((p) => p.padStart(2, "0")).join(":")
  const first = parseInt(parts[0]!, 16)
  if (mac === "ff:ff:ff:ff:ff:ff" || mac === "00:00:00:00:00:00" || (first & 1) === 1) return undefined
  return mac as Mac
}

export type Source = "mdns" | "ssdp" | "arp" | "tcp" | "tailscale"
export const allSources: ReadonlyArray<Source> = ["mdns", "ssdp", "arp", "tcp", "tailscale"]

export type NetworkKind = "lan" | "tailnet"

/** One local IPv4 attachment. A dual-band or mesh setup with separate SSIDs shows up as several. */
export interface Network {
  readonly iface: string
  readonly kind: NetworkKind
  readonly address: Ipv4
  readonly prefix: number
}

export type Observation =
  | { readonly _tag: "Mdns"; readonly ip: Ipv4; readonly hostname?: string; readonly services: ReadonlyArray<string> }
  | { readonly _tag: "Ssdp"; readonly ip: Ipv4; readonly usn?: string; readonly server?: string; readonly location?: string }
  | { readonly _tag: "Arp"; readonly ip: Ipv4; readonly mac: Mac; readonly iface?: string }
  | { readonly _tag: "Tcp"; readonly ip: Ipv4; readonly port: number }
  | {
    readonly _tag: "Tailscale"
    readonly nodeId: string
    readonly hostname: string
    readonly dnsName: string
    readonly os: string
    readonly online: boolean
    readonly tailnetIps: ReadonlyArray<Ipv4>
    /** The peer's LAN address when the tailnet path is direct; links it to its LAN identity. */
    readonly directIp?: Ipv4
    readonly routes: ReadonlyArray<string>
  }

export class SourceFailed extends Schema.TaggedError<SourceFailed>()("SourceFailed", {
  source: Schema.String,
  message: Schema.String
}) {}

export type Event = Observation | SourceFailed

export interface TailscalePeer {
  readonly nodeId: string
  readonly dnsName: string
  readonly os: string
  readonly online: boolean
  readonly routes: ReadonlyArray<string>
}

export interface Device {
  /** Strongest identifier seen so far (`ts:`, `mac:`, `usn:`, `host:`, then `ip:`). Can upgrade as later observations merge in. */
  readonly id: string
  readonly ips: ReadonlyArray<Ipv4>
  readonly macs: ReadonlyArray<Mac>
  readonly hostnames: ReadonlyArray<string>
  readonly services: ReadonlyArray<string>
  readonly openPorts: ReadonlyArray<number>
  readonly networks: ReadonlyArray<string>
  readonly sources: ReadonlyArray<Source>
  readonly server?: string
  readonly location?: string
  readonly tailscale?: TailscalePeer
  readonly firstSeenMs: number
  readonly lastSeenMs: number
}
