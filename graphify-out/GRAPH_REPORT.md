# Graph Report - 2026-10-27-poteto-mode-create-a-highly-58e726ba  (2026-10-27)

## Corpus Check
- 29 files · ~14,657 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: (none) 4)

## Summary
- 301 nodes · 716 edges · 11 communities
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 33 edges (avg confidence: 0.89)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `10f6c3c6`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- registry.ts
- package.json
- lanscout
- printer.ts
- ssdp.ts
- discover.ts
- compilerOptions
- network.ts
- domain.ts
- compilerOptions
- sync-bambu-models.mjs

## God Nodes (most connected - your core abstractions)
1. `Ipv4` - 16 edges
2. `compilerOptions` - 16 edges
3. `lanscout` - 16 edges
4. `effect` - 15 edges
5. `parseIpv4()` - 15 edges
6. `SourceFailed` - 15 edges
7. `Observation` - 13 edges
8. `Registry` - 13 edges
9. `Device` - 12 edges
10. `Network` - 11 edges

## Surprising Connections (you probably didn't know these)
- `The `Device` record` --references--> `Device`  [INFERRED]
  README.md → src/domain.ts
- `With Effect` --references--> `tailscale()`  [INFERRED]
  README.md → src/sources/tailscale.ts
- `Watch the network` --references--> `SourceFailed`  [INFERRED]
  README.md → src/domain.ts
- `One record per device, across bands, subnets, and the tailnet` --references--> `Device`  [INFERRED]
  README.md → src/domain.ts
- `lanscout` --references--> `arp()`  [INFERRED]
  README.md → src/sources/arp.ts

## Import Cycles
- None detected.

## Communities (11 total, 0 thin omitted)

### Community 0 - "registry.ts"
Cohesion: 0.10
Nodes (23): vitest, Config, Subnet, fold(), Network, Observation, absorb(), byIp() (+15 more)

### Community 1 - "package.json"
Cohesion: 0.05
Nodes (40): author, bin, lanscout, bugs, url, description, devDependencies, effect (+32 more)

### Community 2 - "lanscout"
Cohesion: 0.17
Nodes (11): Develop lanscout, Find the 3D printers on your network, Install, lanscout, License, Run the CLI, The `Device` record, Use the library (+3 more)

### Community 3 - "printer.ts"
Cohesion: 0.09
Nodes (25): RFC-6298, Bambu, BAMBU_NT, bambuFromSsdpHeaders(), CertificateNames, field(), modelBySerialPrefix, modelOf() (+17 more)

### Community 4 - "ssdp.ts"
Cohesion: 0.09
Nodes (43): RFC-6762, effect, parseMac(), SourceFailed, arp(), lanHosts(), nudge(), parseArpTable() (+35 more)

### Community 5 - "discover.ts"
Cohesion: 0.18
Nodes (14): discoverers, isProber(), liveIps(), observe(), Prober, probers, TailnetPeers, tick (+6 more)

### Community 7 - "compilerOptions"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, exactOptionalPropertyTypes, lib, module, moduleResolution, noEmit (+9 more)

### Community 8 - "network.ts"
Cohesion: 0.20
Nodes (21): intToIpv4(), ipv4ToInt(), parseIpv4(), broadcastOf(), CGNAT, hostsOf(), inCidr(), isTailnetIp() (+13 more)

### Community 9 - "domain.ts"
Cohesion: 0.09
Nodes (42): args, describe(), printers, row(), subnets, One record per device, across bands, subnets, and the tailnet, Watch the network, byIp() (+34 more)

### Community 10 - "compilerOptions"
Cohesion: 0.18
Nodes (10): ./tsconfig.json, compilerOptions, declaration, declarationMap, noEmit, outDir, rootDir, sourceMap (+2 more)

### Community 11 - "sync-bambu-models.mjs"
Cohesion: 0.33
Nodes (3): firstValue(), profiles, rows

## Knowledge Gaps
- **6 isolated node(s):** `@effect/vitest`, `@types/node`, `typescript`, `RFC-6298`, `RFC-6762` (+1 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 118 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `effect` connect `ssdp.ts` to `package.json`, `printer.ts`, `discover.ts`, `network.ts`, `domain.ts`?**
  _High betweenness centrality (0.198) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `lanscout` (e.g. with `arp()` and `mdns()`) actually correct?**
  _`lanscout` has 6 INFERRED edges - model-reasoned connections that need verification._
- **What connects `@effect/vitest`, `@types/node`, `typescript` to the rest of the system?**
  _6 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `registry.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10338680926916222 - nodes in this community are weakly interconnected._
- **Why does `lanscout` connect `lanscout` to `printer.ts`, `ssdp.ts`, `discover.ts`, `network.ts`, `domain.ts`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.04878048780487805 - nodes in this community are weakly interconnected._
- **Why does `vitest` connect `registry.ts` to `package.json`, `printer.ts`, `ssdp.ts`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._