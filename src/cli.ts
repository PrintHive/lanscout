#!/usr/bin/env node
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import type { DiscoveryOptions } from "./config.ts"
import { ConfigError } from "./config.ts"
import type { Device, Printer, Source } from "./domain.ts"
import { discover } from "./discover.ts"
import type { ScanEvent } from "./discover.ts"

const USAGE = `usage: lanscout [options]

  --printers              list only Bambu Lab and Klipper printers (4000 ms budget)
  --timeout <ms>          scan budget (default 2000)
  --only <list>           sources: mdns,ssdp,arp,tcp,tailscale,printer (default all)
  --ports <list>          TCP ports to probe
  --subnet <cidr>         extra subnet to sweep, repeatable (mesh nodes, VLANs)
  --interface <name>      restrict to an interface, repeatable, such as en0
  --concurrency <n>       concurrent TCP connects (default 1024)
  --connect-timeout <ms>  per-connect timeout (default 500)
  --tailscale-routes      also sweep subnet routes advertised by tailnet peers
  --json                  print the result as JSON
  --ndjson                stream every update as one JSON line
  -h, --help`

type Format = "table" | "json" | "ndjson"

type Column = readonly [header: string, cell: (d: Device) => string]

interface View {
  readonly keep: (d: Device) => boolean
  readonly columns: ReadonlyArray<Column>
  readonly defaults: DiscoveryOptions
  readonly noun: string
}

const printerStatus = (p: Printer): string =>
  (p.kind === "bambu"
    ? [p.mode && `${p.mode} mode`, p.bound === undefined ? undefined : p.bound ? "bound" : "unbound", p.signalDbm === undefined ? undefined : `${p.signalDbm} dBm`]
    : [p.state && `klippy ${p.state}`, p.klipperVersion && `klipper ${p.klipperVersion}`])
    .filter(Boolean).join(", ")

const printerModel = (p: Printer): string =>
  p.kind === "bambu" ? `Bambu Lab ${p.model ?? p.modelCode ?? ""}`.trim() : `${p.manufacturer ?? "Klipper"} ${p.model ?? ""}`.trim()

const views: { readonly [K in "devices" | "printers"]: View } = {
  devices: {
    keep: () => true,
    noun: "devices",
    defaults: {},
    columns: [
      ["IP", (d) => d.ips.join(" ")],
      ["MAC", (d) => d.macs.join(" ")],
      ["NAME", (d) => d.tailscale?.dnsName ?? d.printer?.name ?? d.hostnames[0] ?? ""],
      ["NETWORK", (d) => d.networks.join(",")],
      ["SOURCES", (d) => d.sources.join(",")],
      ["PORTS", (d) => d.openPorts.join(",")],
      ["SERVICES", (d) => d.services.join(" ")]
    ]
  },
  printers: {
    keep: (d) => d.printer !== undefined,
    noun: "printers",
    defaults: { timeoutMs: 4000, sources: ["arp", "mdns", "ssdp", "printer"] },
    columns: [
      ["IP", (d) => d.ips.find((ip) => !ip.startsWith("100.")) ?? d.ips[0] ?? ""],
      ["PRINTER", (d) => printerModel(d.printer!)],
      ["NAME", (d) => d.printer!.name ?? (d.printer!.kind === "klipper" ? d.printer!.hostname : undefined) ?? ""],
      ["SERIAL", (d) => d.printer!.serial ?? ""],
      ["FIRMWARE", (d) => d.printer!.firmware ?? ""],
      ["STATUS", (d) => printerStatus(d.printer!)]
    ]
  }
}

const parseArgs = (argv: ReadonlyArray<string>): { options: DiscoveryOptions; format: Format; view: View } | string => {
  const options: { -readonly [K in keyof DiscoveryOptions]: DiscoveryOptions[K] } = {}
  const subnets: Array<string> = []
  const interfaces: Array<string> = []
  let format: Format = "table"
  let view = views.devices
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
      case "--printers": view = views.printers; break
      case "-h":
      case "--help": return USAGE
      default: throw new Error(`unknown option ${flag}\n\n${USAGE}`)
    }
  }
  if (subnets.length) options.subnets = subnets
  if (interfaces.length) options.interfaces = interfaces
  return { options: { ...view.defaults, ...options }, format, view }
}

const table = (devices: ReadonlyArray<Device>, columns: ReadonlyArray<Column>): string => {
  const rows = devices.map((d) => columns.map(([, cell]) => cell(d)))
  const widths = columns.map(([h], i) => Math.min(48, Math.max(h.length, ...rows.map((r) => r[i]!.length))))
  const fmt = (r: ReadonlyArray<string>) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]!))).join("  ")
  return [fmt(columns.map(([h]) => h)), ...rows.map(fmt)].join("\n")
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
  const { format, options, view } = parsed
  const onEvent = format === "ndjson"
    ? (e: ScanEvent) => {
      if (e._tag !== "DeviceUpdated" || view.keep(e.device)) process.stdout.write(`${JSON.stringify(e)}\n`)
    }
    : undefined
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
    const devices = exit.value.devices.filter(view.keep)
    const { elapsedMs, failures } = exit.value
    if (format === "json") process.stdout.write(`${JSON.stringify(devices, null, 2)}\n`)
    else if (format === "table") process.stdout.write(`${table(devices, view.columns)}\n`)
    for (const f of failures) process.stderr.write(`warning: ${f.source}: ${f.message}\n`)
    process.stderr.write(`${devices.length} ${view.noun} in ${elapsedMs}ms\n`)
  })
}

main(process.argv.slice(2))
