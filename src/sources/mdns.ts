import * as Effect from "effect/Effect"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import type { Config } from "../config.ts"
import type { Ipv4, Observation, SourceFailed } from "../domain.ts"
import { parseIpv4 } from "../domain.ts"
import type { DnsMessage } from "./dns.ts"
import { decodeMessage, encodeQuery, RecordType } from "./dns.ts"
import { openUdp, sendVia } from "./udp.ts"

const GROUP = "224.0.0.251"
const PORT = 5353
const META = "_services._dns-sd._udp.local"

/**
 * Seeds alongside the DNS-SD meta query. Thread border routers (`_meshcop`) and Matter
 * (`_matter`, `_matterc`) cover mesh smart-home fabrics; the rest are common LAN services.
 */
export const seedServiceTypes: ReadonlyArray<string> = [
  "_http._tcp.local", "_googlecast._tcp.local", "_airplay._tcp.local", "_raop._tcp.local",
  "_ipp._tcp.local", "_printer._tcp.local", "_hap._tcp.local", "_smb._tcp.local",
  "_companion-link._tcp.local", "_spotify-connect._tcp.local", "_sonos._tcp.local",
  "_meshcop._udp.local", "_matter._tcp.local", "_matterc._udp.local", "_ssh._tcp.local", "_workstation._tcp.local"
]

const serviceTypeOf = (instance: string): string | undefined => {
  const labels = instance.split(".")
  const i = labels.findIndex((l, idx) => l.startsWith("_") && labels[idx + 1]?.startsWith("_"))
  return i === -1 ? undefined : `${labels[i]}.${labels[i + 1]}`
}

/** Service types advertised in answers to the DNS-SD meta query, for a follow-up round. */
export const advertisedServiceTypes = (msg: DnsMessage): ReadonlyArray<string> =>
  msg.records.flatMap((r) => (r.type === "PTR" && r.name.toLowerCase() === META ? [r.target] : []))

/** Groups one response's records into an observation per IPv4 host it describes. */
export const observationsFromMessage = (msg: DnsMessage, from: Ipv4): ReadonlyArray<Observation> => {
  if (!msg.isResponse) return []
  const hostIp = new Map<string, Ipv4>()
  for (const r of msg.records) {
    const ip = r.type === "A" ? parseIpv4(r.address) : undefined
    if (ip) hostIp.set(r.name.toLowerCase(), ip)
  }
  const byIp = new Map<Ipv4, { hostname?: string; services: Set<string> }>()
  const entry = (ip: Ipv4) => {
    let e = byIp.get(ip)
    if (!e) byIp.set(ip, (e = { services: new Set() }))
    return e
  }
  for (const [host, ip] of hostIp) entry(ip).hostname ??= host
  const srvHost = new Map<string, string>()
  for (const r of msg.records) if (r.type === "SRV") srvHost.set(r.name.toLowerCase(), r.target.toLowerCase())
  const addService = (instance: string) => {
    const type = serviceTypeOf(instance)
    if (!type) return
    const host = srvHost.get(instance.toLowerCase())
    const ip = (host && hostIp.get(host)) || from
    const e = entry(ip)
    e.services.add(type)
    if (host && !hostIp.has(host)) e.hostname ??= host
  }
  for (const r of msg.records) {
    if (r.type === "PTR" && r.name.toLowerCase() !== META && r.name.startsWith("_")) addService(r.target)
    else if (r.type === "SRV") addService(r.name)
  }
  return [...byIp].map(([ip, e]) => ({
    _tag: "Mdns" as const,
    ip,
    ...(e.hostname ? { hostname: e.hostname } : {}),
    services: [...e.services]
  }))
}

const query = (names: ReadonlyArray<string>) => encodeQuery(names.map((name) => ({ name, type: RecordType.PTR })))

export const mdns = (cfg: Config): Stream.Stream<Observation, SourceFailed> =>
  Stream.callback<Observation, SourceFailed>((queue) =>
    Effect.gen(function*() {
      const lans = cfg.networks.filter((n) => n.kind === "lan")
      const socket = yield* openUdp("mdns", PORT)
      for (const n of lans) {
        try {
          socket.addMembership(GROUP, n.address)
        } catch {
          // Already joined on this interface by an earlier attachment with the same address.
        }
      }
      const asked = new Set<string>([META, ...seedServiceTypes])
      const pending: Array<string> = []
      socket.on("message", (buf, rinfo) => {
        const from = parseIpv4(rinfo.address)
        if (!from) return
        let msg: DnsMessage
        try {
          msg = decodeMessage(buf)
        } catch {
          return
        }
        for (const o of observationsFromMessage(msg, from)) Queue.offerUnsafe(queue, o)
        for (const t of advertisedServiceTypes(msg)) {
          if (!asked.has(t)) {
            asked.add(t)
            pending.push(t)
          }
        }
      })
      const broadcast = (payload: Buffer) =>
        Effect.forEach(lans, (n) => sendVia(socket, payload, PORT, GROUP, n.address), { discard: true })
      yield* broadcast(query([...asked]))
      yield* Effect.sleep("300 millis")
      yield* broadcast(query([...asked]))
      for (let round = 0; round < 3; round++) {
        yield* Effect.sleep("200 millis")
        if (pending.length > 0) yield* broadcast(query(pending.splice(0)))
      }
      yield* Effect.never
    })
  )
