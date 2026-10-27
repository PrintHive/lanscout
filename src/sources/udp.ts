import * as dgram from "node:dgram"
import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import { SourceFailed } from "../domain.ts"

const bind = (source: string, port: number) =>
  Effect.callback<dgram.Socket, SourceFailed>((resume) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true })
    const onError = (err: Error) => {
      socket.close()
      resume(Effect.fail(new SourceFailed({ source, message: `bind ${port}: ${err.message}` })))
    }
    socket.once("error", onError)
    socket.bind(port, () => {
      socket.off("error", onError)
      resume(Effect.succeed(socket))
    })
  })

const release = (socket: dgram.Socket) => Effect.sync(() => socket.close())

/** Binds `port` for the life of the scope. */
export const bindUdp = (source: string, port: number): Effect.Effect<dgram.Socket, SourceFailed, Scope.Scope> =>
  Effect.acquireRelease(bind(source, port), release)

/** Binds `preferredPort`, falling back to an ephemeral port when another responder owns it. */
export const openUdp = (
  source: string,
  preferredPort: number
): Effect.Effect<dgram.Socket, SourceFailed, Scope.Scope> =>
  Effect.acquireRelease(bind(source, preferredPort).pipe(Effect.catch(() => bind(source, 0))), release)

/** Sends via one interface at a time; the multicast interface is socket state, so sends must not overlap. */
export const sendVia = (socket: dgram.Socket, payload: Buffer, port: number, address: string, iface?: string) =>
  Effect.callback<void>((resume) => {
    try {
      if (iface) socket.setMulticastInterface(iface)
      socket.send(payload, port, address, () => resume(Effect.void))
    } catch {
      resume(Effect.void)
    }
  })
