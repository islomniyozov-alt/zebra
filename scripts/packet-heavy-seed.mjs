#!/usr/bin/env node
// ---------------------------------------------------------------------------
// A HEAVY BROKER LOAD FOR THE PACKET PROBE, ON DEV (BROKER-LOAD-BRIEF R9;
// GAPS 44).
//
//   node --env-file=.env scripts/packet-heavy-seed.mjs --load 1177            preview
//   node --env-file=.env scripts/packet-heavy-seed.mjs --load 1177 --write    seed
//   node --env-file=.env scripts/packet-heavy-seed.mjs --load 1177 --remove   take off
//
// WHY IT EXISTS. On 2026-11-22 the heaviest broker load on dev carried one
// 2 KB rate con, so `packet-probe.mjs` measured a 2,400-byte packet and said
// nothing about the 20 MB cap it exists to test. This puts ~19 MB of packet
// paper on one dev load so the probe — which picks the heaviest broker load
// under the cap by itself — measures the case R9 is about.
//
// WHAT IT WRITES. Two POD photographs (letter-size JPEGs, ~3.9 MB each), and
// three PDFs written by Chromium with one distinct scanned page image per
// page: a 3-page POD, a 2-page BOL, a 3-page rate con — about 19 MB in all. Every page is random
// noise, so JPEG cannot shrink it and the bytes are the size a real scan is.
// Each file is uploaded to the dev bucket under the load's prefix and gets a
// Document row whose filename starts `SYNTHETIC-`, with its real SHA-256.
// `--remove` soft-deletes exactly those rows (the objects stay, as every
// document's do).
//
// Dev only: DIRECT_DATABASE_URL must be dev's branch (little-lake) and
// R2_BUCKET must be zebra-docs-dev. Preview by default.
// ---------------------------------------------------------------------------
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const CAP = 20 * 1024 * 1024
export const PREFIX = 'SYNTHETIC-'

/** `--load n` and at most one of `--write` / `--remove`; nothing else. */
export function parseArgs(argv) {
  const out = { load: null, mode: 'preview' }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (flag === '--load' && argv[i + 1]) out.load = argv[++i]
    else if (
      (flag === '--write' || flag === '--remove') &&
      out.mode === 'preview'
    )
      out.mode = flag.slice(2)
    else throw new Error(`packet-heavy-seed: unknown argument ${flag}`)
  }
  if (!out.load)
    throw new Error('packet-heavy-seed: --load <loadNumber> is required')
  return out
}

/** The plan: what each file is, in the order the packet reads them. */
export const FILES = [
  { type: 'POD', kind: 'photo', name: 'pod-photo-1.jpg' },
  { type: 'POD', kind: 'photo', name: 'pod-photo-2.jpg' },
  { type: 'POD', kind: 'pdf', pages: 3, name: 'pod.pdf' },
  { type: 'BOL', kind: 'pdf', pages: 2, name: 'bol.pdf' },
  { type: 'RATE_CONFIRMATION', kind: 'pdf', pages: 3, name: 'ratecon.pdf' },
]

