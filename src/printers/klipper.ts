import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type { Printer } from "../domain.ts"

type Klipper = Extract<Printer, { kind: "klipper" }>

export const MOONRAKER_PORT = 7125

const PrinterInfo = Schema.Struct({
  result: Schema.Struct({
    state: Schema.String,
    hostname: Schema.optional(Schema.String),
    software_version: Schema.optional(Schema.String)
  })
})

const SystemInfo = Schema.Struct({
  result: Schema.Struct({
    system_info: Schema.Struct({
      product_info: Schema.optional(
        Schema.Struct({
          machine_type: Schema.optional(Schema.String),
          serial_number: Schema.optional(Schema.String),
          device_name: Schema.optional(Schema.String),
          firmware_version: Schema.optional(Schema.String)
        })
      )
    })
  })
})

const decodePrinterInfo = Schema.decodeUnknownOption(PrinterInfo)
const decodeSystemInfo = Schema.decodeUnknownOption(SystemInfo)

/** `machine_type` reads like `Snapmaker U1`: the first word is the manufacturer. */
const splitMachineType = (machineType: string) => {
  const [manufacturer, ...rest] = machineType.trim().split(/\s+/)
  return rest.length > 0 ? { manufacturer: manufacturer!, model: rest.join(" ") } : { model: machineType }
}

/**
 * Builds a Klipper printer from Moonraker's `/printer/info` and, when the firmware vendor
 * provides it, `/machine/system_info` product details. Returns `undefined` unless
 * `/printer/info` has the Moonraker shape.
 */
export const klipperFromMoonraker = (printerInfo: unknown, systemInfo: unknown): Klipper | undefined => {
  const info = decodePrinterInfo(printerInfo)
  if (Option.isNone(info)) return undefined
  const { hostname, software_version, state } = info.value.result
  const product = Option.getOrUndefined(decodeSystemInfo(systemInfo))?.result.system_info.product_info
  return {
    kind: "klipper",
    state,
    ...(hostname ? { hostname } : {}),
    ...(software_version ? { klipperVersion: software_version } : {}),
    ...(product?.machine_type ? splitMachineType(product.machine_type) : {}),
    ...(product?.serial_number ? { serial: product.serial_number } : {}),
    ...(product?.device_name ? { name: product.device_name } : {}),
    ...(product?.firmware_version ? { firmware: product.firmware_version } : {})
  }
}
