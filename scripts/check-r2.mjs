import { AwsClient } from 'aws4fetch'

// ---------------------------------------------------------------------------
// PROVE AN R2 KEY PAIR BEFORE IT BECOMES A SECRET.
//
// The sibling of check-connection.mjs, and it exists for the same reason:
// three secrets on this project have now been set to the wrong thing, and
// none of them announced it.
//
//   prod-url.txt              held the PowerShell command, not its output
//   DATABASE_URL (production) a valid URL with the wrong password
//   R2_ACCESS_KEY_ID (dev)    held `(Get-Clipboard -Raw).Trim() | npx wrangler
//                             secret put R2_ACCESS_KEY_ID` — 70 characters of
//                             shell, stored as a 32-character key
//
// The R2 one is the worst of the three, because nothing fails until a person
// tries to upload a document — and then it fails in the BROWSER, as
// `net::ERR_FAILED`, which reads like a CORS problem. The worker's log is
// clean. R2's actual answer, visible only outside the browser, was:
//
//   400 InvalidArgument: Credential access key has length 70, should be 32
//
// This asks R2 the same question in two seconds, before the value is stored:
// it writes a probe object to the bucket and deletes it again.
//
//   R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=zebra-docs \
//     R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com \
//     node scripts/check-r2.mjs
//
// Or with everything already in .env, to check what dev is using:
//
//   node -r dotenv/config scripts/check-r2.mjs
// ---------------------------------------------------------------------------

const KEY = process.env.R2_ACCESS_KEY_ID
const SECRET = process.env.R2_SECRET_ACCESS_KEY
const BUCKET = process.env.R2_BUCKET
const ENDPOINT = process.env.R2_ENDPOINT

const missing = Object.entries({
  R2_ACCESS_KEY_ID: KEY,
  R2_SECRET_ACCESS_KEY: SECRET,
  R2_BUCKET: BUCKET,
  R2_ENDPOINT: ENDPOINT,
})
  .filter(([, value]) => !value)
  .map(([name]) => name)

if (missing.length > 0) {
  console.error(`Not set: ${missing.join(', ')}`)
  process.exit(1)
}

// Shape first, because the shape failure is the one that has actually
// happened and its message from R2 is buried three layers down. Never prints
// the values — a wrong key is still a credential.
const shape = (name, value, expected) => {
  const ok = value.length === expected && /^[0-9a-f]+$/i.test(value)
  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(22)} ${value.length} chars` +
      (ok ? '' : ` — expected ${expected} hex characters`) +
      (/\s/.test(value) ? ' — CONTAINS WHITESPACE' : ''),
  )
  return ok
}

const shapesOk =
  shape('R2_ACCESS_KEY_ID', KEY, 32) & shape('R2_SECRET_ACCESS_KEY', SECRET, 64)

console.log(`      bucket                 ${BUCKET}`)
console.log(`      endpoint               ${new URL(ENDPOINT).hostname}`)
console.log('')

if (!shapesOk) {
  console.error(
    'The shape is wrong, so the round trip below would only confuse matters.\n' +
      'Common cause: the shell command was stored instead of its output.',
  )
  process.exit(1)
}

const client = new AwsClient({
  accessKeyId: KEY,
  secretAccessKey: SECRET,
  service: 's3',
  region: 'auto',
})
const base = `${ENDPOINT.replace(/\/+$/, '')}/${BUCKET}`
const key = `probe/check-r2-${Date.now()}.txt`

const put = await client.fetch(`${base}/${key}`, {
  method: 'PUT',
  body: 'probe',
})
if (!put.ok) {
  console.error(`FAIL  PUT ${BUCKET}/${key} -> ${put.status}`)
  console.error(`      ${(await put.text()).slice(0, 300)}`)
  console.error(
    '\n  A 403 here usually means the token is scoped to a different bucket.',
  )
  process.exit(1)
}
console.log(`ok    PUT ${BUCKET}/... -> ${put.status}`)

const get = await client.fetch(`${base}/${key}`)
console.log(
  `${get.ok ? 'ok  ' : 'FAIL'}  GET -> ${get.status} (${(await get.text()).length} bytes back)`,
)

const del = await client.fetch(`${base}/${key}`, { method: 'DELETE' })
console.log(`${del.ok ? 'ok  ' : 'FAIL'}  DELETE -> ${del.status}`)

console.log(
  `\nThis pair can read and write ${BUCKET}. It says nothing about the bucket's\n` +
    'CORS rules — those decide whether a BROWSER may do the same, and are set\n' +
    'with scripts/r2-cors.mjs.',
)
process.exit(put.ok && get.ok && del.ok ? 0 : 1)
