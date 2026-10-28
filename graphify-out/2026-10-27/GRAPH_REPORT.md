# Graph Report - 2026-10-27-poteto-mode-create-a-highly-58e726ba  (2026-10-27)

## Corpus Check
- 29 files · ~14,036 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: (none) 4)

## Summary
- 297 nodes · 702 edges · 14 communities
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 31 edges (avg confidence: 0.89)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8d270457`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- domain.ts
- package.json
- network.ts
- printer.ts
- parsers.test.ts
- discover.ts
- ssdp.ts
- compilerOptions
- arp.ts
- cli.ts
- compilerOptions
- sync-bambu-models.mjs
- find-printers.ts
- Registry

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 16 edges
2. `lanscout` - 16 edges
3. `effect` - 15 edges
4. `Ipv4` - 15 edges
5. `parseIpv4()` - 15 edges
6. `SourceFailed` - 15 edges
7. `Observation` - 13 edges
8. `Device` - 12 edges
9. `Registry` - 12 edges
10. `Network` - 11 edges

## Surprising Connections (you probably didn't know these)
- `The `Device` record` --references--> `Device`  [INFERRED]
  README.md → src/domain.ts
- `Watch the network` --references--> `discover()`  [INFERRED]
  README.md → src/discover.ts
- `Watch the network` --references--> `SourceFailed`  [INFERRED]
  README.md → src/domain.ts
- `One record per device, across bands, subnets, and the tailnet` --references--> `Device`  [INFERRED]
  README.md → src/domain.ts
- `lanscout` --references--> `mdns()`  [INFERRED]
  README.md → src/sources/mdns.ts

## Import Cycles
- None detected.

## Communities (14 total, 0 thin omitted)

### Community 0 - "domain.ts"
Cohesion: 0.10
Nodes (34): One record per device, across bands, subnets, and the tailnet, vitest, Parsed, View, Config, defaultPorts, DiscoveryOptions, SourceOptions (+26 more)

### Community 1 - "package.json"
Cohesion: 0.05
Nodes (40): author, bin, lanscout, bugs, url, description, devDependencies, effect (+32 more)

### Community 2 - "network.ts"
Cohesion: 0.35
Nodes (10): intToIpv4(), ipv4ToInt(), broadcastOf(), CGNAT, hostsOf(), inCidr(), isTailnetIp(), mask() (+2 more)

### Community 3 - "printer.ts"
Cohesion: 0.16
Nodes (15): RFC-6298, CertificateNames, decodePrinterInfo, decodeSystemInfo, Klipper, klipperFromMoonraker(), MOONRAKER_PORT, PrinterInfo (+7 more)

### Community 4 - "parsers.test.ts"
Cohesion: 0.19
Nodes (18): decodeMessage(), DnsMessage, DnsQuestion, DnsRecord, encodeName(), encodeQuery(), readName(), RecordType (+10 more)

### Community 5 - "discover.ts"
Cohesion: 0.09
Nodes (33): Develop lanscout, Find the 3D printers on your network, Install, lanscout, License, Run the CLI, The `Device` record, Use the library (+25 more)

### Community 6 - "ssdp.ts"
Cohesion: 0.12
Nodes (23): Bambu, BAMBU_NT, bambuFromSsdpHeaders(), field(), modelBySerialPrefix, modelOf(), BambuModel, bambuModels (+15 more)

### Community 7 - "compilerOptions"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, exactOptionalPropertyTypes, lib, module, moduleResolution, noEmit (+9 more)

### Community 8 - "arp.ts"
Cohesion: 0.17
Nodes (19): RFC-6762, effect, parseIpv4(), parseMac(), SourceFailed, localNetworks(), parseCidr(), parseArpTable() (+11 more)

### Community 9 - "cli.ts"
Cohesion: 0.21
Nodes (12): Watch the network, byIp(), Column, Format, main(), parseArgs(), report(), runScan() (+4 more)

### Community 10 - "compilerOptions"
Cohesion: 0.18
Nodes (10): ./tsconfig.json, compilerOptions, declaration, declarationMap, noEmit, outDir, rootDir, sourceMap (+2 more)

### Community 11 - "sync-bambu-models.mjs"
Cohesion: 0.33
Nodes (3): firstValue(), profiles, rows

### Community 12 - "find-printers.ts"
Cohesion: 0.33
Nodes (5): args, describe(), printers, row(), subnets

### Community 13 - "Registry"
Cohesion: 0.35
Nodes (7): fold(), byIp(), emptyDraft(), fieldsOf(), Registry, snapshot(), run()

## Knowledge Gaps
- **6 isolated node(s):** `@effect/vitest`, `@types/node`, `typescript`, `RFC-6298`, `RFC-6762` (+1 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 117 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `effect` connect `arp.ts` to `domain.ts`, `package.json`, `printer.ts`, `parsers.test.ts`, `discover.ts`, `ssdp.ts`, `cli.ts`?**
  _High betweenness centrality (0.199) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `lanscout` (e.g. with `arp()` and `mdns()`) actually correct?**
  _`lanscout` has 6 INFERRED edges - model-reasoned connections that need verification._
- **What connects `@effect/vitest`, `@types/node`, `typescript` to the rest of the system?**
  _6 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `domain.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10409745293466224 - nodes in this community are weakly interconnected._
- **Why does `lanscout` connect `discover.ts` to `domain.ts`, `printer.ts`, `parsers.test.ts`, `ssdp.ts`, `cli.ts`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.04878048780487805 - nodes in this community are weakly interconnected._
- **Why does `vitest` connect `domain.ts` to `package.json`, `parsers.test.ts`, `ssdp.ts`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._