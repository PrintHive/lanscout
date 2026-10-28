import { describe, expect, it } from "vitest"
import type { Device, Ipv4, Mac, Network, Observation } from "../src/domain.ts"
import { Registry } from "../src/registry.ts"

const ip = (s: string) => s as Ipv4
const mac = (s: string) => s as Mac

const networks: ReadonlyArray<Network> = [
  { iface: "en0", kind: "lan", address: ip("192.168.0.126"), prefix: 24 },
  { iface: "en1", kind: "lan", address: ip("192.168.50.3"), prefix: 24 },
  { iface: "utun4", kind: "tailnet", address: ip("100.64.0.2"), prefix: 32 }
]

const run = (observations: ReadonlyArray<Observation>) => {
  const registry = new Registry(networks)
  observations.forEach((o, i) => registry.add(o, 1000 + i))
  return registry.devices()
}

describe("Registry", () => {
  it("merges ARP, mDNS, and TCP observations of one IP into one device", () => {
    const [device, ...rest] = run([
      { _tag: "Arp", ip: ip("192.168.0.40"), mac: mac("02:00:00:00:00:40"), iface: "en0" },
      { _tag: "Mdns", ip: ip("192.168.0.40"), hostname: "brwf8.local.", services: ["_ipp._tcp"] },
      { _tag: "Tcp", ip: ip("192.168.0.40"), port: 631 }
    ])
    expect(rest).toEqual([])
    expect(device).toMatchObject({
      id: "mac:02:00:00:00:00:40",
      ips: ["192.168.0.40"],
      hostnames: ["brwf8.local"],
      services: ["_ipp._tcp"],
      openPorts: [631],
      networks: ["en0"],
      sources: ["arp", "mdns", "tcp"],
      firstSeenMs: 1000,
      lastSeenMs: 1002
    })
  })

  it("keeps unrelated IPs as separate devices, sorted numerically", () => {
    const devices = run([
      { _tag: "Tcp", ip: ip("192.168.0.100"), port: 80 },
      { _tag: "Tcp", ip: ip("192.168.0.9"), port: 80 }
    ])
    expect(devices.map((d) => d.ips)).toEqual([["192.168.0.9"], ["192.168.0.100"]])
  })

  it("collapses one device seen on two bands with two MACs and two IPs once its hostname links them", () => {
    const devices = run([
      { _tag: "Arp", ip: ip("192.168.0.53"), mac: mac("02:00:00:00:00:53"), iface: "en0" },
      { _tag: "Arp", ip: ip("192.168.50.53"), mac: mac("06:00:00:00:00:53"), iface: "en1" },
      { _tag: "Mdns", ip: ip("192.168.0.53"), hostname: "Alexs-iMac.local", services: [] },
      { _tag: "Mdns", ip: ip("192.168.50.53"), hostname: "alexs-imac.local", services: ["_airplay._tcp"] }
    ])
    expect(devices).toHaveLength(1)
    expect(devices[0]).toMatchObject({
      ips: ["192.168.0.53", "192.168.50.53"],
      macs: ["02:00:00:00:00:53", "06:00:00:00:00:53"],
      networks: ["en0", "en1"]
    })
  })

  it("links a tailnet peer to its LAN presence through the direct endpoint", () => {
    const devices = run([
      { _tag: "Arp", ip: ip("192.168.0.53"), mac: mac("02:00:00:00:00:53"), iface: "en0" },
      {
        _tag: "Tailscale",
        nodeId: "n1",
        hostname: "studio",
        dnsName: "studio.tail1.ts.net",
        os: "macOS",
        online: true,
        tailnetIps: [ip("100.64.0.10")],
        directIp: ip("192.168.0.53"),
        routes: []
      }
    ])
    expect(devices).toHaveLength(1)
    expect(devices[0]).toMatchObject({
      id: "ts:n1",
      ips: ["100.64.0.10", "192.168.0.53"],
      networks: ["en0", "tailnet"],
      sources: ["arp", "tailscale"],
      tailscale: { dnsName: "studio.tail1.ts.net", online: true }
    })
  })

  it("links SSDP responses from two IPs by their UPnP UUID", () => {
    const devices = run([
      { _tag: "Ssdp", ip: ip("192.168.0.1"), usn: "uuid:ABC-1::upnp:rootdevice" },
      { _tag: "Ssdp", ip: ip("192.168.50.1"), usn: "uuid:abc-1::urn:schemas-upnp-org:device:InternetGatewayDevice:1" }
    ])
    expect(devices.map((d) => d.ips)).toEqual([["192.168.0.1", "192.168.50.1"]])
  })
})

