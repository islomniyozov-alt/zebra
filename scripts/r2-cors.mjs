import { AwsClient } from 'aws4fetch'

// ---------------------------------------------------------------------------
// R2 BUCKET CORS — read it, and set it deliberately.
//
// §9 uploads go BROWSER → R2 with a presigned URL. The Worker never sees the
// file, which is the whole point, and it also means the browser's own CORS
// rules decide whether the upload happens at all. A bucket with no rule for
// the calling origin fails the PUT with no useful message anywhere: the
// terminal upload works, the deployed one does not, and the browser console
// says "network error". That cost an afternoon on the first deploy
// (PHASE-1-BRIEF §169) and the fix lived only in somebody's dashboard.
//
// So it lives here instead. Reading is free; writing needs --apply, because
// this REPLACES the bucket's entire CORS configuration rather than adding to
// it, and an origin dropped by accident is an upload path that silently dies.
//
//   node -r dotenv/config scripts/r2-cors.mjs                      # show
//   node -r dotenv/config scripts/r2-cors.mjs --apply \
//     --bucket zebra-docs --origin https://tms.tajikcargollc.com
//
// CREDENTIALS: NOT THE APPLICATION'S KEY PAIR. Measured, not assumed — with
// the app token (Object Read & Write) both GET and PUT of ?cors return
//
//     403 <Code>AccessDenied</Code>
//
// because bucket configuration is an ADMIN scope. That is the correct division
// and the worker should keep the narrow token. So this script is run once,
// by hand, with a temporary **Admin Read & Write** token that is deleted
// immediately afterwards:
//
//   R2_ACCESS_KEY_ID=<admin> R2_SECRET_ACCESS_KEY=<admin> \
//     node -r dotenv/config scripts/r2-cors.mjs --apply \
//     --bucket zebra-docs --origin https://tms.tajikcargollc.com
//
// The alternative is the dashboard, which is where this configuration lived
// for all of Phase 1 — with the result that nobody could review it, diff it,
// or say what it was without logging in. The XML below is the record.
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}

const APPLY = args.includes('--apply')
const BUCKET = flag('bucket', process.env.R2_BUCKET)
const ENDPOINT = process.env.R2_ENDPOINT
const ORIGINS = args
  .map((value, index) => (args[index - 1] === '--origin' ? value : null))
  .filter(Boolean)

if (!BUCKET || !ENDPOINT) {
  console.error('R2_BUCKET and R2_ENDPOINT must be set (or pass --bucket).')
  process.exit(1)
}

const client = new AwsClient({
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  service: 's3',
  region: 'auto',
})

const url = `${ENDPOINT.replace(/\/+$/, '')}/${BUCKET}?cors`

const show = async () => {
  const response = await client.fetch(url, { method: 'GET' })
  const body = await response.text()
  console.log(`GET ${BUCKET}?cors → ${response.status}`)
  if (response.status === 404 || body.includes('NoSuchCORSConfiguration')) {
    console.log('  NO CORS CONFIGURATION. Browser uploads to this bucket fail.')
    return null
  }
  console.log(body.replace(/></g, '>\n<'))
  return body
}

if (!APPLY) {
  await show()
  console.log(
    '\nNothing was changed. Pass --apply --origin <url> [--origin <url>] to set it.',
  )
  process.exit(0)
}

if (ORIGINS.length === 0) {
  console.error('--apply needs at least one --origin.')
  process.exit(1)
}

// PUT and GET only. The browser PUTs the file to a presigned URL and reads
// nothing back; DELETE and the rest are the Worker's business, over a
// connection CORS does not apply to.
//
// ETag is exposed because the upload client reads it to confirm what R2
// stored. AllowedHeaders is `*` because a presigned PUT carries whatever
// content-type the file had.
const policy = `<CORSConfiguration>
${ORIGINS.map(
  (origin) => `  <CORSRule>
    <AllowedOrigin>${origin}</AllowedOrigin>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <MaxAgeSeconds>3600</MaxAgeSeconds>
  </CORSRule>`,
).join('\n')}
</CORSConfiguration>`

console.log('--- current ---')
await show()
console.log('\n--- about to write ---')
console.log(policy)

const response = await client.fetch(url, {
  method: 'PUT',
  headers: { 'content-type': 'application/xml' },
  body: policy,
})
console.log(`\nPUT ${BUCKET}?cors → ${response.status}`)
if (!response.ok) {
  console.error(await response.text())
  process.exit(1)
}

console.log('--- now ---')
await show()
