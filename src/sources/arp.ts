import { readFile } from "node:fs/promises"
import * as Effect from "effect/Effect"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import type { Config } from "../config.ts"
import type { Ipv4, Observation, SourceFailed } from "../domain.ts"
import { parseIpv4, parseMac } from "../domain.ts"
import { hostsOf } from "../network.ts"
import { exec } from "./exec.ts"
import { repeatRounds } from "./rounds.ts"
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

/**
 * Parses Windows `arp -a`, which groups entries under an `Interface: <address> --- 0x5` line and writes MACs with
 * dashes. The interface's address stands in for its name.
 */
export const parseWindowsArp = (text: string): ReadonlyArray<Observation> => {
  let iface: string | undefined
  return text.split(/\r?\n/).flatMap((line) => {
    const header = /^Interface:\s+(\d+\.\d+\.\d+\.\d+)/.exec(line)
    if (header) {
      iface = header[1]
      return []
    }
    const [rawIp, rawMac] = line.trim().split(/\s+/)
    const ip = rawIp && parseIpv4(rawIp)
    const mac = rawMac && parseMac(rawMac)
    return ip && mac && iface ? [{ _tag: "Arp" as const, ip, mac, iface }] : []
  })
}

const readTable: Effect.Effect<ReadonlyArray<Observation>, SourceFailed> =
  process.platform === "win32"
    ? exec("arp", "arp", ["-a"]).pipe(Effect.map(parseWindowsArp))
    : Effect.tryPromise(() => readFile("/proc/net/arp", "utf8")).pipe(
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

/**
 * Reads the neighbour table, then each round nudges every LAN address and re-reads the table
 * every 250 ms for 2 s. Every read emits the whole table, so devices that stay are re-sighted.
 */
export const arp = (cfg: Config): Stream.Stream<Observation, SourceFailed> =>
  Stream.callback<Observation, SourceFailed>((queue) =>
    Effect.gen(function*() {
      const read = Effect.map(readTable, (entries) => {
        for (const o of entries) Queue.offerUnsafe(queue, o)
      })
      const round = Effect.gen(function*() {
        yield* Effect.forkScoped(nudge(lanHosts(cfg)))
        for (let i = 0; i < 8; i++) yield* Effect.andThen(Effect.sleep("250 millis"), read)
      })
      yield* read
      yield* round
      return yield* repeatRounds(round, cfg.roundMaxMs)
    })
  )
