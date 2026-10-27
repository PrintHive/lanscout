import { readFile } from "node:fs/promises"
import * as Effect from "effect/Effect"
import * as Schedule from "effect/Schedule"
import * as Stream from "effect/Stream"
import type { Config } from "../config.ts"
import type { Ipv4, Observation, SourceFailed } from "../domain.ts"
import { parseIpv4, parseMac } from "../domain.ts"
import { hostsOf } from "../network.ts"
import { exec } from "./exec.ts"
import { openUdp, sendVia } from "./udp.ts"

const ARP_LINE = /\((\d+\.\d+\.\d+\.\d+)\) at ([0-9a-fA-F:]+)(?:\s+\[\w+\])?\s+on\s+(\S+)/

/** Parses `arp -an` from macOS/BSD (`at 8c:3b:ad:1:2:3 on en0 ifscope`) and Linux (`at .. [ether] on eth0`). */
export const parseArpTable = (text: string): ReadonlyArray<Observation> =>
  text.split("\n").flatMap((line) => {
    const m = ARP_LINE.exec(line)
    const ip = m && parseIpv4(m[1]!)
    const mac = m && parseMac(m[2]!)
    return ip && mac ? [{ _tag: "Arp" as const, ip, mac, iface: m[3]! }] : []
  })

/** Parses Linux `/proc/net/arp`. Flags 0x0 marks an incomplete entry. */
export const parseProcNetArp = (text: string): ReadonlyArray<Observation> =>
  text.split("\n").slice(1).flatMap((line) => {
    const [rawIp, , flags, rawMac, , iface] = line.trim().split(/\s+/)
    const ip = rawIp && parseIpv4(rawIp)
    const mac = rawMac && flags !== "0x0" ? parseMac(rawMac) : undefined
    return ip && mac && iface ? [{ _tag: "Arp" as const, ip, mac, iface }] : []
  })

const readTable: Effect.Effect<ReadonlyArray<Observation>, SourceFailed> = Effect.tryPromise(() =>
  readFile("/proc/net/arp", "utf8")
).pipe(
  Effect.map(parseProcNetArp),
  Effect.catch(() => exec("arp", "arp", ["-an"]).pipe(Effect.map(parseArpTable)))
)

/** Every address on each attached LAN, the hosts whose MACs the kernel can resolve. */
export const lanHosts = (cfg: Config): ReadonlyArray<Ipv4> => {
  const hosts = new Set<Ipv4>()
  for (const n of cfg.networks) {
    if (n.kind !== "lan" || n.prefix >= 31) continue
    for (const ip of hostsOf(n.address, n.prefix, cfg.maxHostsPerSubnet, n.address, n.address)) hosts.add(ip)
  }
  return [...hosts]
}

/**
 * An empty datagram to the discard port makes the kernel ARP the address without holding a
 * socket or retransmitting SYNs. Paced, because Wi-Fi sends broadcasts at the lowest basic
 * rate and a burst of hundreds of ARPs starves real traffic on the link.
 */
const nudge = (hosts: ReadonlyArray<Ipv4>) =>
  Effect.scoped(
    Effect.gen(function*() {
      const socket = yield* openUdp("arp", 0)
      for (let i = 0; i < hosts.length; i += 8) {
        yield* Effect.forEach(hosts.slice(i, i + 8), (ip) => sendVia(socket, Buffer.alloc(0), 9, ip), { discard: true })
        yield* Effect.sleep("2 millis")
      }
    })
  ).pipe(Effect.ignore)

/** Reads the neighbour table, nudges every LAN address, then re-reads until the deadline and emits new entries. */
export const arp = (cfg: Config): Stream.Stream<Observation, SourceFailed> =>
  Stream.unwrap(
    Effect.gen(function*() {
      const seen = new Set<string>()
      const fresh = (entries: ReadonlyArray<Observation>) =>
        entries.filter((o) => {
          const key = o._tag === "Arp" ? `${o.ip}|${o.mac}` : ""
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
      const first = yield* readTable
      yield* Effect.forkScoped(nudge(lanHosts(cfg)))
      const polls = Stream.fromEffect(Effect.delay(readTable, "250 millis")).pipe(
        Stream.repeat(Schedule.spaced("250 millis")),
        Stream.flatMap((entries) => Stream.fromIterable(fresh(entries)))
      )
      return Stream.fromIterable(fresh(first)).pipe(Stream.concat(polls))
    })
  )
