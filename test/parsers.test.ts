import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import type { Ipv4 } from "../src/domain.ts"
import { parseMac } from "../src/domain.ts"
import { hostsOf, localNetworks, networkOf } from "../src/network.ts"
import { parseArpTable, parseProcNetArp, parseWindowsArp } from "../src/sources/arp.ts"
import { decodeMessage, encodeQuery, RecordType } from "../src/sources/dns.ts"
import { advertisedServiceTypes, observationsFromMessage } from "../src/sources/mdns.ts"
import { parseSsdp } from "../src/sources/ssdp.ts"
import { parseTailscaleStatus } from "../src/sources/tailscale.ts"

const ip = (s: string) => s as Ipv4

const name = (n: string) => Buffer.concat([...n.split(".").map((l) => Buffer.from([l.length, ...Buffer.from(l)])), Buffer.from([0])])
const u16 = (n: number) => Buffer.from([n >> 8, n & 255])
const rr = (owner: Buffer, type: number, rdata: Buffer, ttl = 120) =>
  Buffer.concat([owner, u16(type), u16(0x8001), Buffer.from([0, 0, 0, ttl]), u16(rdata.length), rdata])

/** A printer's response: PTR -> instance, SRV -> host, A for the host. Names after the first are compression pointers. */
const printerResponse = (ttl = 120): Buffer => {
  const header = Buffer.from([0, 0, 0x84, 0, 0, 0, 0, 1, 0, 0, 0, 2])
  const ptrOwner = name("_ipp._tcp.local")
  const ptrOffset = 12
  const instance = Buffer.concat([Buffer.from([7, ...Buffer.from("Brother")]), Buffer.from([0xc0, ptrOffset])])
  const ptr = rr(ptrOwner, RecordType.PTR, instance, ttl)
  const instanceOffset = 12 + ptrOwner.length + 10
  const host = Buffer.concat([Buffer.from([5, ...Buffer.from("brwf8")]), Buffer.from([0xc0, ptrOffset + 10])])
  const srv = rr(Buffer.from([0xc0, instanceOffset]), RecordType.SRV, Buffer.concat([u16(0), u16(0), u16(631), host]), ttl)
  const hostOffset = 12 + ptr.length + 2 + 10 + 6
  const a = rr(Buffer.from([0xc0, hostOffset]), RecordType.A, Buffer.from([192, 168, 0, 40]), ttl)
  return Buffer.concat([header, ptr, srv, a])
}

describe("dns", () => {
  it("round-trips an encoded query", () => {
    const msg = decodeMessage(encodeQuery([{ name: "_services._dns-sd._udp.local", type: RecordType.PTR }, { name: "_hap._tcp.local", type: RecordType.PTR }]))
    expect(msg.isResponse).toBe(false)
    expect(msg.questions).toEqual([{ name: "_services._dns-sd._udp", type: 12 }, { name: "_hap._tcp", type: 12 }].map((q) => ({ ...q, name: `${q.name}.local` })))
  })

  it("decodes compressed PTR, SRV, and A records", () => {
    expect(decodeMessage(printerResponse()).records).toEqual([
      { type: "PTR", name: "_ipp._tcp.local", ttl: 120, target: "Brother._ipp._tcp.local" },
      { type: "SRV", name: "Brother._ipp._tcp.local", ttl: 120, target: "brwf8.local", port: 631 },
      { type: "A", name: "brwf8.local", ttl: 120, address: "192.168.0.40" }
    ])
  })

  it("rejects a compression loop instead of spinning", () => {
    const loop = Buffer.concat([Buffer.from([0, 0, 0x84, 0, 0, 0, 0, 1, 0, 0, 0, 0]), Buffer.from([0xc0, 12])])
    expect(() => decodeMessage(loop)).toThrow(RangeError)
  })
})