describe("Registry identity guards", () => {
  it("does not merge strangers that share a generic hostname", () => {
    const devices = run([
      { _tag: "Mdns", ip: ip("192.168.0.20"), hostname: "localhost.local", services: [] },
      { _tag: "Mdns", ip: ip("192.168.0.21"), hostname: "localhost.local", services: [] }
    ])
    expect(devices).toHaveLength(2)
  })
})

describe("Registry events", () => {
  const arp40: Observation = { _tag: "Arp", ip: ip("192.168.0.40"), mac: mac("02:00:00:00:00:40"), iface: "en0" }

  it("reports a first sighting as added and stays quiet on a re-sighting that changes nothing", () => {
    const registry = new Registry(networks)
    expect(registry.add(arp40, 1000)?._tag).toBe("DeviceAdded")
    expect(registry.add(arp40, 5000)).toBeUndefined()
    expect(registry.devices()[0]?.lastSeenMs).toBe(5000)
  })

  it("names the id a device had before an identifier upgraded it", () => {
    const registry = new Registry(networks)
    registry.add({ _tag: "Tcp", ip: ip("192.168.0.40"), port: 631 }, 1000)
    expect(registry.add(arp40, 1001)).toMatchObject({
      _tag: "DeviceUpdated",
      device: { id: "mac:02:00:00:00:00:40" },
      formerIds: ["ip:192.168.0.40"]
    })
  })

  it("reports a device gone once it is stale, drops it from devices, and adds it again when it returns", () => {
    const registry = new Registry(networks)
    registry.add(arp40, 1000)
    expect(registry.expire(2000, 5000)).toEqual([])
    expect(registry.expire(6000, 5000).map((e) => [e._tag, e.device.id])).toEqual([["DeviceGone", "mac:02:00:00:00:00:40"]])
    expect(registry.expire(7000, 5000)).toEqual([])
    expect(registry.devices()).toEqual([])
    expect(registry.add(arp40, 8000)?._tag).toBe("DeviceAdded")
    expect(registry.devices()).toHaveLength(1)
  })

  it("lets a caller track the devices present from events alone, through upgrades and merges", () => {
    const registry = new Registry(networks)
    const present = new Map<string, Device>()
    const observations: ReadonlyArray<Observation> = [
      { _tag: "Tcp", ip: ip("192.168.0.20"), port: 22 },
      { _tag: "Mdns", ip: ip("192.168.0.20"), hostname: "laptop.local", services: [] },
      { _tag: "Tcp", ip: ip("192.168.50.20"), port: 22 },
      { _tag: "Arp", ip: ip("192.168.50.20"), mac: mac("02:00:00:00:50:20"), iface: "en1" },
      { _tag: "Mdns", ip: ip("192.168.50.20"), hostname: "laptop.local", services: ["_ssh._tcp"] },
      { _tag: "Arp", ip: ip("192.168.0.20"), mac: mac("02:00:00:00:00:20"), iface: "en0" },
      arp40
    ]
    observations.forEach((o, i) => {
      const e = registry.add(o, 1000 + i)
      if (!e) return
      if (e._tag === "DeviceUpdated") for (const id of e.formerIds) present.delete(id)
      present.set(e.device.id, e.device)
    })
    expect([...present.values()].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [...registry.devices()].sort((a, b) => a.id.localeCompare(b.id))
    )
    expect(present.size).toBe(2)
  })
})

describe("Registry liveness", () => {
  const arp: Observation = { _tag: "Arp", ip: ip("192.168.0.30"), mac: mac("02:00:00:00:00:30"), iface: "en0" }
  const port: Observation = { _tag: "Tcp", ip: ip("192.168.0.30"), port: 62078 }

  it("lets a stale ARP entry keep a device with no open port present", () => {
    const registry = new Registry(networks)
    registry.add(arp, 0)
    registry.add(arp, 9000)
    expect(registry.expire(10_000, 5000)).toEqual([])
  })

  it("reports a device with an open port gone when only ARP still lists it", () => {
    const registry = new Registry(networks)
    registry.add(arp, 0)
    registry.add(port, 0)
    registry.add(arp, 9000)
    expect(registry.expire(10_000, 5000).map((e) => e._tag)).toEqual(["DeviceGone"])
  })

  it("keeps a device present, without an event, when it answers a liveness check", () => {
    const registry = new Registry(networks)
    registry.add(port, 0)
    expect(registry.add({ _tag: "Alive", ip: ip("192.168.0.30") }, 9000)).toBeUndefined()
    expect(registry.expire(10_000, 5000)).toEqual([])
  })

  it("asks for one check per quiet interval to a known open port", () => {
    const registry = new Registry(networks)
    registry.add(arp, 0)
    registry.add(port, 0)
    expect(registry.due(1000, 2000)).toEqual([])
    expect(registry.due(2000, 2000)).toEqual([{ ip: "192.168.0.30", port: 62078 }])
    expect(registry.due(3000, 2000)).toEqual([])
    expect(registry.due(4000, 2000)).toHaveLength(1)
    registry.add({ _tag: "Alive", ip: ip("192.168.0.30") }, 4500)
    expect(registry.due(6000, 2000)).toEqual([])
  })
})

