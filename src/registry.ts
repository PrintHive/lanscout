import type { Device, Ipv4, Mac, Network, Observation, Source, TailscalePeer } from "./domain.ts"
import { ipv4ToInt } from "./domain.ts"
import { networkOf } from "./network.ts"

type Key = `${"ts" | "mac" | "usn" | "host" | "ip"}:${string}`

const keyRank: Record<string, number> = { ts: 0, mac: 1, usn: 2, host: 3, ip: 4 }

interface Draft {
  readonly keys: Set<Key>
  readonly ips: Set<Ipv4>
  readonly macs: Set<Mac>
  readonly hostnames: Set<string>
  readonly services: Set<string>
  readonly openPorts: Set<number>
  readonly networks: Set<string>
  readonly sources: Set<Source>
  server?: string | undefined
  location?: string | undefined
  tailscale?: TailscalePeer | undefined
  firstSeenMs: number
  lastSeenMs: number
}

/** `foo.local.`, `Foo`, and `foo.tail1234.ts.net` all name the same machine `foo`. */
export const normalizeHost = (name: string): string =>
  name.toLowerCase().replace(/\.$/, "").replace(/\.local$/, "").split(".")[0]!

/** Names many unrelated devices answer with; linking on them would merge strangers. */
const genericHosts = new Set(["localhost", "android", "espressif", "esp32", "raspberrypi", "unknown"])

const hostKey = (name: string): ReadonlyArray<Key> => {
  const host = normalizeHost(name)
  return host && !genericHosts.has(host) ? [`host:${host}`] : []
}

const usnUuid = (usn: string): string | undefined => /uuid:([0-9a-f-]+)/i.exec(usn)?.[1]?.toLowerCase()

interface Handler<T extends Observation["_tag"]> {
  readonly source: Source
  readonly keys: (o: Extract<Observation, { _tag: T }>) => ReadonlyArray<Key>
  readonly apply: (d: Draft, o: Extract<Observation, { _tag: T }>) => void
}

const handlers: { readonly [T in Observation["_tag"]]: Handler<T> } = {
  Mdns: {
    source: "mdns",
    keys: (o) => [`ip:${o.ip}`, ...(o.hostname ? hostKey(o.hostname) : [])],
    apply: (d, o) => {
      d.ips.add(o.ip)
      if (o.hostname) d.hostnames.add(o.hostname.replace(/\.$/, ""))
      for (const s of o.services) d.services.add(s)
    }
  },
  Ssdp: {
    source: "ssdp",
    keys: (o) => {
      const uuid = o.usn && usnUuid(o.usn)
      return [`ip:${o.ip}`, ...(uuid ? [`usn:${uuid}` as const] : [])]
    },
    apply: (d, o) => {
      d.ips.add(o.ip)
      if (o.server) d.server = o.server
      if (o.location) d.location = o.location
    }
  },
  Arp: {
    source: "arp",
    keys: (o) => [`ip:${o.ip}`, `mac:${o.mac}`],
    apply: (d, o) => {
      d.ips.add(o.ip)
      d.macs.add(o.mac)
    }
  },
  Tcp: {
    source: "tcp",
    keys: (o) => [`ip:${o.ip}`],
    apply: (d, o) => {
      d.ips.add(o.ip)
      d.openPorts.add(o.port)
    }
  },
  Tailscale: {
    source: "tailscale",
    keys: (o) => [
      `ts:${o.nodeId}`,
      ...hostKey(o.hostname),
      ...o.tailnetIps.map((ip) => `ip:${ip}` as const),
      ...(o.directIp ? [`ip:${o.directIp}` as const] : [])
    ],
    apply: (d, o) => {
      for (const ip of o.tailnetIps) d.ips.add(ip)
      if (o.directIp) d.ips.add(o.directIp)
      d.hostnames.add(o.hostname)
      d.networks.add("tailnet")
      d.tailscale = { nodeId: o.nodeId, dnsName: o.dnsName, os: o.os, online: o.online, routes: o.routes }
    }
  }
}