describe("mdns", () => {
  it("attributes services to the host the SRV points at, not the sender", () => {
    expect(observationsFromMessage(decodeMessage(printerResponse()), ip("192.168.0.99"))).toEqual([
      { _tag: "Mdns", ip: "192.168.0.40", hostname: "brwf8.local", services: ["_ipp._tcp"] }
    ])
  })

  it("does not count a goodbye (TTL 0) as a sighting", () => {
    expect(observationsFromMessage(decodeMessage(printerResponse(0)), ip("192.168.0.40"))).toEqual([])
  })

  it("lists service types from the DNS-SD meta query for a follow-up round", () => {
    const header = Buffer.from([0, 0, 0x84, 0, 0, 0, 0, 1, 0, 0, 0, 0])
    const msg = decodeMessage(Buffer.concat([header, rr(name("_services._dns-sd._udp.local"), RecordType.PTR, name("_meshcop._udp.local"))]))
    expect(advertisedServiceTypes(msg)).toEqual(["_meshcop._udp.local"])
    expect(observationsFromMessage(msg, ip("192.168.0.64"))).toEqual([])
  })
})

describe("ssdp", () => {
  it("does not count an ssdp:byebye NOTIFY as a sighting", () => {
    const byebye = "NOTIFY * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nNTS: ssdp:byebye\r\nUSN: uuid:abc-123::upnp:rootdevice\r\n\r\n"
    expect(parseSsdp(byebye, ip("192.168.0.1"))).toBeUndefined()
  })

  it("parses headers case-insensitively", () => {
    const text = "HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=1800\r\nLocation: http://192.168.0.1:1900/rootDesc.xml\r\nserver: Linux UPnP/1.0\r\nUSN: uuid:abc-123::upnp:rootdevice\r\n\r\n"
    expect(parseSsdp(text, ip("192.168.0.1"))).toEqual({
      _tag: "Ssdp",
      ip: "192.168.0.1",
      usn: "uuid:abc-123::upnp:rootdevice",
      server: "Linux UPnP/1.0",
      location: "http://192.168.0.1:1900/rootDesc.xml"
    })
  })

  it("ignores M-SEARCH requests echoed back from other searchers", () => {
    expect(parseSsdp("M-SEARCH * HTTP/1.1\r\nST: ssdp:all\r\n\r\n", ip("192.168.0.9"))).toBeUndefined()
  })
})

describe("arp", () => {
  it("parses macOS arp -an, zero-padding octets and skipping incomplete and broadcast entries", () => {
    const text = [
      "? (169.254.169.254) at (incomplete) on en0 [ethernet]",
      "? (192.168.0.1) at 02:00:00:00:0:1 on en0 ifscope [ethernet]",
      "? (192.168.0.255) at ff:ff:ff:ff:ff:ff on en0 ifscope [ethernet]",
      "? (224.0.0.251) at 1:0:5e:0:0:fb on en0 ifscope permanent [ethernet]"
    ].join("\n")
    expect(parseArpTable(text)).toEqual([{ _tag: "Arp", ip: "192.168.0.1", mac: "02:00:00:00:00:01", iface: "en0" }])
  })

  it("parses Linux arp -an", () => {
    expect(parseArpTable("? (10.0.0.7) at 3c:22:fb:01:02:03 [ether] on wlan0\n? (10.0.0.9) at <incomplete> on wlan0")).toEqual([
      { _tag: "Arp", ip: "10.0.0.7", mac: "3c:22:fb:01:02:03", iface: "wlan0" }
    ])
  })

  it("parses /proc/net/arp and drops flag 0x0", () => {
    const text = [
      "IP address       HW type     Flags       HW address            Mask     Device",
      "10.0.0.1         0x1         0x2         aa:bb:cc:dd:ee:01     *        eth0",
      "10.0.0.2         0x1         0x0         00:00:00:00:00:00     *        eth0"
    ].join("\n")
    expect(parseProcNetArp(text)).toEqual([{ _tag: "Arp", ip: "10.0.0.1", mac: "aa:bb:cc:dd:ee:01", iface: "eth0" }])
  })

  it("parses Windows arp -a per interface and drops broadcast and multicast entries", () => {
    const text = [
      "",
      "Interface: 192.0.2.10 --- 0x5",
      "  Internet Address      Physical Address      Type",
      "  192.0.2.1             02-00-00-00-00-01     dynamic",
      "  192.0.2.255           ff-ff-ff-ff-ff-ff     static",
      "  224.0.0.22            01-00-5e-00-00-16     static",
      "",
      "Interface: 198.51.100.4 --- 0x9",
      "  Internet Address      Physical Address      Type",
      "  198.51.100.7          02-00-00-00-00-02     dynamic"
    ].join("\r\n")
    expect(parseWindowsArp(text)).toEqual([
      { _tag: "Arp", ip: "192.0.2.1", mac: "02:00:00:00:00:01", iface: "192.0.2.10" },
      { _tag: "Arp", ip: "198.51.100.7", mac: "02:00:00:00:00:02", iface: "198.51.100.4" }
    ])
  })

  it("rejects malformed MACs", () => {
    expect(parseMac("zz:00:00:00:00:00")).toBeUndefined()
    expect(parseMac("00:11:22:33:44")).toBeUndefined()
  })
})

