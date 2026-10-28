import type { Device, Ipv4, Mac, Network, Observation, Printer, ScanEvent, Source, SourceFailed, TailscalePeer } from "./domain.ts"
import { ipv4ToInt } from "./domain.ts"
import { isTailnetIp, networkOf } from "./network.ts"

type Key = `${"ts" | "sn" | "mac" | "usn" | "host" | "ip"}:${string}`

const keyRank: Record<string, number> = { ts: 0, sn: 1, mac: 2, usn: 3, host: 4, ip: 5 }

/** When an address was first and last seen at all, and first and last heard from the device itself (any source but ARP). */
interface Address {
  firstSeenMs: number
  seenMs: number
  firstHeardMs: number | undefined
  heardMs: number | undefined
}

interface Draft {
  readonly keys: Set<Key>
  readonly addresses: Map<Ipv4, Address>
  readonly macs: Set<Mac>
  readonly hostnames: Set<string>
  readonly services: Set<string>
  readonly openPorts: Set<number>
  readonly networks: Set<string>
  readonly sources: Set<Source>
  server?: string | undefined
  location?: string | undefined
  tailscale?: TailscalePeer | undefined
  printer?: Printer | undefined
  firstSeenMs: number
  lastSeenMs: number
  /** Last answer from the device itself. ARP doesn't count: a cache entry outlives the device by minutes. */
  lastHeardMs: number
  lastCheckMs: number
  /** The id last reported in an event; undefined until the first event. */
  reportedId?: string | undefined
  /** Fields last reported, minus timestamps, so a re-sighting that changes nothing stays quiet. */
  reportedFields?: string | undefined
  gone: boolean
}

export type DeviceEvent = Exclude<ScanEvent, SourceFailed>

/** A TCP liveness check to send: one known open port of a device that has gone quiet. */
export interface Check {
  readonly ip: Ipv4
  readonly port: number
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
  readonly source: Source | ((o: Extract<Observation, { _tag: T }>) => Source)
  readonly keys: (o: Extract<Observation, { _tag: T }>) => ReadonlyArray<Key>
  /** Addresses this observation shows the device at. */
  readonly ips: (o: Extract<Observation, { _tag: T }>) => ReadonlyArray<Ipv4>
  readonly apply: (d: Draft, o: Extract<Observation, { _tag: T }>) => void
}

const handlers: { readonly [T in Observation["_tag"]]: Handler<T> } = {
  Mdns: {
    source: "mdns",
    keys: (o) => [`ip:${o.ip}`, ...(o.hostname ? hostKey(o.hostname) : [])],
    ips: (o) => [o.ip],
    apply: (d, o) => {
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
    ips: (o) => [o.ip],
    apply: (d, o) => {
      if (o.server) d.server = o.server
      if (o.location) d.location = o.location
    }
  },
  Arp: {
    source: "arp",
    keys: (o) => [`ip:${o.ip}`, `mac:${o.mac}`],
    ips: (o) => [o.ip],
    apply: (d, o) => {
      d.macs.add(o.mac)
    }
  },
  Tcp: {
    source: "tcp",
    keys: (o) => [`ip:${o.ip}`],
    ips: (o) => [o.ip],
    apply: (d, o) => {
      d.openPorts.add(o.port)
    }
  },
  Alive: {
    source: "tcp",
    keys: (o) => [`ip:${o.ip}`],
    ips: (o) => [o.ip],
    apply: () => {}
  },
  Printer: {
    source: (o) => o.via,
    keys: (o) => [`ip:${o.ip}`, ...(o.printer.serial ? [`sn:${o.printer.serial.toUpperCase()}` as const] : [])],
    ips: (o) => [o.ip],
    apply: (d, o) => {
      d.printer = mergePrinter(d.printer, o.printer)
      if (o.printer.name) d.hostnames.add(o.printer.name)
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
    ips: (o) => [...o.tailnetIps, ...(o.directIp ? [o.directIp] : [])],
    apply: (d, o) => {
      d.hostnames.add(o.hostname)
      d.networks.add("tailnet")
      d.tailscale = { nodeId: o.nodeId, dnsName: o.dnsName, os: o.os, online: o.online, routes: o.routes }
    }
  }
}

/** Later reports fill gaps; a field once known is overwritten only by a newer defined value. */
const mergePrinter = (prev: Printer | undefined, next: Printer): Printer => {
  if (!prev || prev.kind !== next.kind) return next
  const defined = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined))
  return { ...prev, ...defined } as Printer
}

