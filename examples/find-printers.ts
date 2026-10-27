#!/usr/bin/env node
/**
 * Lists the Bambu Lab and Klipper printers on the local network.
 *
 *   node examples/find-printers.ts [--json] [--timeout 4000] [--subnet 10.0.20.0/24]
 */
import type { Device, Printer } from "../src/index.ts"
import { discoverDevices } from "../src/index.ts"

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}
const subnets = args.flatMap((a, i) => (args[i - 1] === "--subnet" ? [a] : []))

const { devices, elapsedMs } = await discoverDevices({
  timeoutMs: Number(flag("--timeout") ?? 4000),
  sources: ["arp", "mdns", "ssdp", "printer"],
  ...(subnets.length > 0 ? { subnets } : {})
})

const printers = devices.filter((d): d is Device & { printer: Printer } => d.printer !== undefined)

const describe = (p: Printer): string =>
  p.kind === "bambu"
    ? [p.mode && `${p.mode} mode`, p.bound !== undefined && (p.bound ? "bound" : "unbound"), p.signalDbm !== undefined && `${p.signalDbm} dBm`]
      .filter(Boolean).join(", ")
    : [p.state && `klippy ${p.state}`, p.klipperVersion && `klipper ${p.klipperVersion}`].filter(Boolean).join(", ")

const row = (d: Device & { printer: Printer }) => {
  const p = d.printer
  const make = p.kind === "bambu" ? "Bambu Lab" : p.manufacturer ?? "Klipper"
  return [
    d.ips.find((ip) => !ip.startsWith("100.")) ?? d.ips[0] ?? "",
    `${make} ${p.model ?? (p.kind === "bambu" ? p.modelCode ?? "" : "")}`.trim(),
    p.name ?? (p.kind === "klipper" ? p.hostname : undefined) ?? "",
    p.serial ?? "",
    p.firmware ?? "",
    describe(p)
  ]
}

if (args.includes("--json")) {
  process.stdout.write(`${JSON.stringify(printers.map((d) => ({ ips: d.ips, macs: d.macs, printer: d.printer })), null, 2)}\n`)
} else {
  const head = ["IP", "PRINTER", "NAME", "SERIAL", "FIRMWARE", "STATUS"]
  const rows = printers.map(row)
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)))
  for (const r of [head, ...rows]) process.stdout.write(`${r.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd()}\n`)
}
const bambu = printers.filter((d) => d.printer.kind === "bambu").length
process.stderr.write(`${bambu} Bambu Lab and ${printers.length - bambu} Klipper printers in ${elapsedMs}ms\n`)
