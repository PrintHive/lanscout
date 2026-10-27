import { execFile } from "node:child_process"
import * as Effect from "effect/Effect"
import { SourceFailed } from "../domain.ts"

/** Runs a binary and returns stdout. Interrupting the effect kills the child. */
export const exec = (source: string, file: string, args: ReadonlyArray<string>) =>
  Effect.callback<string, SourceFailed>((resume, signal) => {
    execFile(file, args, { signal, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) resume(Effect.fail(new SourceFailed({ source, message: `${file}: ${err.message}` })))
      else resume(Effect.succeed(stdout))
    })
  })

/** Tries each candidate binary in order and returns the first that succeeds. */
export const execFirst = (source: string, files: ReadonlyArray<string>, args: ReadonlyArray<string>) =>
  Effect.firstSuccessOf(files.map((file) => exec(source, file, args)))
