import * as os from "node:os"
import * as Effect from "effect/Effect"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import type { Config, DiscoveryOptions, WatchOptions } from "./config.ts"
import { ConfigError, resolveConfig, scanWindow } from "./config.ts"
import type { Device, Ipv4, Observation, ScanEvent, Source } from "./domain.ts"
import { SourceFailed } from "./domain.ts"
import { localNetworks } from "./network.ts"
import type { Check } from "./registry.ts"
import { Registry } from "./registry.ts"
import { arp } from "./sources/arp.ts"
import { mdns } from "./sources/mdns.ts"
import { printer } from "./sources/printer.ts"
import { ssdp } from "./sources/ssdp.ts"
import { tailscale, tailscaleStatus } from "./sources/tailscale.ts"
import { liveness, routedTargets, tcp } from "./sources/tcp.ts"

type TailnetPeers = Effect.Effect<ReadonlyArray<Observation>, SourceFailed>

type Prober = "tcp" | "printer"

/** Sources that find hosts on their own. */
const discoverers: {
  readonly [S in Exclude<Source, Prober>]: (cfg: Config, tailnet: TailnetPeers) => Stream.Stream<Observation, SourceFailed>
} = {
  mdns: (cfg) => mdns(cfg),
  ssdp: (cfg) => ssdp(cfg),
  arp: (cfg) => arp(cfg),
  tailscale
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

export interface ScanResult {
  readonly devices: ReadonlyArray<Device>
  readonly failures: ReadonlyArray<SourceFailed>
  readonly elapsedMs: number
}

const config = (options: () => WatchOptions): Effect.Effect<Config, ConfigError> =>
  Effect.try({
    try: () => resolveConfig(options(), localNetworks(os.networkInterfaces())),
    catch: (e) => (e instanceof ConfigError ? e : new ConfigError(String(e)))
  })

/** Asks the fold to expire devices that have gone quiet. */
const tick = { _tag: "Tick" } as const

const observe = (cfg: Config, checks: Queue.Queue<Check>): Stream.Stream<Observation | SourceFailed | typeof tick> =>
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
      const ticks: Stream.Stream<Observation | SourceFailed | typeof tick> = Stream.map(Stream.tick("1 second"), () => tick)
      const merged = Stream.mergeAll([...discovered, ...feeder, ...(active.length > 0 ? [routed] : []), ...probing, liveness(Stream.fromQueue(checks)), ticks], {
        concurrency: "unbounded"
      })
      return cfg.watchForMs === undefined ? merged : merged.pipe(Stream.interruptWhen(Effect.sleep(`${cfg.watchForMs} millis`)))
    })
  )

const fold = (cfg: Config, onEvent: (event: ScanEvent) => void) =>
  Effect.gen(function*() {
    const start = Date.now()
    const registry = new Registry(cfg.networks)
    const checks = yield* Queue.unbounded<Check>()
    const failures: Array<SourceFailed> = []
    yield* Stream.runForEach(observe(cfg, checks), (item) =>
      Effect.sync(() => {
        if (item instanceof SourceFailed) {
          failures.push(item)
          onEvent(item)
        } else if (item._tag === "Tick") {
          const now = Date.now()
          for (const event of registry.expire(now, cfg.staleAfterMs)) onEvent(event)
          for (const check of registry.due(now, cfg.roundMaxMs)) Queue.offerUnsafe(checks, check)
        } else {
          const event = registry.add(item, Date.now())
          for (const reclaimed of registry.takeReclaimed()) onEvent(reclaimed)
          if (event) onEvent(event)
        }
      })
    )
    return { devices: registry.devices(), failures, elapsedMs: Date.now() - start } satisfies ScanResult
  })

/**
 * Watches the network: `DeviceAdded` when a device first appears or returns, `DeviceUpdated`
 * when one changes, `DeviceGone` after `staleAfterMs` without a sighting, plus source failures.
 * Runs until interrupted, or for `watchForMs` and then ends.
 */
export const watch = (options: WatchOptions = {}): Stream.Stream<ScanEvent, ConfigError> =>
  Stream.unwrap(
    Effect.map(config(() => options), (cfg) =>
      Stream.callback<ScanEvent>((queue) =>
        fold(cfg, (e) => Queue.offerUnsafe(queue, e)).pipe(Effect.andThen(Effect.sync(() => Queue.endUnsafe(queue))))
      )
    )
  )

/** Runs one scan to its deadline and returns the merged devices. */
export const discover = (
  options: DiscoveryOptions = {},
  onEvent: (event: ScanEvent) => void = () => {}
): Effect.Effect<ScanResult, ConfigError> => Effect.flatMap(config(() => scanWindow(options)), (cfg) => fold(cfg, onEvent))

/** Promise entry point for callers that do not use Effect. */
export const discoverDevices = (options: DiscoveryOptions = {}, signal?: AbortSignal): Promise<ScanResult> =>
  Effect.runPromise(discover(options), signal ? { signal } : undefined)