const emptyDraft = (now: number): Draft => ({
  keys: new Set(),
  ips: new Set(),
  macs: new Set(),
  hostnames: new Set(),
  services: new Set(),
  openPorts: new Set(),
  networks: new Set(),
  sources: new Set(),
  firstSeenMs: now,
  lastSeenMs: now
})

const absorb = (into: Draft, from: Draft): void => {
  for (const field of ["keys", "ips", "macs", "hostnames", "services", "openPorts", "networks", "sources"] as const) {
    for (const v of from[field] as Set<unknown>) (into[field] as Set<unknown>).add(v)
  }
  into.server ??= from.server
  into.location ??= from.location
  into.tailscale ??= from.tailscale
  into.firstSeenMs = Math.min(into.firstSeenMs, from.firstSeenMs)
  into.lastSeenMs = Math.max(into.lastSeenMs, from.lastSeenMs)
}

const byIp = (a: Ipv4, b: Ipv4) => ipv4ToInt(a) - ipv4ToInt(b)

const snapshot = (d: Draft): Device => {
  const id = [...d.keys].sort((a, b) => keyRank[a.slice(0, a.indexOf(":"))]! - keyRank[b.slice(0, b.indexOf(":"))]! || a.localeCompare(b))[0]!
  return {
    id,
    ips: [...d.ips].sort(byIp),
    macs: [...d.macs].sort(),
    hostnames: [...d.hostnames].sort(),
    services: [...d.services].sort(),
    openPorts: [...d.openPorts].sort((a, b) => a - b),
    networks: [...d.networks].sort(),
    sources: [...d.sources].sort(),
    ...(d.server === undefined ? {} : { server: d.server }),
    ...(d.location === undefined ? {} : { location: d.location }),
    ...(d.tailscale === undefined ? {} : { tailscale: d.tailscale }),
    firstSeenMs: d.firstSeenMs,
    lastSeenMs: d.lastSeenMs
  }
}

/**
 * Union-find over identifiers. Observations sharing any key (an IP, a MAC, an mDNS host,
 * an SSDP UUID, a Tailscale node) collapse into one device, so a machine seen on two bands,
 * two mesh subnets, and the tailnet resolves to a single record. Owned by one fiber per scan.
 */
export class Registry {
  readonly #parent = new Map<Key, Key>()
  readonly #drafts = new Map<Key, Draft>()
  readonly #networks: ReadonlyArray<Network>

  constructor(networks: ReadonlyArray<Network>) {
    this.#networks = networks
  }

  #find(key: Key): Key {
    let root = key
    while (this.#parent.get(root) !== root) root = this.#parent.get(root)!
    let cur = key
    while (cur !== root) {
      const next = this.#parent.get(cur)!
      this.#parent.set(cur, root)
      cur = next
    }
    return root
  }

  add(o: Observation, now: number): Device {
    const handler = handlers[o._tag] as Handler<typeof o._tag>
    const keys = handler.keys(o as never)
    let root: Key | undefined
    for (const key of keys) {
      if (!this.#parent.has(key)) continue
      const r = this.#find(key)
      if (root === undefined) root = r
      else if (r !== root) {
        absorb(this.#drafts.get(root)!, this.#drafts.get(r)!)
        this.#drafts.delete(r)
        this.#parent.set(r, root)
      }
    }
    if (root === undefined) {
      root = keys[0]!
      this.#drafts.set(root, emptyDraft(now))
    }
    const draft = this.#drafts.get(root)!
    for (const key of keys) {
      if (!this.#parent.has(key)) this.#parent.set(key, root)
      draft.keys.add(key)
    }
    handler.apply(draft, o as never)
    draft.sources.add(handler.source)
    for (const ip of draft.ips) {
      const net = networkOf(ip, this.#networks)
      if (net) draft.networks.add(net.kind === "tailnet" ? "tailnet" : net.iface)
    }
    if (o._tag === "Arp" && o.iface) draft.networks.add(o.iface)
    draft.lastSeenMs = now
    return snapshot(draft)
  }

  devices(): ReadonlyArray<Device> {
    return [...this.#drafts.values()]
      .map(snapshot)
      .sort((a, b) => (a.ips[0] && b.ips[0] ? byIp(a.ips[0], b.ips[0]) : a.id.localeCompare(b.id)))
  }
}
