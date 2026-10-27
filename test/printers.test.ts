import { describe, expect, it } from "vitest"
import type { Ipv4, Mac, Network } from "../src/domain.ts"
import { printerFromCertificate } from "../src/printers/bambu.ts"
import { klipperFromMoonraker } from "../src/printers/klipper.ts"
import { Registry } from "../src/registry.ts"
import { parseSsdp } from "../src/sources/ssdp.ts"

const ip = (s: string) => s as Ipv4

const notify = (fields: Record<string, string>) =>
  ["NOTIFY * HTTP/1.1", "HOST: 239.255.255.250:1990", "Server: UPnP/1.0", ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`), "", ""].join("\r\n")

const p1s = {
  Location: "192.168.0.120",
  NT: "urn:bambulab-com:device:3dprinter:1",
  USN: "01P00A000000001",
  "DevModel.bambu.com": "C12",
  "DevName.bambu.com": "🦊Bramble",
  "DevSignal.bambu.com": "-76",
  "DevConnect.bambu.com": "lan",
  "DevBind.bambu.com": "free",
  "Devseclink.bambu.com": "secure",
  "DevVersion.bambu.com": "01.09.01.00"
}

describe("Bambu Lab SSDP", () => {
  it("turns a NOTIFY into a printer with model, name, firmware, mode, binding, and signal", () => {
    expect(parseSsdp(notify(p1s), ip("192.168.0.120"))).toEqual({
      _tag: "Printer",
      ip: "192.168.0.120",
      via: "ssdp",
      printer: {
        kind: "bambu",
        model: "P1S",
        modelCode: "C12",
        serial: "01P00A000000001",
        name: "🦊Bramble",
        firmware: "01.09.01.00",
        mode: "lan",
        bound: false,
        signalDbm: -76
      }
    })
  })

  it("reads an M-SEARCH reply, which carries ST instead of NT, and reports cloud binding", () => {
    const reply = ["HTTP/1.1 200 OK", "ST: urn:bambulab-com:device:3dprinter:1", "USN: 0940000000000AB", "DevModel.bambu.com: O1D", "DevConnect.bambu.com: cloud", "DevBind.bambu.com: occupied", "", ""].join("\r\n")
    expect(parseSsdp(reply, ip("192.168.0.108"))).toMatchObject({
      _tag: "Printer",
      printer: { kind: "bambu", model: "H2D", mode: "cloud", bound: true }
    })
  })

  it("keeps an unknown model code instead of guessing a name", () => {
    const o = parseSsdp(notify({ ...p1s, USN: "ZZZ000000000001", "DevModel.bambu.com": "Q99" }), ip("192.168.0.9"))
    expect(o?._tag === "Printer" && o.printer).toMatchObject({ modelCode: "Q99" })
    expect(o?._tag === "Printer" && "model" in o.printer).toBe(false)
  })

  it("leaves ordinary UPnP responses as plain SSDP observations", () => {
    expect(parseSsdp("HTTP/1.1 200 OK\r\nUSN: uuid:abc::upnp:rootdevice\r\n\r\n", ip("192.168.0.1"))?._tag).toBe("Ssdp")
  })
})

describe("MQTT certificate fingerprint", () => {
  it("identifies a Bambu printer and its model from the serial in the subject CN", () => {
    expect(printerFromCertificate({
      subject: { CN: "03900A000000002" },
      issuer: { C: "CN", O: "BBL Technologies Co., Ltd", CN: "BBL CA" }
    })).toEqual({ kind: "bambu", serial: "03900A000000002", model: "A1" })
  })

  it("identifies Snapmaker's broker as a Klipper machine by manufacturer", () => {
    expect(printerFromCertificate({ subject: { CN: "mqtt-broker" }, issuer: { CN: "mqtt-broker", O: "snapmaker.com" } }))
      .toEqual({ kind: "klipper", manufacturer: "Snapmaker" })
  })

  it("ignores other TLS services on 8883", () => {
    expect(printerFromCertificate({ subject: { CN: "broker.local" }, issuer: { O: "Let's Encrypt", CN: "R11" } })).toBeUndefined()
  })
})

describe("Moonraker", () => {
  const printerInfo = { result: { state: "ready", state_message: "Printer is ready", hostname: "kiln", software_version: "1.4.1.6_20260608141446" } }

  it("reads Klipper state, hostname, and version from /printer/info", () => {
    expect(klipperFromMoonraker(printerInfo, undefined)).toEqual({
      kind: "klipper",
      state: "ready",
      hostname: "kiln",
      klipperVersion: "1.4.1.6_20260608141446"
    })
  })

  it("adds manufacturer, model, serial, and name from vendor product info", () => {
    const system = { result: { system_info: { product_info: { machine_type: "Snapmaker U1", serial_number: "SN-TEST-0001", device_name: "Juniper", firmware_version: "1.4.1" } } } }
    expect(klipperFromMoonraker(printerInfo, system)).toMatchObject({
      manufacturer: "Snapmaker",
      model: "U1",
      serial: "SN-TEST-0001",
      name: "Juniper",
      firmware: "1.4.1"
    })
  })

  it("rejects an HTTP server on 7125 that is not Moonraker", () => {
    expect(klipperFromMoonraker({ ok: true }, undefined)).toBeUndefined()
  })
})

describe("printer identity", () => {
  const networks: ReadonlyArray<Network> = [{ iface: "en0", kind: "lan", address: ip("192.168.0.126"), prefix: 24 }]

  it("merges the SSDP announcement and the certificate of one Bambu printer by serial", () => {
    const registry = new Registry(networks)
    registry.add({ _tag: "Printer", ip: ip("192.168.0.120"), via: "printer", printer: { kind: "bambu", serial: "01P00A000000001", model: "P1S" } }, 1)
    registry.add({ _tag: "Arp", ip: ip("192.168.0.120"), mac: "02:00:00:00:01:20" as Mac, iface: "en0" }, 2)
    const ssdp = parseSsdp(notify(p1s), ip("192.168.0.120"))!
    registry.add(ssdp, 3)
    const [device, ...rest] = registry.devices()
    expect(rest).toEqual([])
    expect(device).toMatchObject({
      id: "sn:01P00A000000001",
      sources: ["arp", "printer", "ssdp"],
      printer: { kind: "bambu", model: "P1S", name: "🦊Bramble", mode: "lan", signalDbm: -76 }
    })
  })
})
