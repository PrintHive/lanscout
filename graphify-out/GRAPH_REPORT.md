# Graph Report - 2026-10-27-poteto-mode-create-a-highly-58e726ba  (2026-10-27)

## Corpus Check
- 28 files · ~12,011 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: (none) 4)

## Summary
- 281 nodes · 644 edges · 12 communities
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 25 edges (avg confidence: 0.89)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8e49f0fb`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- domain.ts
- package.json
- network.ts
- printer.ts
- ssdp.ts
- discover.ts
- compilerOptions
- tailscale.ts
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
- `One record per device, across bands, subnets, and the tailnet` --references--> `Device`  [INFERRED]
  README.md → src/domain.ts
- `The `Device` record` --references--> `Device`  [INFERRED]
  README.md → src/domain.ts
- `lanscout` --references--> `arp()`  [INFERRED]
  README.md → src/sources/arp.ts
- `lanscout` --references--> `mdns()`  [INFERRED]
  README.md → src/sources/mdns.ts
- `lanscout` --references--> `printer()`  [INFERRED]
  README.md → src/sources/printer.ts

## Import Cycles
- None detected.

## Communities (12 total, 0 thin omitted)

### Community 0 - "domain.ts"
Cohesion: 0.10
Nodes (27): vitest, fold(), allSources, Device, Event, Ipv4, Mac, NetworkKind (+19 more)

### Community 1 - "package.json"
Cohesion: 0.05
Nodes (40): author, bin, lanscout, bugs, url, description, devDependencies, effect (+32 more)

### Community 2 - "network.ts"
Cohesion: 0.47
Nodes (9): intToIpv4(), ipv4ToInt(), broadcastOf(), CGNAT, hostsOf(), inCidr(), isTailnetIp(), mask() (+1 more)

### Community 3 - "printer.ts"
Cohesion: 0.11
Nodes (24): RFC-6298, Bambu, BAMBU_NT, bambuFromSsdpHeaders(), CertificateNames, field(), modelBySerialPrefix, modelOf() (+16 more)

### Community 4 - "ssdp.ts"
Cohesion: 0.10
Nodes (39): effect, parseIpv4(), parseMac(), arp(), lanHosts(), nudge(), parseArpTable(), parseProcNetArp() (+31 more)

### Community 5 - "discover.ts"
Cohesion: 0.10
Nodes (33): Column, Format, main(), parseArgs(), table(), View, views, Config (+25 more)

### Community 7 - "compilerOptions"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, exactOptionalPropertyTypes, lib, module, moduleResolution, noEmit (+9 more)

### Community 8 - "tailscale.ts"
Cohesion: 0.23
Nodes (12): ScanResult, SourceFailed, exec(), execFirst(), isPrivate(), lanEndpoint(), parseTailscaleStatus(), Peer (+4 more)

### Community 9 - "lanscout"
Cohesion: 0.15
Nodes (12): Develop lanscout, Find the 3D printers on your network, Install, lanscout, License, One record per device, across bands, subnets, and the tailnet, Run the CLI, The `Device` record (+4 more)

### Community 10 - "compilerOptions"
Cohesion: 0.18
Nodes (10): ./tsconfig.json, compilerOptions, declaration, declarationMap, noEmit, outDir, rootDir, sourceMap (+2 more)

### Community 11 - "sync-bambu-models.mjs"
Cohesion: 0.33
Nodes (3): firstValue(), profiles, rows

### Community 12 - "find-printers.ts"
Cohesion: 0.29
Nodes (6): args, describe(), printers, row(), subnets, Printer

## Knowledge Gaps
- **5 isolated node(s):** `@effect/vitest`, `@types/node`, `typescript`, `RFC-6298`, `./tsconfig.json`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 114 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `effect` connect `ssdp.ts` to `domain.ts`, `package.json`, `printer.ts`, `discover.ts`, `tailscale.ts`?**
  _High betweenness centrality (0.204) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `lanscout` (e.g. with `arp()` and `mdns()`) actually correct?**
  _`lanscout` has 6 INFERRED edges - model-reasoned connections that need verification._
- **What connects `@effect/vitest`, `@types/node`, `typescript` to the rest of the system?**
  _5 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `domain.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09986504723346828 - nodes in this community are weakly interconnected._
- **Why does `lanscout` connect `lanscout` to `tailscale.ts`, `printer.ts`, `ssdp.ts`, `discover.ts`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.04878048780487805 - nodes in this community are weakly interconnected._
- **Why does `vitest` connect `domain.ts` to `package.json`, `ssdp.ts`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._