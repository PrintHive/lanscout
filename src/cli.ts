#!/usr/bin/env node
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import type { DiscoveryOptions } from "./config.ts"
import { ConfigError } from "./config.ts"
import type { Device, Source } from "./domain.ts"
import { discover } from "./discover.ts"
import type { ScanEvent } from "./discover.ts"

const USAGE = `usage: lanscout [options]

  --timeout <ms>          scan budget (default 2000)
  --only <list>           sources: mdns,ssdp,arp,tcp,tailscale (default all)
  --ports <list>          TCP ports to probe
  --subnet <cidr>         extra subnet to sweep, repeatable (mesh nodes, VLANs)
  --interface <name>      restrict to an interface, repeatable (e.g. en0)
  --concurrency <n>       concurrent TCP connects (default 1024)
  --connect-timeout <ms>  per-connect timeout (default 500)
  --tailscale-routes      also sweep subnet routes advertised by tailnet peers
  --json                  print the result as JSON
  --ndjson                stream every update as one JSON line
  -h, --help`

type Format = "table" | "json" | "ndjson"

const parseArgs = (argv: ReadonlyArray<string>): { options: DiscoveryOptions; format: Format } | string => {
  const options: { -readonly [K in keyof DiscoveryOptions]: DiscoveryOptions[K] } = {}
  const subnets: Array<string> = []
  const interfaces: Array<string> = []
  let format: Format = "table"
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!
    const value = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`${flag} needs a value`)
      return v
    }
    const list = () => value().split(",").map((s) => s.trim()).filter(Boolean)
    switch (flag) {
      case "--timeout": options.timeoutMs = Number(value()); break
      case "--only": options.sources = list() as Array<Source>; break
      case "--ports": options.ports = list().map(Number); break
      case "--subnet": subnets.push(value()); break
      case "--interface": interfaces.push(value()); break
      case "--concurrency": options.concurrency = Number(value()); break
      case "--connect-timeout": options.connectTimeoutMs = Number(value()); break
      case "--tailscale-routes": options.tailscale = { sweepRoutes: true }; break
      case "--json": format = "json"; break
      case "--ndjson": format = "ndjson"; break
      case "-h":
      case "--help": return USAGE
      default: throw new Error(`unknown option ${flag}\n\n${USAGE}`)
    }
  }
  if (subnets.length) options.subnets = subnets
  if (interfaces.length) options.interfaces = interfaces
  return { options, format }
}

const table = (devices: ReadonlyArray<Device>): string => {
  const rows = devices.map((d) => [
    d.ips.join(" "),
    d.macs.join(" "),
    (d.tailscale?.dnsName ?? d.hostnames[0]) ?? "",
    d.networks.join(","),
    d.sources.join(","),
    d.openPorts.join(","),
    d.services.join(" ")
  ])
  const head = ["IP", "MAC", "NAME", "NETWORK", "SOURCES", "PORTS", "SERVICES"]
  const widths = head.map((h, i) => Math.min(48, Math.max(h.length, ...rows.map((r) => r[i]!.length))))
  const fmt = (r: ReadonlyArray<string>) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]!))).join("  ")
  return [fmt(head), ...rows.map(fmt)].join("\n")
}

const main = (argv: ReadonlyArray<string>) => {
  let parsed: ReturnType<typeof parseArgs>
  try {
    parsed = parseArgs(argv)
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`)
    process.exitCode = 2
    return
  }
  if (typeof parsed === "string") {
    process.stdout.write(`${parsed}\n`)
    return
  }
  const { format, options } = parsed
  const onEvent = format === "ndjson" ? (e: ScanEvent) => process.stdout.write(`${JSON.stringify(e)}\n`) : undefined
  const fiber = Effect.runFork(discover(options, onEvent))
  process.once("SIGINT", () => Effect.runFork(Fiber.interrupt(fiber)))
  fiber.addObserver((exit) => {
    if (Exit.isFailure(exit)) {
      if (Cause.hasInterruptsOnly(exit.cause)) return
      const error = Cause.squash(exit.cause)
      process.stderr.write(error instanceof ConfigError ? `${error.message}\n` : `${Cause.pretty(exit.cause)}\n`)
      process.exitCode = error instanceof ConfigError ? 2 : 1
      return
    }
    const { devices, elapsedMs, failures } = exit.value
    if (format === "json") process.stdout.write(`${JSON.stringify(devices, null, 2)}\n`)
    else if (format === "table") process.stdout.write(`${table(devices)}\n`)
    for (const f of failures) process.stderr.write(`warning: ${f.source}: ${f.message}\n`)
    process.stderr.write(`${devices.length} devices in ${elapsedMs}ms\n`)
  })
}

main(process.argv.slice(2))
