# Graph Report - 2026-10-27-poteto-mode-create-a-highly-58e726ba  (2026-10-27)

## Corpus Check
- 28 files · ~11,968 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: (none) 4)

## Summary
- 280 nodes · 643 edges · 13 communities
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 25 edges (avg confidence: 0.89)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8e49f0fb`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- registry.ts
- package.json
- network.ts
- printer.ts
- parsers.test.ts
- discover.ts
- ssdp.ts
- compilerOptions
- arp.ts
- lanscout
- compilerOptions
- sync-bambu-models.mjs
- find-printers.ts

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 16 edges
2. `Ipv4` - 15 edges
3. `parseIpv4()` - 15 edges
4. `lanscout` - 15 edges
5. `effect` - 14 edges
6. `Observation` - 13 edges
7. `SourceFailed` - 13 edges
8. `Device` - 12 edges
9. `Network` - 11 edges
10. `Registry` - 11 edges

## Surprising Connections (you probably didn't know these)
- `The `Device` record` --references--> `Device`  [INFERRED]
  README.md → src/domain.ts
- `One record per device, across bands, subnets, and the tailnet` --references--> `Device`  [INFERRED]
  README.md → src/domain.ts
- `lanscout` --references--> `arp()`  [INFERRED]
  README.md → src/sources/arp.ts
- `lanscout` --references--> `mdns()`  [INFERRED]
  README.md → src/sources/mdns.ts
- `lanscout` --references--> `printer()`  [INFERRED]
  README.md → src/sources/printer.ts

## Import Cycles
- None detected.

## Communities (13 total, 0 thin omitted)

### Community 0 - "registry.ts"
Cohesion: 0.13
Nodes (18): vitest, fold(), Observation, absorb(), byIp(), emptyDraft(), genericHosts, Handler (+10 more)

### Community 1 - "package.json"
Cohesion: 0.05
Nodes (40): author, bin, lanscout, bugs, url, description, devDependencies, effect (+32 more)

### Community 2 - "network.ts"
Cohesion: 0.18
Nodes (18): isProber(), liveIps(), observe(), intToIpv4(), ipv4ToInt(), broadcastOf(), CGNAT, hostsOf() (+10 more)

### Community 3 - "printer.ts"
Cohesion: 0.19
Nodes (13): decodePrinterInfo, decodeSystemInfo, Klipper, klipperFromMoonraker(), MOONRAKER_PORT, PrinterInfo, splitMachineType(), SystemInfo (+5 more)

### Community 4 - "parsers.test.ts"
Cohesion: 0.19
Nodes (18): decodeMessage(), DnsMessage, DnsQuestion, DnsRecord, encodeName(), encodeQuery(), readName(), RecordType (+10 more)

### Community 5 - "discover.ts"
Cohesion: 0.11
Nodes (36): One record per device, across bands, subnets, and the tailnet, Column, Format, main(), parseArgs(), table(), View, views (+28 more)

### Community 6 - "ssdp.ts"
Cohesion: 0.11
Nodes (24): Bambu, BAMBU_NT, bambuFromSsdpHeaders(), CertificateNames, field(), modelBySerialPrefix, modelOf(), BambuModel (+16 more)

### Community 7 - "compilerOptions"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, exactOptionalPropertyTypes, lib, module, moduleResolution, noEmit (+9 more)

### Community 8 - "arp.ts"
Cohesion: 0.20
Nodes (18): effect, parseIpv4(), parseMac(), SourceFailed, parseCidr(), parseArpTable(), parseProcNetArp(), readTable (+10 more)

### Community 9 - "lanscout"
Cohesion: 0.17
Nodes (11): Develop lanscout, Find the 3D printers on your network, Install, lanscout, License, Run the CLI, The `Device` record, Use the library (+3 more)

### Community 10 - "compilerOptions"
Cohesion: 0.18
Nodes (10): ./tsconfig.json, compilerOptions, declaration, declarationMap, noEmit, outDir, rootDir, sourceMap (+2 more)

### Community 11 - "sync-bambu-models.mjs"
Cohesion: 0.33
Nodes (3): firstValue(), profiles, rows

### Community 12 - "find-printers.ts"
Cohesion: 0.33
Nodes (5): args, describe(), printers, row(), subnets

## Knowledge Gaps
- **4 isolated node(s):** `@effect/vitest`, `@types/node`, `typescript`, `./tsconfig.json`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 113 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `effect` connect `arp.ts` to `package.json`, `network.ts`, `printer.ts`, `parsers.test.ts`, `discover.ts`, `ssdp.ts`?**
  _High betweenness centrality (0.204) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `lanscout` (e.g. with `arp()` and `mdns()`) actually correct?**
  _`lanscout` has 6 INFERRED edges - model-reasoned connections that need verification._
- **What connects `@effect/vitest`, `@types/node`, `typescript` to the rest of the system?**
  _4 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `registry.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12535612535612536 - nodes in this community are weakly interconnected._
- **Why does `lanscout` connect `lanscout` to `network.ts`, `printer.ts`, `parsers.test.ts`, `discover.ts`, `ssdp.ts`, `arp.ts`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.04878048780487805 - nodes in this community are weakly interconnected._
- **Why does `vitest` connect `registry.ts` to `package.json`, `parsers.test.ts`, `ssdp.ts`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._