# Graph Report - 2026-10-27-poteto-mode-create-a-highly-58e726ba  (2026-10-28)

## Corpus Check
- 29 files · ~15,064 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: (none) 4)

## Summary
- 303 nodes · 718 edges · 12 communities
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 33 edges (avg confidence: 0.89)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `26d70eb7`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- registry.ts
- package.json
- lanscout
- printer.ts
- parsers.test.ts
- discover.ts
- ssdp.ts
- compilerOptions
- arp.ts
- domain.ts
- compilerOptions
- network.ts

## God Nodes (most connected - your core abstractions)
1. `lanscout` - 16 edges
2. `Ipv4` - 16 edges
3. `compilerOptions` - 16 edges
4. `effect` - 15 edges
5. `SourceFailed` - 15 edges
6. `parseIpv4()` - 15 edges
7. `Observation` - 13 edges
8. `Registry` - 13 edges
9. `Device` - 12 edges
10. `Network` - 11 edges

## Surprising Connections (you probably didn't know these)
- `With Effect` --references--> `tailscale()`  [INFERRED]
  README.md → src/sources/tailscale.ts
- `The `Device` record` --references--> `Device`  [INFERRED]
  README.md → src/domain.ts
- `One record per device, across bands, subnets, and the tailnet` --references--> `Device`  [INFERRED]
  README.md → src/domain.ts
- `lanscout` --references--> `arp()`  [INFERRED]
  README.md → src/sources/arp.ts
- `lanscout` --references--> `mdns()`  [INFERRED]
  README.md → src/sources/mdns.ts

## Import Cycles
- None detected.

## Communities (12 total, 0 thin omitted)

### Community 0 - "registry.ts"
Cohesion: 0.09
Nodes (24): vitest, Config, Subnet, fold(), Network, Observation, absorb(), byIp() (+16 more)

### Community 1 - "package.json"
Cohesion: 0.05
Nodes (42): author, bin, lanscout, bugs, url, description, devDependencies, effect (+34 more)

### Community 2 - "lanscout"
Cohesion: 0.14
Nodes (13): Develop lanscout, Find the 3D printers on your network, Install, lanscout, License, One record per device, across bands, subnets, and the tailnet, Run the CLI, The `Device` record (+5 more)

### Community 3 - "printer.ts"
Cohesion: 0.11
Nodes (23): RFC-6298, Bambu, BAMBU_NT, CertificateNames, field(), modelBySerialPrefix, modelOf(), BambuModel (+15 more)

### Community 4 - "parsers.test.ts"
Cohesion: 0.19
Nodes (18): decodeMessage(), DnsMessage, DnsQuestion, DnsRecord, encodeName(), encodeQuery(), readName(), RecordType (+10 more)

### Community 5 - "discover.ts"
Cohesion: 0.17
Nodes (17): discoverers, isProber(), liveIps(), observe(), Prober, probers, TailnetPeers, tick (+9 more)

### Community 6 - "ssdp.ts"
Cohesion: 0.23
Nodes (14): bambuFromSsdpHeaders(), nudge(), BAMBU_PORTS, NOTIFY_PORTS, parseSsdp(), search(), SEARCH_ALL, ssdp() (+6 more)

### Community 7 - "compilerOptions"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, exactOptionalPropertyTypes, lib, module, moduleResolution, noEmit (+9 more)

### Community 8 - "arp.ts"
Cohesion: 0.12
Nodes (25): RFC-6762, effect, firstValue(), profiles, rows, parseIpv4(), parseMac(), SourceFailed (+17 more)

### Community 9 - "domain.ts"
Cohesion: 0.10
Nodes (39): args, describe(), printers, row(), subnets, byIp(), Column, Format (+31 more)

### Community 10 - "compilerOptions"
Cohesion: 0.18
Nodes (10): ./tsconfig.json, compilerOptions, declaration, declarationMap, noEmit, outDir, rootDir, sourceMap (+2 more)

### Community 11 - "network.ts"
Cohesion: 0.40
Nodes (9): intToIpv4(), ipv4ToInt(), broadcastOf(), CGNAT, hostsOf(), inCidr(), isTailnetIp(), mask() (+1 more)

## Knowledge Gaps
- **6 isolated node(s):** `@effect/vitest`, `@types/node`, `typescript`, `./tsconfig.json`, `RFC-6298` (+1 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 119 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `effect` connect `arp.ts` to `package.json`, `printer.ts`, `parsers.test.ts`, `discover.ts`, `ssdp.ts`, `domain.ts`?**
  _High betweenness centrality (0.204) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `lanscout` (e.g. with `arp()` and `mdns()`) actually correct?**
  _`lanscout` has 6 INFERRED edges - model-reasoned connections that need verification._
- **What connects `@effect/vitest`, `@types/node`, `typescript` to the rest of the system?**
  _6 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `registry.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09246088193456614 - nodes in this community are weakly interconnected._
- **Why does `lanscout` connect `lanscout` to `printer.ts`, `parsers.test.ts`, `discover.ts`, `ssdp.ts`, `arp.ts`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.046511627906976744 - nodes in this community are weakly interconnected._
- **Why does `vitest` connect `registry.ts` to `package.json`, `parsers.test.ts`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._