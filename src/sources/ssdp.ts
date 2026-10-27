import type * as dgram from "node:dgram"
import * as Effect from "effect/Effect"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import type { Config } from "../config.ts"
import type { Ipv4, Observation, SourceFailed } from "../domain.ts"
import { parseIpv4 } from "../domain.ts"
import { broadcastOf } from "../network.ts"
import { BAMBU_NT, bambuFromSsdpHeaders } from "../printers/bambu.ts"
import { bindUdp, openUdp, sendVia } from "./udp.ts"

const GROUP = "239.255.255.250"
const PORT = 1900
/** Bambu printers announce on these instead of 1900. */
const BAMBU_PORTS = [1990, 2021] as const

type SsdpObservation = Extract<Observation, { _tag: "Ssdp" | "Printer" }>

const search = (host: string, st: string) =>
  Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: ${host}\r\nMAN: "ssdp:discover"\r\nMX: 1\r\nST: ${st}\r\n\r\n`)

const SEARCH_ALL = search(`${GROUP}:${PORT}`, "ssdp:all")

/**
 * Parses an HTTP-over-UDP response or NOTIFY. Header names are case-insensitive per UPnP.
 * A Bambu Lab announcement becomes a `Printer` observation; anything else is plain `Ssdp`.
 */
export const parseSsdp = (text: string, from: Ipv4): SsdpObservation | undefined => {
  const [status, ...lines] = text.split(/\r?\n/)
  if (!status || !/^(HTTP\/1\.[01] 200|NOTIFY )/i.test(status)) return undefined
  const headers = new Map<string, string>()
  for (const line of lines) {
    const i = line.indexOf(":")
    if (i > 0) headers.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim())
  }
  const printer = bambuFromSsdpHeaders(headers)
  if (printer) return { _tag: "Printer", ip: from, via: "ssdp", printer }
  const usn = headers.get("usn")
  const server = headers.get("server")
  const location = headers.get("location")
  return {
    _tag: "Ssdp",
    ip: from,
    ...(usn ? { usn } : {}),
    ...(server ? { server } : {}),
    ...(location ? { location } : {})
  }
}

const dedupeKey = (o: SsdpObservation): string =>
  o._tag === "Ssdp" ? `${o.ip}|${o.usn ?? ""}|${o.location ?? ""}` : `${o.ip}|printer`

export const ssdp = (cfg: Config): Stream.Stream<Observation, SourceFailed> =>
  Stream.callback<Observation, SourceFailed>((queue) =>
    Effect.gen(function*() {
      const lans = cfg.networks.filter((n) => n.kind === "lan")
      const seen = new Set<string>()
      const onMessage = (buf: Buffer, rinfo: dgram.RemoteInfo) => {
        const from = parseIpv4(rinfo.address)
        if (!from || lans.some((n) => n.address === from)) return
        const o = parseSsdp(buf.toString("utf8"), from)
        if (!o) return
        const key = dedupeKey(o)
        if (seen.has(key)) return
        seen.add(key)
        Queue.offerUnsafe(queue, o)
      }
      const socket = yield* openUdp("ssdp", 0)
      socket.setBroadcast(true)
      socket.on("message", onMessage)
      for (const port of BAMBU_PORTS) {
        const listener = yield* Effect.option(bindUdp("ssdp", port))
        if (listener._tag === "None") continue
        for (const n of lans) {
          try {
            listener.value.addMembership(GROUP, n.address)
          } catch {
            // Already joined via another attachment with the same address.
          }
        }
        listener.value.on("message", onMessage)
      }
      const round = Effect.forEach(lans, (n) =>
        Effect.andThen(
          sendVia(socket, SEARCH_ALL, PORT, GROUP, n.address),
          Effect.forEach(BAMBU_PORTS, (port) => sendVia(socket, search(`${GROUP}:${port}`, BAMBU_NT), port, broadcastOf(n)), { discard: true })
        ), { discard: true })
      yield* round
      yield* Effect.sleep("300 millis")
      yield* round
      yield* Effect.never
    })
  )