describe("network", () => {
  it("enumerates a /24 without network, broadcast, or self", () => {
    const hosts = hostsOf(ip("192.168.0.126"), 24, 1024, ip("192.168.0.126"), ip("192.168.0.126"))
    expect(hosts.length).toBe(253)
    expect(hosts[0]).toBe("192.168.0.1")
    expect(hosts.at(-1)).toBe("192.168.0.254")
    expect(hosts).not.toContain("192.168.0.126")
  })

  it("shrinks a wide subnet to the aligned block around this machine", () => {
    const hosts = hostsOf(ip("10.1.0.0"), 16, 1024, ip("10.1.37.5"))
    expect(hosts.length).toBe(1022)
    expect(hosts[0]).toBe("10.1.36.1")
    expect(hosts.at(-1)).toBe("10.1.39.254")
  })

  it("separates bands or mesh SSIDs on distinct subnets and classifies the tailnet", () => {
    const networks = localNetworks({
      en0: [{ address: "192.168.0.126", netmask: "255.255.255.0", family: "IPv4", mac: "", internal: false, cidr: "192.168.0.126/24" }],
      en1: [{ address: "192.168.50.3", netmask: "255.255.255.0", family: "IPv4", mac: "", internal: false, cidr: "192.168.50.3/24" }],
      utun4: [{ address: "100.64.0.2", netmask: "255.255.255.255", family: "IPv4", mac: "", internal: false, cidr: "100.64.0.2/32" }],
      lo0: [{ address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", mac: "", internal: true, cidr: "127.0.0.1/8" }]
    })
    expect(networks.map((n) => [n.iface, n.kind])).toEqual([["en0", "lan"], ["en1", "lan"], ["utun4", "tailnet"]])
    expect(networkOf(ip("192.168.50.20"), networks)?.iface).toBe("en1")
    expect(networkOf(ip("100.64.0.10"), networks)?.kind).toBe("tailnet")
    expect(networkOf(ip("8.8.8.8"), networks)).toBeUndefined()
  })
})

describe("tailscale", () => {
  const status = (peer: Record<string, unknown>, backend = "Running") =>
    JSON.stringify({ BackendState: backend, Peer: { k: { ID: "n1", HostName: "Alex’s Mac Studio", DNSName: "alexs-mac-studio.tail1.ts.net.", OS: "macOS", Online: true, TailscaleIPs: ["100.64.0.10", "fd7a::1"], ...peer } } })

  it("keys the peer by its DNS label and keeps only IPv4 tailnet addresses", async () => {
    const [o] = await Effect.runPromise(parseTailscaleStatus(status({ CurAddr: "203.0.113.10:41641" })))
    expect(o).toEqual({
      _tag: "Tailscale",
      nodeId: "n1",
      hostname: "alexs-mac-studio",
      dnsName: "alexs-mac-studio.tail1.ts.net",
      os: "macOS",
      online: true,
      tailnetIps: ["100.64.0.10"],
      routes: []
    })
  })

  it("records a private CurAddr as the peer's LAN address", async () => {
    const [o] = await Effect.runPromise(parseTailscaleStatus(status({ CurAddr: "192.168.0.53:41641", PrimaryRoutes: ["192.168.50.0/24"] })))
    expect(o).toMatchObject({ directIp: "192.168.0.53", routes: ["192.168.50.0/24"] })
  })

  it("fails when the backend is not running", async () => {
    const exit = await Effect.runPromiseExit(parseTailscaleStatus(status({}, "Stopped")))
    expect(Exit.isFailure(exit)).toBe(true)
  })
})
