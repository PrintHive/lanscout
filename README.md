# lanscout

lanscout finds the devices on a local network in about 2 seconds. It runs on Node.js and is built on [Effect](https://effect.website) v4.

lanscout queries six sources at the same time and merges what they report into one record per physical device:

| Source | What it finds |
| --- | --- |
| `mdns` | Hostnames and DNS-SD services, including Thread border routers (`_meshcop._udp`) and Matter (`_matter._tcp`) |
| `ssdp` | UPnP devices such as routers, TVs, and media servers, and Bambu Lab printer announcements |
| `arp` | MAC addresses of every host the kernel has resolved, including hosts that answer nothing |
| `tcp` | Open ports from a concurrent connect sweep of each attached subnet |
| `tailscale` | Tailnet peers from `tailscale status`, with online state, OS, and subnet routes |
| `printer` | Bambu Lab printers from their MQTT certificate on port 8883, and Klipper printers from Moonraker on port 7125 |

A default scan has a 2-second budget. The process exits when the scan finishes.

## Install

```sh
npm install lanscout effect
```

Or run the CLI without installing it:

```sh
npx lanscout
```

`effect` is a peer dependency, so an application that already uses Effect shares one copy. Node.js 20 or later is required.

## Run the CLI

```sh
lanscout                                # table of every device, 2 s budget
lanscout --json                         # JSON array
lanscout --ndjson                       # one JSON line per update, as devices appear
lanscout --only mdns,ssdp --timeout 1000
lanscout --subnet 192.168.50.0/24       # sweep a mesh or VLAN subnet this machine is not on
lanscout --interface en0                # restrict to one interface
lanscout --tailscale-routes             # also sweep LAN subnets advertised by tailnet peers
lanscout --printers                     # only Bambu Lab and Klipper printers, 4 s budget
```

Run `lanscout --help` for every option.

## Use the library

### With promises

```ts
import { discoverDevices } from "lanscout"

const { devices, failures, elapsedMs } = await discoverDevices({ timeoutMs: 1500 })
for (const d of devices) console.log(d.ips, d.macs, d.hostnames, d.services)
```

### With Effect

```ts
import { Effect, Stream } from "effect"
import { discover, scan } from "lanscout"

// One result at the deadline
const result = Effect.runPromise(discover({ sources: ["mdns", "arp"] }))

// Live updates as devices are found
const live = scan().pipe(
  Stream.runForEach((event) =>
    event._tag === "DeviceUpdated" ? Effect.log(event.device.id) : Effect.logWarning(event.message)
  )
)
```

A source that cannot run, such as `tailscale` when it is not installed, appears in `failures`. The other sources keep running.

### The `Device` record

```ts
interface Device {
  id: string               // strongest identifier so far, in this order: ts:, sn:, mac:, usn:, host:, ip:
  ips: Ipv4[]
  macs: Mac[]
  hostnames: string[]
  services: string[]       // DNS-SD types such as "_ipp._tcp"
  openPorts: number[]
  networks: string[]       // local interfaces it was seen on, plus "tailnet"
  sources: Source[]
  server?: string          // SSDP SERVER header
  location?: string        // SSDP description URL
  tailscale?: { nodeId, dnsName, os, online, routes }
  printer?: Printer        // Bambu Lab or Klipper details; see "Find the 3D printers on your network"
  firstSeenMs: number
  lastSeenMs: number
}
```

## Find the 3D printers on your network

`lanscout --printers` lists every Bambu Lab and Klipper printer that lanscout finds:

```sh
lanscout --printers
lanscout --printers --json
lanscout --printers --subnet 10.0.20.0/24   # printers on another VLAN
```

`examples/find-printers.ts` does the same through the library API.

```
IP             PRINTER              NAME     SERIAL           FIRMWARE     STATUS
192.168.0.104  Snapmaker U1         Juniper  SN-TEST-0001     1.4.1        klippy ready, klipper 1.4.1.6
192.168.0.106  Bambu Lab A1         Bramble  03900A000000002  01.05.00.00  lan mode, unbound, -53 dBm
192.168.0.112  Bambu Lab X1 Carbon  Thistle  00M00A000000003  01.09.00.01  lan mode, unbound, -65 dBm
```

lanscout identifies a printer in three ways:

- Bambu Lab printers send an SSDP `NOTIFY` on UDP port 1990 or 2021. In testing, each A1 and P1S sent one about every 10 seconds. An X1 Carbon and an H2D also answered a broadcast `M-SEARCH` within 210 ms. The message has the model, name, serial, firmware, LAN or cloud mode, and Wi-Fi signal.
- Every Bambu Lab printer runs an MQTT broker on port 8883 with a certificate issued by `BBL CA`. The subject is the printer serial, and the first three characters of the serial give the model. The certificate check finds printers that have not announced yet.
- Klipper printers answer Moonraker's `/printer/info` on port 7125. lanscout also reads `/machine/system_info`, which some vendors fill with the manufacturer, model, serial, and name.

lanscout knows 15 Bambu Lab model codes, which cover 14 models. The H2C has two codes. `src/printers/bambu-models.ts` holds the table. `scripts/sync-bambu-models.mjs` generates it from the printer profiles in Bambu Studio. To add a model that Bambu releases, run `node scripts/sync-bambu-models.mjs`. A model missing from the table still appears, with its raw code in `modelCode`.

The SSDP and certificate reports for one printer merge into one device by serial. A printer that has not sent a `NOTIFY` before the deadline still appears, but without its name. The example uses a 4-second budget so that more announcements arrive.

Bambu Studio binds UDP port 2021. If Bambu Studio is running, lanscout listens on port 1990 only.

## One record per device, across bands, subnets, and the tailnet

A device can appear with more than one address. A laptop on the 2.4 GHz and 5 GHz SSIDs of a mesh system can have two IPs and two MACs. A tailnet peer has a `100.x` address and also a LAN address. lanscout gives every observation a set of identifiers: IP, MAC, mDNS hostname, UPnP UUID, printer serial, and Tailscale node ID. A union-find structure groups any observations that share an identifier, even through a chain of other observations. The result is one `Device` with all of its addresses and the `networks` it was seen on.

Multicast queries go out on every attached IPv4 interface, so each band or mesh subnet the host is on gets its own query. To reach a subnet the host is not attached to, pass `--subnet` on the CLI or `subnets` in the library. Multicast does not cross routers, so on those subnets lanscout uses only the TCP sweep and the printer probe.

A tailnet peer is linked to its LAN record when Tailscale reports a direct path with a private endpoint, or when its MagicDNS name matches the peer's mDNS hostname.

## Where the scan time goes

A default scan of a /24 home network takes about 2.25 seconds of wall time, including Node.js startup. It found 49 devices on the network it was developed against.

- ARP decides which hosts are alive. lanscout reads the neighbor table, then sends a paced, empty UDP datagram to every LAN address so the kernel resolves it, and reads the table again every 250 ms. A blind TCP sweep of 254 addresses makes the kernel issue hundreds of ARP requests at once. On Wi-Fi those go out at the lowest basic rate, and in testing that delayed other traffic on the link by up to a second.
- TCP probes only hosts that another source has already seen, as soon as they appear. Probes run 1024 at a time with a 500 ms timeout. On the test network, 51 live hosts and 16 default ports make 816 probes, so all of them start in the first wave. Subnets passed with `--subnet` are off-link, so they are swept directly.
- lanscout imports Effect modules by subpath. The `effect` barrel takes about 630 ms to load, and the modules lanscout uses take about 120 ms.
- Subnets wider than 1024 hosts shrink to the aligned block around this machine.
- Every socket and child process is scoped. The scan releases them at its deadline or on interrupt.

## Develop lanscout

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm start -- --json    # runs src/cli.ts directly on Node 22.18+
pnpm build
```

## License

MIT