async function generate() {
  const { default: sharp } = await import('sharp')
  const noise = (width, height, quality) =>
    sharp({
      create: {
        width,
        height,
        channels: 3,
        background: '#808080',
        noise: { type: 'gaussian', mean: 160, sigma: 40 },
      },
    })
      .jpeg({ quality })
      .toBuffer()
  const { chromium } = await import('playwright')
  const browser = await chromium.launch(
    process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
  )
  const page = await browser.newPage()
  const out = []
  for (const file of FILES) {
    let bytes
    if (file.kind === 'photo') {
      bytes = await noise(2550, 3300, 80)
    } else {
      const images = []
      for (let i = 0; i < file.pages; i++)
        images.push((await noise(1700, 2200, 75)).toString('base64'))
      await page.setContent(
        `<body style="margin:0">${images
          .map(
            (b64) =>
              `<img style="width:8.5in;height:10.9in;display:block" src="data:image/jpeg;base64,${b64}">`,
          )
          .join('')}</body>`,
      )
      bytes = await page.pdf({ format: 'Letter', printBackground: true })
    }
    out.push({
      ...file,
      filename: `${PREFIX}${file.name}`,
      mimeType: file.kind === 'photo' ? 'image/jpeg' : 'application/pdf',
      bytes: new Uint8Array(bytes),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
  }
  await browser.close()
  return out
}

async function main() {
  const { load: loadNumber, mode } = parseArgs(process.argv.slice(2))
  if (!/little-lake/.test(process.env.DIRECT_DATABASE_URL ?? ''))
    throw new Error(
      'DIRECT_DATABASE_URL is not the dev branch (little-lake) — refusing',
    )
  if (process.env.R2_BUCKET !== 'zebra-docs-dev')
    throw new Error('R2_BUCKET is not zebra-docs-dev — refusing')

  const { default: pg } = await import('pg')
  const pool = new pg.Pool({
    connectionString: process.env.DIRECT_DATABASE_URL,
    max: 1,
  })
  try {
    const { rows } = await pool.query(
      `select l.id, l."organizationId", l."companyId" from "Load" l
        where l."loadNumber" = $1 and l."deletedAt" is null`,
      [loadNumber],
    )
    if (rows.length !== 1)
      throw new Error(
        `load ${loadNumber}: ${rows.length} live loads on dev, need exactly 1`,
      )
    const load = rows[0]
    const { rows: live } = await pool.query(
      `select id, filename, "sizeBytes" from "Document"
        where "loadId" = $1 and "deletedAt" is null and filename like $2`,
      [load.id, `${PREFIX}%`],
    )

    if (mode === 'remove') {
      const { rowCount } = await pool.query(
        `update "Document" set "deletedAt" = now(), "updatedAt" = now()
          where "loadId" = $1 and "deletedAt" is null and filename like $2`,
        [load.id, `${PREFIX}%`],
      )
      console.log(
        `load ${loadNumber}: ${rowCount} synthetic document(s) soft-deleted`,
      )
      return
    }
    if (live.length > 0)
      throw new Error(
        `load ${loadNumber} already carries ${live.length} synthetic document(s) — run --remove first`,
      )

    const files = await generate()
    const total = files.reduce((sum, f) => sum + f.bytes.byteLength, 0)
    for (const f of files)
      console.log(
        `${f.type.padEnd(18)} ${f.filename.padEnd(30)} ${(f.bytes.byteLength / 1_048_576).toFixed(2)} MB`,
      )
    console.log(
      `total ${(total / 1_048_576).toFixed(2)} MB of ${CAP / 1_048_576} MB cap`,
    )
    if (total > CAP)
      throw new Error('over the cap — the probe would measure a refusal')
    if (mode !== 'write') {
      console.log('preview only — pass --write to upload and insert')
      return
    }

    const { AwsClient } = await import('aws4fetch')
    const r2 = new AwsClient({
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      service: 's3',
      region: 'auto',
    })
    const { rows: owner } = await pool.query(
      `select id from "User" where email = $1`,
      [process.env.SEED_OWNER_EMAIL],
    )
    for (const f of files) {
      const key = `${load.organizationId}/load/${load.id}/${randomUUID()}-${f.filename}`
      const url = `${process.env.R2_ENDPOINT.replace(/\/$/, '')}/${process.env.R2_BUCKET}/${key
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`
      const put = await r2.fetch(url, {
        method: 'PUT',
        body: f.bytes,
        headers: { 'content-type': f.mimeType },
      })
      if (!put.ok) throw new Error(`R2 PUT ${f.filename}: ${put.status}`)
      await pool.query(
        `insert into "Document" (id, "organizationId", "companyId", "r2Key", filename,
           "mimeType", "sizeBytes", sha256, type, "loadId", "uploadedByUserId", "updatedAt")
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9::"DocumentType", $10, $11, now())`,
        [
          `syn${randomUUID().replaceAll('-', '').slice(0, 22)}`,
          load.organizationId,
          load.companyId,
          key,
          f.filename,
          f.mimeType,
          f.bytes.byteLength,
          f.sha256,
          f.type,
          load.id,
          owner[0]?.id ?? null,
        ],
      )
      console.log(`stored ${f.filename}`)
    }
    console.log(
      `load ${loadNumber}: ${files.length} synthetic document(s) seeded`,
    )
  } finally {
    await pool.end()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`packet-heavy-seed: ${error.message} — NOT OK`)
    process.exitCode = 1
  })
}
