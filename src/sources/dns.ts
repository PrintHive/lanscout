export const RecordType = { A: 1, PTR: 12, TXT: 16, AAAA: 28, SRV: 33, ANY: 255 } as const

export type DnsRecord =
  | { readonly type: "A"; readonly name: string; readonly address: string }
  | { readonly type: "PTR"; readonly name: string; readonly target: string }
  | { readonly type: "SRV"; readonly name: string; readonly target: string; readonly port: number }

export interface DnsQuestion {
  readonly name: string
  readonly type: number
}

const encodeName = (name: string, out: Array<number>): void => {
  for (const label of name.replace(/\.$/, "").split(".")) {
    const bytes = Buffer.from(label, "utf8")
    if (bytes.length > 63) throw new Error(`DNS label too long: ${label}`)
    out.push(bytes.length, ...bytes)
  }
  out.push(0)
}

export const encodeQuery = (questions: ReadonlyArray<DnsQuestion>): Buffer => {
  const out: Array<number> = [0, 0, 0, 0, questions.length >> 8, questions.length & 255, 0, 0, 0, 0, 0, 0]
  for (const q of questions) {
    encodeName(q.name, out)
    out.push(q.type >> 8, q.type & 255, 0, 1)
  }
  return Buffer.from(out)
}

/** Reads a possibly-compressed name. Returns the name and the offset just past it in the original stream. */
const readName = (buf: Buffer, start: number): [string, number] => {
  const labels: Array<string> = []
  let offset = start
  let end = -1
  for (let jumps = 0; jumps < 64; jumps++) {
    const len = buf[offset]
    if (len === undefined) throw new RangeError("name runs past packet")
    if (len === 0) return [labels.join("."), end === -1 ? offset + 1 : end]
    if ((len & 0xc0) === 0xc0) {
      if (end === -1) end = offset + 2
      offset = buf.readUInt16BE(offset) & 0x3fff
      continue
    }
    labels.push(buf.toString("utf8", offset + 1, offset + 1 + len))
    offset += 1 + len
  }
  throw new RangeError("compression loop")
}

export interface DnsMessage {
  readonly isResponse: boolean
  readonly questions: ReadonlyArray<DnsQuestion>
  readonly records: ReadonlyArray<DnsRecord>
}

/** Decodes answers, authority, and additional sections. Unknown record types are skipped. */
export const decodeMessage = (buf: Buffer): DnsMessage => {
  if (buf.length < 12) throw new RangeError("short DNS header")
  const isResponse = (buf[2]! & 0x80) !== 0
  const qd = buf.readUInt16BE(4)
  const rr = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10)
  let offset = 12
  const questions: Array<DnsQuestion> = []
  for (let i = 0; i < qd; i++) {
    const [name, next] = readName(buf, offset)
    questions.push({ name, type: buf.readUInt16BE(next) })
    offset = next + 4
  }
  const records: Array<DnsRecord> = []
  for (let i = 0; i < rr; i++) {
    const [name, next] = readName(buf, offset)
    const type = buf.readUInt16BE(next)
    const rdlength = buf.readUInt16BE(next + 8)
    const rdata = next + 10
    if (rdata + rdlength > buf.length) throw new RangeError("rdata runs past packet")
    switch (type) {
      case RecordType.A:
        if (rdlength === 4) records.push({ type: "A", name, address: `${buf[rdata]}.${buf[rdata + 1]}.${buf[rdata + 2]}.${buf[rdata + 3]}` })
        break
      case RecordType.PTR:
        records.push({ type: "PTR", name, target: readName(buf, rdata)[0] })
        break
      case RecordType.SRV:
        records.push({ type: "SRV", name, port: buf.readUInt16BE(rdata + 4), target: readName(buf, rdata + 6)[0] })
        break
    }
    offset = rdata + rdlength
  }
  return { isResponse, questions, records }
}
