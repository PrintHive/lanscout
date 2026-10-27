import * as Effect from "effect/Effect"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import type { Config } from "../config.ts"
import type { Ipv4, Observation, SourceFailed } from "../domain.ts"
import { parseIpv4 } from "../domain.ts"
import { openUdp, sendVia } from "./udp.ts"

const GROUP = "239.255.255.250"
const PORT = 1900

const SEARCH = Buffer.from(
  `M-SEARCH * HTTP/1.1\r\nHOST: ${GROUP}:${PORT}\r\nMAN: "ssdp:discover"\r\nMX: 1\r\nST: ssdp:all\r\n\r\n`
)

/** Parses an HTTP-over-UDP response or NOTIFY. Header names are case-insensitive per UPnP. */
export const parseSsdp = (text: string, from: Ipv4): Observation | undefined => {
  const [status, ...lines] = text.split(/\r?\n/)
  if (!status || !/^(HTTP\/1\.[01] 200|NOTIFY )/i.test(status)) return undefined
  const headers = new Map<string, string>()
  for (const line of lines) {
    const i = line.indexOf(":")
    if (i > 0) headers.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim())
  }
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

export const ssdp = (cfg: Config): Stream.Stream<Observation, SourceFailed> =>
  Stream.callback<Observation, SourceFailed>((queue) =>
    Effect.gen(function*() {
      const lans = cfg.networks.filter((n) => n.kind === "lan")
      const socket = yield* openUdp("ssdp", 0)
      const seen = new Set<string>()
      socket.on("message", (buf, rinfo) => {
        const from = parseIpv4(rinfo.address)
        if (!from) return
        const o = parseSsdp(buf.toString("latin1"), from)
        if (!o || o._tag !== "Ssdp") return
        const key = `${o.ip}|${o.usn ?? ""}|${o.location ?? ""}`
        if (seen.has(key)) return
        seen.add(key)
        Queue.offerUnsafe(queue, o)
      })
      const search = Effect.forEach(lans, (n) => sendVia(socket, SEARCH, PORT, GROUP, n.address), { discard: true })
      yield* search
      yield* Effect.sleep("300 millis")
      yield* search
      yield* Effect.never
    })
  )
