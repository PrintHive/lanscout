import type { Printer } from "../domain.ts"
import { bambuModels } from "./bambu-models.ts"

type Bambu = Extract<Printer, { kind: "bambu" }>

export const BAMBU_NT = "urn:bambulab-com:device:3dprinter:1"

const modelBySerialPrefix: ReadonlyMap<string, string> = new Map(
  Object.values(bambuModels).flatMap((m) => (m.snPrefix ? [[m.snPrefix, m.name] as const] : []))
)

/** The model code wins; the first three characters of the serial are the fallback. */
const modelOf = (code: string | undefined, serial: string | undefined): string | undefined =>
  (code && bambuModels[code]?.name) || (serial && modelBySerialPrefix.get(serial.slice(0, 3).toUpperCase())) || undefined

/**
 * Bambu printers announce with SSDP-style NOTIFYs on UDP 1990 and 2021 and answer an
 * M-SEARCH with the same headers. `headers` keys must be lowercase.
 */
export const bambuFromSsdpHeaders = (headers: ReadonlyMap<string, string>): Bambu | undefined => {
  if (headers.get("nt") !== BAMBU_NT && headers.get("st") !== BAMBU_NT) return undefined
  const serial = headers.get("usn") || undefined
  const modelCode = headers.get("devmodel.bambu.com") || undefined
  const connect = headers.get("devconnect.bambu.com")
  const bind = headers.get("devbind.bambu.com")
  const signal = Number.parseInt(headers.get("devsignal.bambu.com") ?? "", 10)
  const model = modelOf(modelCode, serial)
  const name = headers.get("devname.bambu.com")?.trim()
  const firmware = headers.get("devversion.bambu.com")
  return {
    kind: "bambu",
    ...(model ? { model } : {}),
    ...(modelCode ? { modelCode } : {}),
    ...(serial ? { serial } : {}),
    ...(name ? { name } : {}),
    ...(firmware ? { firmware } : {}),
    ...(connect === "lan" || connect === "cloud" ? { mode: connect } : {}),
    ...(bind === "free" || bind === "occupied" ? { bound: bind === "occupied" } : {}),
    ...(Number.isFinite(signal) ? { signalDbm: signal } : {})
  }
}

export interface CertificateNames {
  readonly subject?: Readonly<Record<string, string | ReadonlyArray<string> | undefined>>
  readonly issuer?: Readonly<Record<string, string | ReadonlyArray<string> | undefined>>
}

const field = (names: CertificateNames["subject"], key: string): string | undefined => {
  const v = names?.[key]
  return typeof v === "string" ? v : v?.[0]
}

/**
 * The MQTT broker on port 8883 presents a certificate issued by `BBL CA` whose subject CN is
 * the printer serial. Snapmaker's Klipper machines run a broker with their own issuer.
 */
export const printerFromCertificate = (cert: CertificateNames): Printer | undefined => {
  const issuerOrg = field(cert.issuer, "O") ?? ""
  if (field(cert.issuer, "CN") === "BBL CA" || issuerOrg.startsWith("BBL Technologies")) {
    const serial = field(cert.subject, "CN")
    const model = modelOf(undefined, serial)
    return { kind: "bambu", ...(serial ? { serial } : {}), ...(model ? { model } : {}) }
  }
  if (issuerOrg.toLowerCase() === "snapmaker.com") return { kind: "klipper", manufacturer: "Snapmaker" }
  return undefined
}
