import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import type { Config } from "../config.ts"
import type { Ipv4, Observation } from "../domain.ts"
import { parseIpv4, SourceFailed } from "../domain.ts"
import { inCidr, parseCidr } from "../network.ts"
import { execFirst } from "./exec.ts"

const Peer = Schema.Struct({
  ID: Schema.String,
  HostName: Schema.String,
  DNSName: Schema.String,
  OS: Schema.String,
  Online: Schema.optional(Schema.Boolean),
  TailscaleIPs: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  PrimaryRoutes: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  CurAddr: Schema.optional(Schema.String)
})

const Status = Schema.fromJsonString(
  Schema.Struct({
    BackendState: Schema.String,
    Peer: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Peer)))
  })
)

const PRIVATE = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"].map((c) => parseCidr(c)!)

const isPrivate = (ip: Ipv4) => PRIVATE.some((c) => inCidr(ip, c.base, c.prefix))

/** `CurAddr` is the peer's current UDP endpoint; only a private one means it shares a LAN with us. */
const lanEndpoint = (curAddr: string | undefined): Ipv4 | undefined => {
  const ip = curAddr ? parseIpv4(curAddr.slice(0, curAddr.lastIndexOf(":"))) : undefined
  return ip && isPrivate(ip) ? ip : undefined
}

export const parseTailscaleStatus = (json: string): Effect.Effect<ReadonlyArray<Observation>, SourceFailed> =>
  Schema.decodeUnknownEffect(Status)(json).pipe(
    Effect.mapError((e) => new SourceFailed({ source: "tailscale", message: `unexpected status JSON: ${e.message}` })),
    Effect.flatMap((status) =>
      status.BackendState === "Running"
        ? Effect.succeed(
          Object.values(status.Peer ?? {}).map((p): Observation => {
            const directIp = lanEndpoint(p.CurAddr)
            return {
              _tag: "Tailscale",
              nodeId: p.ID,
              hostname: p.DNSName.split(".")[0] || p.HostName,
              dnsName: p.DNSName.replace(/\.$/, ""),
              os: p.OS,
              online: p.Online ?? false,
              tailnetIps: (p.TailscaleIPs ?? []).flatMap((ip) => parseIpv4(ip) ?? []),
              ...(directIp ? { directIp } : {}),
              routes: p.PrimaryRoutes ?? []
            }
          })
        )
        : Effect.fail(new SourceFailed({ source: "tailscale", message: `backend is ${status.BackendState}` }))
    )
  )

export const tailscaleStatus = (cfg: Config) =>
  execFirst("tailscale", cfg.tailscaleBinaries, ["status", "--json"]).pipe(Effect.flatMap(parseTailscaleStatus))

export const tailscale = (cfg: Config): Stream.Stream<Observation, SourceFailed> =>
  Stream.fromIterableEffect(tailscaleStatus(cfg))