const emptyDraft = (now: number): Draft => ({
  keys: new Set(),
  addresses: new Map(),
  macs: new Set(),
  hostnames: new Set(),
  services: new Set(),
  openPorts: new Set(),
  networks: new Set(),
  sources: new Set(),
  firstSeenMs: now,
  lastSeenMs: now,
  lastHeardMs: now,
  lastCheckMs: now,
  gone: false
})

const absorb = (into: Draft, from: Draft): void => {
  for (const field of ["keys", "macs", "hostnames", "services", "openPorts", "networks", "sources"] as const) {
    for (const v of from[field] as Set<unknown>) (into[field] as Set<unknown>).add(v)
  }
  for (const [ip, a] of from.addresses) {
    const b = into.addresses.get(ip)
    into.addresses.set(
      ip,
      b
        ? {
          firstSeenMs: Math.min(a.firstSeenMs, b.firstSeenMs),
          seenMs: Math.max(a.seenMs, b.seenMs),
          firstHeardMs: earliest(a.firstHeardMs, b.firstHeardMs),
          heardMs: latest(a.heardMs, b.heardMs)
        }
        : { ...a }
    )
  }
  into.server ??= from.server
  into.location ??= from.location
  into.tailscale ??= from.tailscale
  if (from.printer) into.printer = mergePrinter(into.printer, from.printer)
  into.firstSeenMs = Math.min(into.firstSeenMs, from.firstSeenMs)
  into.lastSeenMs = Math.max(into.lastSeenMs, from.lastSeenMs)
  into.lastHeardMs = Math.max(into.lastHeardMs, from.lastHeardMs)
}

const fieldsOf = ({ firstSeenMs: _, lastSeenMs: __, ...fields }: Device): string => JSON.stringify(fields)

const byIp = (a: Ipv4, b: Ipv4) => ipv4ToInt(a) - ipv4ToInt(b)

const latest = (a: number | undefined, b: number | undefined) => (a === undefined ? b : b === undefined ? a : Math.max(a, b))

const earliest = (a: number | undefined, b: number | undefined) => (a === undefined ? b : b === undefined ? a : Math.min(a, b))

/** How recent an address is. With an open port the device can answer for itself, so ARP sightings don't count. */
const freshness = (d: Draft, a: Address) => (d.openPorts.size > 0 ? (a.heardMs ?? -Infinity) : a.seenMs)

/**
 * The address the device is at now: of the addresses heard from the device itself, the one first heard most recently.
 * After a DHCP move the new address is the newest, so it wins at once, while the ARP cache keeps re-sighting the old
 * one. A device that stays at two addresses keeps the same current one instead of flipping between them on every
 * sighting. A LAN address always wins over a tailnet one, so a Tailscale peer on the LAN reports its LAN address.
 * A device heard nowhere falls back to the address first seen most recently.
 */
const current = (d: Draft): Ipv4 => {
  const heard = [...d.addresses].filter(([, a]) => a.firstHeardMs !== undefined)
  const pool = heard.length > 0 ? heard : [...d.addresses]
  const since = (a: Address) => (heard.length > 0 ? a.firstHeardMs! : a.firstSeenMs)
  return pool.reduce((best, next) => {
    const order = Number(isTailnetIp(best[0])) - Number(isTailnetIp(next[0])) || since(next[1]) - since(best[1]) || byIp(best[0], next[0])
    return order > 0 ? next : best
  })[0]
}

const snapshot = (d: Draft): Device => {
  const id = [...d.keys].sort((a, b) => keyRank[a.slice(0, a.indexOf(":"))]! - keyRank[b.slice(0, b.indexOf(":"))]! || a.localeCompare(b))[0]!
  return {
    id,
    ip: current(d),
    ips: [...d.addresses.keys()].sort(byIp),
    macs: [...d.macs].sort(),
    hostnames: [...d.hostnames].sort(),
    services: [...d.services].sort(),
    openPorts: [...d.openPorts].sort((a, b) => a - b),
    networks: [...d.networks].sort(),
    sources: [...d.sources].sort(),
    ...(d.server === undefined ? {} : { server: d.server }),
    ...(d.location === undefined ? {} : { location: d.location }),
    ...(d.tailscale === undefined ? {} : { tailscale: d.tailscale }),
    ...(d.printer === undefined ? {} : { printer: d.printer }),
    firstSeenMs: d.firstSeenMs,
    lastSeenMs: d.lastSeenMs
  }
}

