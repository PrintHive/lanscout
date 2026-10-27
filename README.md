# lanscout

Fast local network device discovery for Node.js, built on [Effect](https://effect.website) v4.

lanscout queries five sources at the same time and merges what they report into one record per physical device:

| Source | What it finds |
| --- | --- |
| `mdns` | Hostnames and DNS-SD services, including Thread border routers (`_meshcop._udp`) and Matter (`_matter._tcp`) |
| `ssdp` | UPnP devices: routers, TVs, media servers |
| `arp` | MAC addresses of every host the kernel has resolved, including hosts that answer nothing |
| `tcp` | Open ports from a concurrent connect sweep of each attached subnet |
| `tailscale` | Tailnet peers from `tailscale status`, with online state, OS, and subnet routes |

A default scan has a 2 second budget, and the process exits when the scan finishes.

## Install

```sh
npm install lanscout effect
```

Or run the CLI without installing it:

```sh
npx lanscout
```

`effect` is a peer dependency, so an application that already uses Effect shares one copy. Node.js 20 or later is required.

## CLI

```sh
lanscout                                # table of every device, 2 s budget
lanscout --json                         # JSON array
lanscout --ndjson                       # one JSON line per update, as devices appear
lanscout --only mdns,ssdp --timeout 1000
lanscout --subnet 192.168.50.0/24       # sweep a mesh or VLAN subnet this machine is not on
lanscout --interface en0                # restrict to one interface
lanscout --tailscale-routes             # also sweep LAN subnets advertised by tailnet peers
```

Run `lanscout --help` for every option.

## Library

### Promise API

```ts
import { discoverDevices } from "lanscout"

const { devices, failures, elapsedMs } = await discoverDevices({ timeoutMs: 1500 })
for (const d of devices) console.log(d.ips, d.macs, d.hostnames, d.services)
```

### Effect API

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

### Device

```ts
interface Device {
  id: string               // strongest identifier so far: ts:, mac:, usn:, host:, then ip:
  ips: Ipv4[]
  macs: Mac[]
  hostnames: string[]
  services: string[]       // DNS-SD types, e.g. "_ipp._tcp"
  openPorts: number[]
  networks: string[]       // local interfaces it was seen on, plus "tailnet"
  sources: Source[]
  server?: string          // SSDP SERVER header
  location?: string        // SSDP description URL
  tailscale?: { nodeId, dnsName, os, online, routes }
  firstSeenMs: number
  lastSeenMs: number
}
```

## Mesh, multi-band, and Tailscale networks

A device can appear with more than one address. A laptop on the 2.4 GHz and 5 GHz SSIDs of a mesh system can have two IPs and two MACs. A tailnet peer has a `100.x` address and also a LAN address. lanscout gives every observation a set of identifiers: IP, MAC, mDNS hostname, UPnP UUID, and Tailscale node ID. A union-find merges any observations that share an identifier. The result is one `Device` with all of its addresses and the `networks` it was seen on.

Multicast queries go out on every attached IPv4 interface, so each band or mesh subnet the host is on gets its own query. To reach a subnet the host is not attached to, pass `--subnet` (or the `subnets` option). Multicast does not cross routers, so on those subnets lanscout uses the TCP sweep and ARP.

A tailnet peer is linked to its LAN record when Tailscale reports a direct path with a private endpoint, or when its MagicDNS name matches the peer's mDNS hostname.

## Performance

A default scan of a /24 home network takes about 2.25 seconds of wall time, including Node.js startup. It found 49 devices on the network it was developed against.

- ARP decides which hosts are alive. lanscout reads the neighbour table, then sends a paced, empty UDP datagram to every LAN address so the kernel resolves it, and reads the table again every 250 ms. A blind TCP sweep of 254 addresses makes the kernel issue hundreds of ARP requests at once. On Wi-Fi those go out at the lowest basic rate, and in testing that delayed other traffic on the link by up to a second.
- TCP probes only hosts that another source has already seen, as soon as they appear. Probes run 1024 at a time with a 500 ms timeout, so a typical network finishes in one wave. Subnets passed with `--subnet` are off-link, so they are swept directly.
- lanscout imports Effect modules by subpath. The `effect` barrel takes about 630 ms to load, and the modules lanscout uses take about 120 ms.
- Subnets wider than 1024 hosts shrink to the aligned block around this machine.
- Every socket and child process is scoped. The scan releases them at its deadline or on interrupt.

## Development

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm start -- --json    # runs src/cli.ts directly on Node 22.18+
pnpm build
```

## License

MIT
