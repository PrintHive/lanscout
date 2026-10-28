import * as Effect from "effect/Effect"

/** mDNS continuous querying must keep doubling the interval up to an hour (RFC 6762 section 5.2). */
export const MDNS_MAX_INTERVAL_MS = 3_600_000

/**
 * Repeats a source's query round 2 s after the first, then at doubling intervals up to `maxMs`,
 * until the scan ends. A long scan finds devices that missed the first round; a watch keeps
 * re-sighting the devices that stay.
 */
export const repeatRounds = <E, R>(round: Effect.Effect<void, E, R>, maxMs: number): Effect.Effect<never, E, R> =>
  Effect.gen(function*() {
    for (let delay = Math.min(2000, maxMs);; delay = Math.min(delay * 2, maxMs)) {
      yield* Effect.sleep(delay)
      yield* round
    }
  })
