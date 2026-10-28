import * as net from "node:net"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import type { Config } from "../config.ts"
import type { Ipv4, Observation } from "../domain.ts"
import { hostsOf, parseCidr } from "../network.ts"
import type { Check } from "../registry.ts"

type Answer = "open" | "refused" | "silent"

const connect = (ip: Ipv4, port: number, timeoutMs: number) =>
  Effect.callback<Answer>((resume, signal) => {
    const socket = net.connect({ host: ip, port })
    const done = (answer: Answer) => {
      clearTimeout(timer)
      socket.destroy()
      resume(Effect.succeed(answer))
    }
    const timer = setTimeout(() => done("silent"), timeoutMs)
    socket.once("connect", () => done("open"))
    socket.once("error", (e: NodeJS.ErrnoException) => done(e.code === "ECONNREFUSED" ? "refused" : "silent"))
    signal.addEventListener("abort", () => {
      clearTimeout(timer)
      socket.destroy()
    }, { once: true })
  })

/**
 * Off-link targets: explicit subnets and, when enabled, subnet routes advertised by online
 * tailnet peers. Packets to them go through a gateway, so sweeping them blind costs no ARP.
 */
export const routedTargets = (cfg: Config, tailnet: ReadonlyArray<Observation>): ReadonlyArray<Ipv4> => {
  const targets = new Set<Ipv4>()
  for (const s of cfg.subnets) for (const ip of hostsOf(s.base, s.prefix, cfg.maxHostsPerSubnet)) targets.add(ip)
  if (cfg.sweepTailscaleRoutes) {
    for (const o of tailnet) {
      if (o._tag !== "Tailscale" || !o.online) continue
      for (const route of o.routes) {
        const cidr = parseCidr(route)
        if (cidr && cidr.prefix > 0) for (const ip of hostsOf(cidr.base, cidr.prefix, cfg.maxHostsPerSubnet)) targets.add(ip)
      }
    }
  }
  return [...targets]
}

/** Probes every configured port on each target as it arrives. Targets must be unique. */
export const tcp = (cfg: Config, targets: Stream.Stream<Ipv4>): Stream.Stream<Observation> =>
  targets.pipe(
    Stream.flatMap((ip) => Stream.fromIterable(cfg.ports.map((port) => [ip, port] as const))),
    Stream.mapEffect(
      ([ip, port]) => Effect.map(connect(ip, port, cfg.connectTimeoutMs), (a): Observation | undefined => (a === "open" ? { _tag: "Tcp", ip, port } : undefined)),
      { concurrency: cfg.concurrency, unordered: true }
    ),
    Stream.filter((o): o is Observation => o !== undefined)
  )

/** Outlasts one lost-SYN retransmit, which the kernel sends after 1 s. */
const CHECK_TIMEOUT_MS = 2500

/** Answers liveness checks. A refusal proves the host is up as well as a connection does. */
export const liveness = (checks: Stream.Stream<Check>): Stream.Stream<Observation> =>
  checks.pipe(
    Stream.mapEffect(
      ({ ip, port }) => Effect.map(connect(ip, port, CHECK_TIMEOUT_MS), (a): Observation | undefined => (a === "silent" ? undefined : { _tag: "Alive", ip })),
      { concurrency: 32, unordered: true }
    ),
    Stream.filter((o): o is Observation => o !== undefined)
  )