/**
 * Union-find over identifiers. Observations sharing any key (an IP, a MAC, an mDNS host,
 * an SSDP UUID, a Tailscale node) collapse into one device, so a machine seen on two bands,
 * two mesh subnets, and the tailnet resolves to a single record. Owned by one fiber per scan.
 * Records are never deleted: a device that goes quiet is marked gone and comes back on its next
 * sighting, so union-find links never need undoing.
 */
export class Registry {
  readonly #parent = new Map<Key, Key>()
  readonly #drafts = new Map<Key, Draft>()
  readonly #networks: ReadonlyArray<Network>
  readonly #reclaimed: Array<DeviceEvent> = []

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

  /** Records an observation. Returns the event it causes, or undefined when nothing but `lastSeenMs` changed. */
  add(o: Observation, now: number): DeviceEvent | undefined {
    const handler = handlers[o._tag] as Handler<typeof o._tag>
    const keys = handler.keys(o as never)
    this.#reclaimAddresses(keys)
    const formerIds: Array<string> = []
    let absorbedLive = false
    let root: Key | undefined
    for (const key of keys) {
      if (!this.#parent.has(key)) continue
      const r = this.#find(key)
      if (root === undefined) root = r
      else if (r !== root) {
        const absorbed = this.#drafts.get(r)!
        if (absorbed.reportedId !== undefined) formerIds.push(absorbed.reportedId)
        absorbedLive ||= absorbed.reportedId !== undefined && !absorbed.gone
        absorb(this.#drafts.get(root)!, absorbed)
        this.#drafts.delete(r)
        this.#parent.set(r, root)
      }
    }
    if (root === undefined) {
      // A device needs an address. A Tailscale peer with none yet only enriches a device already found elsewhere.
      if (handler.ips(o as never).length === 0) return undefined
      root = keys[0]!
      this.#drafts.set(root, emptyDraft(now))
    }
    const draft = this.#drafts.get(root)!
    for (const key of keys) {
      if (!this.#parent.has(key)) this.#parent.set(key, root)
      draft.keys.add(key)
    }
    handler.apply(draft, o as never)
    for (const ip of handler.ips(o as never)) {
      const a = draft.addresses.get(ip)
      const heard = o._tag !== "Arp"
      draft.addresses.set(ip, {
        firstSeenMs: a?.firstSeenMs ?? now,
        seenMs: now,
        firstHeardMs: a?.firstHeardMs ?? (heard ? now : undefined),
        heardMs: heard ? now : a?.heardMs
      })
    }
    draft.sources.add(typeof handler.source === "function" ? handler.source(o as never) : handler.source)
    for (const ip of draft.addresses.keys()) {
      const net = networkOf(ip, this.#networks)
      if (net) draft.networks.add(net.kind === "tailnet" ? "tailnet" : net.iface)
    }
    if (o._tag === "Arp" && o.iface) draft.networks.add(o.iface)
    draft.lastSeenMs = now
    if (o._tag !== "Arp") draft.lastHeardMs = now
    const device = snapshot(draft)
    const fields = fieldsOf(device)
    const wasLive = (draft.reportedId !== undefined && !draft.gone) || absorbedLive
    if (draft.reportedId !== undefined && draft.reportedId !== device.id) formerIds.push(draft.reportedId)
    const changed = fields !== draft.reportedFields || formerIds.length > 0
    draft.reportedId = device.id
    draft.reportedFields = fields
    draft.gone = false
    if (!wasLive) return { _tag: "DeviceAdded", device }
    return changed ? { _tag: "DeviceUpdated", device, formerIds } : undefined
  }

  /**
   * Marks as gone every live device quiet since `now - staleAfterMs`, and drops addresses a live device has not been
   * at since then, as after a DHCP move. A device with a known open port can answer a liveness check, so only its own
   * answers count, not ARP.
   */
  expire(now: number, staleAfterMs: number): ReadonlyArray<DeviceEvent> {
    const events: Array<DeviceEvent> = []
    for (const draft of this.#drafts.values()) {
      if (draft.gone) continue
      const last = draft.openPorts.size > 0 ? draft.lastHeardMs : draft.lastSeenMs
      if (last <= now - staleAfterMs) {
        draft.gone = true
        events.push({ _tag: "DeviceGone", device: snapshot(draft) })
        continue
      }
      const stale = [...draft.addresses].filter(([, a]) => freshness(draft, a) <= now - staleAfterMs)
      if (stale.length === 0 || stale.length === draft.addresses.size) continue
      for (const [ip] of stale) {
        draft.addresses.delete(ip)
        this.#unlink(draft, `ip:${ip}`)
      }
      const device = snapshot(draft)
      draft.reportedFields = fieldsOf(device)
      events.push({ _tag: "DeviceUpdated", device, formerIds: [] })
    }
    return events
  }

  /**
   * A printer sighted at an address held by a record with a different serial has taken that address over, as when
   * DHCP hands a departed printer's lease to another. The old record loses the address, so the two never merge.
   */
  #reclaimAddresses(keys: ReadonlyArray<Key>): void {
    const serial = keys.find((k) => k.startsWith("sn:"))
    if (serial === undefined) return
    for (const key of keys) {
      if (!key.startsWith("ip:") || !this.#parent.has(key)) continue
      const holder = this.#drafts.get(this.#find(key))!
      if (![...holder.keys].some((k) => k.startsWith("sn:") && k !== serial)) continue
      const wasLive = holder.reportedId !== undefined && !holder.gone
      // Two live printers claiming one address is an address conflict; the newer claim wins, and a record left
      // without an address is gone until its next sighting elsewhere.
      const last = holder.addresses.size === 1 && wasLive ? snapshot(holder) : undefined
      // SAFETY: an `ip:` key's suffix is the address it was made from.
      holder.addresses.delete(key.slice(3) as Ipv4)
      this.#unlink(holder, key)
      if (holder.addresses.size === 0) {
        holder.gone = true
        if (last) this.#reclaimed.push({ _tag: "DeviceGone", device: last })
      } else if (wasLive) {
        const device = snapshot(holder)
        holder.reportedFields = fieldsOf(device)
        this.#reclaimed.push({ _tag: "DeviceUpdated", device, formerIds: [] })
      }
    }
  }

  /**
   * Events for other devices caused by the last `add`: a live printer that lost an address to another printer's
   * sighting. Emit them before the event `add` returned.
   */
  takeReclaimed(): ReadonlyArray<DeviceEvent> {
    return this.#reclaimed.splice(0)
  }

  /**
   * Removes a key from a device, so a later sighting of it starts fresh. After a DHCP move the old address can go to
   * another device, which would otherwise merge into this one through `ip:<old>`. Every remaining key is pointed
   * straight at the root, re-rooting the device when the removed key was its root.
   */
  #unlink(draft: Draft, key: Key): void {
    if (!draft.keys.has(key) || draft.keys.size === 1) return
    const oldRoot = this.#find(key)
    draft.keys.delete(key)
    this.#parent.delete(key)
    const root = oldRoot === key ? [...draft.keys][0]! : oldRoot
    if (root !== oldRoot) {
      this.#drafts.delete(oldRoot)
      this.#drafts.set(root, draft)
    }
    for (const k of draft.keys) this.#parent.set(k, root)
  }

  /** Liveness checks for live devices with an open port, unheard and unchecked for `afterMs`. */
  due(now: number, afterMs: number): ReadonlyArray<Check> {
    const checks: Array<Check> = []
    for (const draft of this.#drafts.values()) {
      const [port] = draft.openPorts
      if (draft.gone || port === undefined) continue
      const ip = current(draft)
      if (now - draft.lastHeardMs < afterMs || now - draft.lastCheckMs < afterMs) continue
      draft.lastCheckMs = now
      checks.push({ ip, port })
    }
    return checks
  }

  /** Devices present now, in address order. */
  devices(): ReadonlyArray<Device> {
    return [...this.#drafts.values()]
      .filter((d) => !d.gone)
      .map(snapshot)
      .sort((a, b) => byIp(a.ip, b.ip) || a.id.localeCompare(b.id))
  }
}
