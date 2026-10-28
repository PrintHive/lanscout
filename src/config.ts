import type { Network, Source } from "./domain.ts"
import { allSources } from "./domain.ts"
import { parseCidr } from "./network.ts"

/** What to look for and how hard. Shared by `discover` and `watch`. */
export interface SourceOptions {
  readonly sources?: ReadonlyArray<Source>
  /** Concurrent TCP connects. Default 1024. */
  readonly concurrency?: number
  /** Per-connect timeout in milliseconds. Default 500. */
  readonly connectTimeoutMs?: number
  readonly ports?: ReadonlyArray<number>
  /** Extra CIDRs to sweep, such as mesh or VLAN subnets this machine is not attached to. */
  readonly subnets?: ReadonlyArray<string>
  /** Upper bound on hosts swept per subnet. Default 1024. */
  readonly maxHostsPerSubnet?: number
  /** Interface names to restrict to, e.g. `["en0"]`. Default: every non-internal IPv4 interface. */
  readonly interfaces?: ReadonlyArray<string>
  readonly tailscale?: {
    readonly binary?: string
    /** Also sweep the LAN subnets that tailnet peers advertise as subnet routes. Default false. */
    readonly sweepRoutes?: boolean
  }
}

export interface DiscoveryOptions extends SourceOptions {
  /** Total scan budget in milliseconds. Default 2000. */
  readonly timeoutMs?: number
}

export interface WatchOptions extends SourceOptions {
  /** Stop after this many milliseconds. Default: watch until interrupted. */
  readonly watchForMs?: number
  /** Report a device gone after this long without a sighting. Default 180000. */
  readonly staleAfterMs?: number
}

export interface Subnet {
  readonly base: Network["address"]
  readonly prefix: number
}

export interface Config {
  /** Undefined watches until interrupted. */
  readonly watchForMs: number | undefined
  readonly staleAfterMs: number
  /**
   * Longest gap between ARP, SSDP, and Tailscale rounds: a third of `staleAfterMs`, at most a
   * minute, so a device that stays is re-sighted at least twice before it could go stale.
   */
  readonly roundMaxMs: number
  readonly sources: ReadonlySet<Source>
  readonly concurrency: number
  readonly connectTimeoutMs: number
  readonly ports: ReadonlyArray<number>
  readonly subnets: ReadonlyArray<Subnet>
  readonly maxHostsPerSubnet: number
  readonly networks: ReadonlyArray<Network>
  readonly tailscaleBinaries: ReadonlyArray<string>
  readonly sweepTailscaleRoutes: boolean
}

/** Ordered by how often they answer on home and office LANs, so early probes find hosts first. */
export const defaultPorts: ReadonlyArray<number> = [80, 443, 22, 62078, 445, 8080, 554, 631, 9100, 548, 8443, 5000, 8008, 1883, 8883, 7125]

export class ConfigError extends Error {
  override readonly name = "ConfigError"
}

const positiveInt = (name: string, value: number | undefined, fallback: number): number => {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value <= 0) throw new ConfigError(`${name} must be a positive integer, got ${value}`)
  return value
}

/** A scan is a watch with a deadline. */
export const scanWindow = ({ timeoutMs, ...options }: DiscoveryOptions): WatchOptions => ({
  ...options,
  watchForMs: positiveInt("timeoutMs", timeoutMs, 2000)
})

export const resolveConfig = (options: WatchOptions, networks: ReadonlyArray<Network>): Config => {
  const sources = options.sources ?? allSources
  for (const s of sources) if (!allSources.includes(s)) throw new ConfigError(`unknown source "${s}"`)
  const subnets = (options.subnets ?? []).map((raw) => {
    const cidr = parseCidr(raw)
    if (!cidr) throw new ConfigError(`invalid CIDR "${raw}"`)
    return cidr
  })
  const ports = options.ports ?? defaultPorts
  for (const p of ports) if (!Number.isInteger(p) || p < 1 || p > 65535) throw new ConfigError(`invalid port ${p}`)
  const wanted = options.interfaces
  const staleAfterMs = positiveInt("staleAfterMs", options.staleAfterMs, 180_000)
  return {
    watchForMs: options.watchForMs === undefined ? undefined : positiveInt("watchForMs", options.watchForMs, 0),
    staleAfterMs,
    roundMaxMs: Math.min(60_000, Math.floor(staleAfterMs / 3)),
    sources: new Set(sources),
    concurrency: positiveInt("concurrency", options.concurrency, 1024),
    connectTimeoutMs: positiveInt("connectTimeoutMs", options.connectTimeoutMs, 500),
    ports,
    subnets,
    maxHostsPerSubnet: positiveInt("maxHostsPerSubnet", options.maxHostsPerSubnet, 1024),
    networks: wanted ? networks.filter((n) => wanted.includes(n.iface)) : networks,
    tailscaleBinaries: options.tailscale?.binary
      ? [options.tailscale.binary]
      : ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"],
    sweepTailscaleRoutes: options.tailscale?.sweepRoutes ?? false
  }
}
