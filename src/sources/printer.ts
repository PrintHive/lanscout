import * as http from "node:http"
import * as tls from "node:tls"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import type { Config } from "../config.ts"
import type { Ipv4, Observation } from "../domain.ts"
import type { CertificateNames } from "../printers/bambu.ts"
import { printerFromCertificate } from "../printers/bambu.ts"
import { klipperFromMoonraker, MOONRAKER_PORT } from "../printers/klipper.ts"

const MQTT_TLS_PORT = 8883
/** Sleeping A1 and P1 printers took up to 1.6 s to finish a TLS handshake on a busy Wi-Fi network. */
const TLS_TIMEOUT_MS = 2000
const HTTP_TIMEOUT_MS = 1000

/**
 * Reads the peer certificate and closes. Verification is off on purpose: printers use
 * vendor-signed certificates, and the probe reads names without sending any data.
 */
const peerCertificate = (ip: Ipv4) =>
  Effect.callback<CertificateNames | undefined>((resume, signal) => {
    const socket = tls.connect({ host: ip, port: MQTT_TLS_PORT, rejectUnauthorized: false, timeout: TLS_TIMEOUT_MS })
    const done = (cert: CertificateNames | undefined) => {
      socket.destroy()
      resume(Effect.succeed(cert))
    }
    socket.once("secureConnect", () => done(socket.getPeerCertificate()))
    socket.once("timeout", () => done(undefined))
    socket.once("error", () => done(undefined))
    signal.addEventListener("abort", () => socket.destroy(), { once: true })
  })

const getJson = (ip: Ipv4, port: number, path: string) =>
  Effect.callback<unknown>((resume, signal) => {
    const req = http.get({ host: ip, port, path, agent: false, timeout: HTTP_TIMEOUT_MS, signal }, (res) => {
      const chunks: Array<Buffer> = []
      res.on("data", (c: Buffer) => chunks.push(c))
      res.on("end", () => {
        try {
          resume(Effect.succeed(JSON.parse(Buffer.concat(chunks).toString("utf8"))))
        } catch {
          resume(Effect.succeed(undefined))
        }
      })
      res.on("error", () => resume(Effect.succeed(undefined)))
    })
    req.once("timeout", () => req.destroy())
    req.once("error", () => resume(Effect.succeed(undefined)))
  })

const moonraker = (ip: Ipv4) =>
  Effect.flatMap(getJson(ip, MOONRAKER_PORT, "/printer/info"), (info) =>
    info === undefined
      ? Effect.succeed(undefined)
      : Effect.map(getJson(ip, MOONRAKER_PORT, "/machine/system_info"), (system) => klipperFromMoonraker(info, system)))

const identify = (ip: Ipv4): Effect.Effect<ReadonlyArray<Observation>> =>
  Effect.map(
    Effect.all([peerCertificate(ip), moonraker(ip)], { concurrency: 2 }),
    ([cert, klipper]) => {
      const fromCert = cert && printerFromCertificate(cert)
      return [fromCert, klipper].flatMap((printer) => (printer ? [{ _tag: "Printer" as const, ip, via: "printer" as const, printer }] : []))
    }
  )

/** Fingerprints each live host as a Bambu Lab printer (MQTT certificate) or a Klipper printer (Moonraker). */
export const printer = (cfg: Config, targets: Stream.Stream<Ipv4>): Stream.Stream<Observation> =>
  targets.pipe(
    Stream.mapEffect(identify, { concurrency: Math.min(cfg.concurrency, 128), unordered: true }),
    Stream.flatMap((observations) => Stream.fromIterable(observations))
  )