describe("Registry address moves", () => {
  const printerAt = (address: string): Observation => ({
    _tag: "Printer",
    ip: ip(address),
    via: "ssdp",
    printer: { kind: "bambu", serial: "01S00A000000001", modelCode: "C11" }
  })
  const arpAt = (address: string): Observation => ({ _tag: "Arp", ip: ip(address), mac: mac("02:00:00:00:00:41"), iface: "en0" })
  const portAt = (address: string): Observation => ({ _tag: "Tcp", ip: ip(address), port: 8883 })

  it("reports the new address as current as soon as a printer is heard there", () => {
    const registry = new Registry(networks)
    registry.add(printerAt("192.168.0.41"), 1000)
    const update = registry.add(printerAt("192.168.0.42"), 2000)
    expect(update?._tag === "DeviceUpdated" && update.device.ip).toBe("192.168.0.42")
    expect(update?.device.ips).toEqual(["192.168.0.41", "192.168.0.42"])
  })

  it("keeps the new address current while the ARP cache still lists the old one", () => {
    const registry = new Registry(networks)
    registry.add(arpAt("192.168.0.41"), 1000)
    registry.add(printerAt("192.168.0.41"), 1000)
    registry.add(printerAt("192.168.0.42"), 2000)
    registry.add(arpAt("192.168.0.41"), 3000)
    expect(registry.devices().map((d) => d.ip)).toEqual(["192.168.0.42"])
  })

  it("drops the old address once it goes stale, with one DeviceUpdated, and keeps the device", () => {
    const registry = new Registry(networks)
    registry.add(portAt("192.168.0.41"), 0)
    registry.add(printerAt("192.168.0.41"), 0)
    registry.add(printerAt("192.168.0.42"), 4000)
    registry.add(arpAt("192.168.0.41"), 5500)
    const events = registry.expire(6000, 5000)
    expect(events.map((e) => [e._tag, e.device.ip, e.device.ips])).toEqual([["DeviceUpdated", "192.168.0.42", ["192.168.0.42"]]])
    expect(registry.expire(6500, 5000)).toEqual([])
  })

  it("sends liveness checks to the current address, not the first one seen", () => {
    const registry = new Registry(networks)
    registry.add(printerAt("192.168.0.41"), 0)
    registry.add(portAt("192.168.0.41"), 0)
    registry.add(printerAt("192.168.0.42"), 100)
    expect(registry.due(5000, 2000)).toEqual([{ ip: "192.168.0.42", port: 8883 }])
  })

  it("treats the old address as new once it is dropped, so the next printer there is its own device", () => {
    const registry = new Registry(networks)
    registry.add(printerAt("192.168.0.41"), 0)
    registry.add(portAt("192.168.0.41"), 0)
    registry.add(printerAt("192.168.0.42"), 4000)
    registry.expire(6000, 5000)
    const other: Observation = { _tag: "Printer", ip: ip("192.168.0.41"), via: "ssdp", printer: { kind: "bambu", serial: "01S00A000000002", modelCode: "C11" } }
    expect(registry.add(other, 6100)?._tag).toBe("DeviceAdded")
    expect(registry.devices().map((d) => [d.ip, d.printer?.serial])).toEqual([
      ["192.168.0.41", "01S00A000000002"],
      ["192.168.0.42", "01S00A000000001"]
    ])
    expect(registry.add(printerAt("192.168.0.42"), 6200)).toBeUndefined()
  })

  it("keeps one current address for a device heard at two, and prefers the LAN address over the tailnet", () => {
    const registry = new Registry(networks)
    const lan: Observation = { _tag: "Mdns", ip: ip("192.168.0.43"), hostname: "studio.local", services: [] }
    const tailnet: Observation = { _tag: "Mdns", ip: ip("100.64.0.43"), hostname: "studio.local", services: [] }
    registry.add(lan, 0)
    registry.add(tailnet, 1000)
    expect(registry.add(lan, 2000)).toBeUndefined()
    expect(registry.add(tailnet, 3000)).toBeUndefined()
    expect(registry.devices().map((d) => d.ip)).toEqual(["192.168.0.43"])
  })
})
