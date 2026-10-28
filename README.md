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

A default scan has a 2-second budget. The process exits when the scan finishes. To keep listening and report devices as they join and leave, run a watch instead.

## Install

```sh
npm install @printhive/lanscout effect
```

Or run the CLI without installing it:

```sh
npx @printhive/lanscout
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
lanscout --watch                        # report devices as they join (+) and leave (-) until Ctrl-C
lanscout --watch-for 30000 --json       # watch for 30 s, then print every device present
```

Run `lanscout --help` for every option.

## Use the library

### With promises

```ts
import { discoverDevices } from "@printhive/lanscout"

const { devices, failures, elapsedMs } = await discoverDevices({ timeoutMs: 1500 })
for (const d of devices) console.log(d.ips, d.macs, d.hostnames, d.services)
```

### With Effect

```ts
import { Effect, Stream } from "effect"
import { discover, watch } from "@printhive/lanscout"

// One result at the deadline
const result = Effect.runPromise(discover({ sources: ["mdns", "arp"] }))

// Events as devices join, change, and leave, until interrupted
const live = watch().pipe(
  Stream.runForEach((event) =>
    event._tag === "SourceFailed" ? Effect.logWarning(event.message) : Effect.log(event._tag, event.device.id)
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

## Watch the network

`watch()` keeps a scan running and returns a stream of events:

| Event | When |
| --- | --- |
| `DeviceAdded` | A device is seen for the first time, or again after it went gone |
| `DeviceUpdated` | A field of a device changes, such as a new service, port, or name. A sighting that changes nothing sends no event |
| `DeviceGone` | No source has seen the device for `staleAfterMs`, 180 seconds by default |
| `SourceFailed` | A source cannot run. The other sources keep running |

`watchForMs` ends the watch after that many milliseconds. Without it, the watch runs until you interrupt it. A watch with `watchForMs: 30000` finds all it can in 30 seconds.

A device's `id` can change during a watch. The id upgrades as stronger identifiers arrive, for example from `ip:` to `mac:`. Two records also merge when an identifier links them. Each `DeviceUpdated` lists in `formerIds` every id that now refers to its device. To track the devices that are present, delete the former ids before you store the device:

```ts
import { Effect, Stream } from "effect"
import type { Device } from "@printhive/lanscout"
import { watch } from "@printhive/lanscout"

const present = new Map<string, Device>()

const program = watch({ watchForMs: 30_000 }).pipe(
  Stream.runForEach((e) =>
    Effect.sync(() => {
      if (e._tag === "SourceFailed") return
      if (e._tag === "DeviceGone") return present.delete(e.device.id)
      if (e._tag === "DeviceUpdated") for (const id of e.formerIds) present.delete(id)
      present.set(e.device.id, e.device)
    })
  )
)
```

`lanscout --watch` uses the same procedure.

A watch repeats its queries in rounds. The first repeat comes 2 seconds after the start, and the interval doubles after each round:

- ARP nudges every LAN address, then reads the neighbor table every 250 ms for 2 seconds. Each read re-sights every device in the table.
- SSDP sends its searches again. It also listens on UDP port 1900 for the `NOTIFY` messages that UPnP devices send when they join.
- Tailscale reads `tailscale status` again.
- mDNS sends its queries again. RFC 6762 lets the interval double up to one hour, so after the first minutes mDNS mostly hears the announcements that devices send when they join.

The ARP, SSDP, and Tailscale intervals stop growing at a third of `staleAfterMs`, and at 60 seconds at most. A device that stays is therefore re-sighted at least twice before it can go stale. The TCP and printer probes run once for each new address, so a watch never repeats the full TCP sweep.

A device that leaves usually sends no goodbye, and the kernel's ARP table keeps listing it until the entry expires. On macOS that takes up to 20 minutes (`net.link.ether.inet.max_age` is 1200 seconds). So for a device with a known open port, lanscout does not count ARP as a sighting. When such a device has been quiet for the round interval, lanscout opens a TCP connection to that port. A connection or a refusal proves that the device is still there. A device that stops answering is reported gone `staleAfterMs` after its last answer. With `staleAfterMs: 30000`, that is about 30 seconds.

A device with no open port can only be re-sighted through ARP, mDNS, or SSDP. For such a device, `DeviceGone` can come up to 20 minutes late. An mDNS goodbye (TTL 0) and an SSDP `ssdp:byebye` do not count as sightings. A Tailscale peer that goes offline does not become gone. Its `tailscale.online` changes to `false`, and you get a `DeviceUpdated`.

`discover()` runs the same rounds, so a scan with a long `timeoutMs` also gets repeat queries.

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

- ARP decides which hosts are alive. lanscout reads the neighbor table, then sends a paced, empty UDP datagram to every LAN address so the kernel resolves it, and reads the table again every 250 ms for 2 seconds. A blind TCP sweep of 254 addresses makes the kernel issue hundreds of ARP requests at once. On Wi-Fi those go out at the lowest basic rate, and in testing that delayed other traffic on the link by up to a second.
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

CI runs these checks on Node 22, 24, and 26 for every pull request, and runs the built package on Node 20.

To release, set the new version and push its tag. The release workflow publishes to npm with provenance.

```sh
npm version patch      # or minor, major
git push --follow-tags
```

## License

MIT
