import * as os from "node:os"
import * as Effect from "effect/Effect"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import type { Config, DiscoveryOptions } from "./config.ts"
import { ConfigError, resolveConfig } from "./config.ts"
import type { Device, Ipv4, Observation, Source } from "./domain.ts"
import { SourceFailed } from "./domain.ts"
import { localNetworks } from "./network.ts"
import { Registry } from "./registry.ts"
import { arp } from "./sources/arp.ts"
import { mdns } from "./sources/mdns.ts"
import { printer } from "./sources/printer.ts"
import { ssdp } from "./sources/ssdp.ts"
import { tailscaleStatus } from "./sources/tailscale.ts"
import { routedTargets, tcp } from "./sources/tcp.ts"

type TailnetPeers = Effect.Effect<ReadonlyArray<Observation>, SourceFailed>

type Prober = "tcp" | "printer"

/** Sources that find hosts on their own. */
const discoverers: {
  readonly [S in Exclude<Source, Prober>]: (cfg: Config, tailnet: TailnetPeers) => Stream.Stream<Observation, SourceFailed>
} = {
  mdns: (cfg) => mdns(cfg),
  ssdp: (cfg) => ssdp(cfg),
  arp: (cfg) => arp(cfg),
  tailscale: (_cfg, tailnet) => Stream.fromIterableEffect(tailnet)
}

/** Sources that examine each live host the discoverers report, plus routed targets. */
const probers: { readonly [S in Prober]: (cfg: Config, targets: Stream.Stream<Ipv4>) => Stream.Stream<Observation> } = {
  tcp,
  printer
}

const isProber = (s: Source): s is Prober => s in probers

/** Addresses an observation proves are reachable now. */
const liveIps = (o: Observation): ReadonlyArray<Ipv4> =>
  o._tag === "Tailscale" ? (o.online ? o.tailnetIps : []) : o._tag === "Tcp" ? [] : [o.ip]

export type ScanEvent =
  | { readonly _tag: "DeviceUpdated"; readonly device: Device }
  | SourceFailed

export interface ScanResult {
  readonly devices: ReadonlyArray<Device>
  readonly failures: ReadonlyArray<SourceFailed>
  readonly elapsedMs: number
}

export const config = (options: DiscoveryOptions = {}): Effect.Effect<Config, ConfigError> =>
  Effect.try({
    try: () => resolveConfig(options, localNetworks(os.networkInterfaces())),
    catch: (e) => (e instanceof ConfigError ? e : new ConfigError(String(e)))
  })

const observe = (cfg: Config): Stream.Stream<Observation | SourceFailed> =>
  Stream.unwrap(
    Effect.gen(function*() {
      const tailnet = yield* Effect.cached(tailscaleStatus(cfg))
      const active = [...cfg.sources].filter(isProber)
      const queues = yield* Effect.forEach(active, () => Queue.unbounded<Ipv4>())
      const queued = new Set<Ipv4>(cfg.networks.map((n) => n.address))
      const enqueue = (ips: Iterable<Ipv4>) => {
        for (const ip of ips) {
          if (queued.has(ip)) continue
          queued.add(ip)
          for (const q of queues) Queue.offerUnsafe(q, ip)
        }
      }
      const feed = <E>(stream: Stream.Stream<Observation, E>) =>
        stream.pipe(Stream.tap((o) => Effect.sync(() => enqueue(liveIps(o)))))
      const discovered = [...cfg.sources].flatMap((s) => (isProber(s) ? [] : [s])).map((s) =>
        feed(discoverers[s](cfg, tailnet)).pipe(Stream.catch((failure) => Stream.succeed(failure)))
      )
      const feeder = active.length > 0 && !cfg.sources.has("arp") ? [feed(arp(cfg)).pipe(Stream.drain, Stream.ignore)] : []
      const routed = Stream.fromEffect(
        Effect.map(
          cfg.sweepTailscaleRoutes ? Effect.orElseSucceed(tailnet, () => []) : Effect.succeed([]),
          (peers) => enqueue(routedTargets(cfg, peers))
        )
      ).pipe(Stream.drain)
      const probing = active.map((s, i) => probers[s](cfg, Stream.fromQueue(queues[i]!)))
      return Stream.mergeAll([...discovered, ...feeder, ...(active.length > 0 ? [routed] : []), ...probing], {
        concurrency: "unbounded"
      }).pipe(Stream.interruptWhen(Effect.sleep(`${cfg.timeoutMs} millis`)))
    })
  )

const fold = (cfg: Config, onEvent: (event: ScanEvent) => void) =>
  Effect.gen(function*() {
    const start = Date.now()
    const registry = new Registry(cfg.networks)
    const failures: Array<SourceFailed> = []
    yield* Stream.runForEach(observe(cfg), (event) =>
      Effect.sync(() => {
        if (event instanceof SourceFailed) {
          failures.push(event)
          onEvent(event)
        } else {
          onEvent({ _tag: "DeviceUpdated", device: registry.add(event, Date.now()) })
        }
      })
    )
    return { devices: registry.devices(), failures, elapsedMs: Date.now() - start } satisfies ScanResult
  })

/** Live updates: a `DeviceUpdated` each time an observation adds to a device, plus source failures. */
export const scan = (options: DiscoveryOptions = {}): Stream.Stream<ScanEvent, ConfigError> =>
  Stream.unwrap(
    Effect.map(config(options), (cfg) =>
      Stream.callback<ScanEvent>((queue) =>
        fold(cfg, (e) => Queue.offerUnsafe(queue, e)).pipe(Effect.andThen(Effect.sync(() => Queue.endUnsafe(queue))))
      )
    )
  )

/** Runs one scan to its deadline and returns the merged devices. */
export const discover = (
  options: DiscoveryOptions = {},
  onEvent: (event: ScanEvent) => void = () => {}
): Effect.Effect<ScanResult, ConfigError> => Effect.flatMap(config(options), (cfg) => fold(cfg, onEvent))

/** Promise entry point for callers that do not use Effect. */
export const discoverDevices = (options: DiscoveryOptions = {}, signal?: AbortSignal): Promise<ScanResult> =>
  Effect.runPromise(discover(options), signal ? { signal } : undefined)
