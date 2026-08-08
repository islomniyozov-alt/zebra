import { AwsClient } from 'aws4fetch'

// ---------------------------------------------------------------------------
// R2, over the S3 API
//
// Not an R2 binding. Bindings cannot mint presigned URLs, and the whole point
// of §9 is that the file never passes through the Worker — a 40MB scanned POD
// uploaded from a truck stop should not spend a second of Worker CPU or count
// against a request's memory.
//
// aws4fetch rather than @aws-sdk: SigV4 over WebCrypto in about four kilobytes,
// and it runs on workerd unmodified. The AWS SDK works too and costs an order
// of magnitude more bundle for signing we can do in one call.
//
// WHAT A PRESIGNED URL IS. A capability. Once minted it is a bearer token that
// anyone holding it can use until it expires — no session, no cookie, no
// further check. Everything below is shaped by that: authorization happens
// before the URL exists, the TTL is minutes, and the URL is bound to one exact
// object rather than to a permission to write.
// ---------------------------------------------------------------------------

export interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  endpoint: string
}

export function r2ConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): R2Config {
  const required = {
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
    endpoint: env.R2_ENDPOINT,
  }

  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name)

  if (missing.length > 0) {
    throw new Error(`R2 is not configured: missing ${missing.join(', ')}.`)
  }

  return required as R2Config
}

function client(config: R2Config): AwsClient {
  return new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: 's3',
    region: 'auto',
  })
}

const objectUrl = (config: R2Config, key: string): string =>
  `${config.endpoint.replace(/\/$/, '')}/${config.bucket}/${key
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`

export interface PresignedPutRequest {
  key: string
  /** Exact bytes the object must be. */
  sizeBytes: number
  /** Exact media type the object must be uploaded as. */
  contentType: string
  /** Base64 SHA-256 of the exact bytes. */
  sha256Base64: string
  expiresInSeconds: number
}

/**
 * A URL that can upload exactly one file, and nothing else.
 *
 * §9 asks for a content-length *range* and a content type. R2 turns out to
 * enforce signed `content-length`, `content-type` AND `x-amz-checksum-sha256`,
 * verified against live R2 — so this goes further than a range and pins the
 * exact bytes. Consequences worth having:
 *
 *   * A leaked URL cannot upload a different, larger, or malicious file. It
 *     can only re-upload the identical bytes it was minted for, which is a
 *     capability worth almost nothing to an attacker.
 *   * There is no "range" to get wrong. The size is declared at mint time,
 *     checked against policy there, and then fixed by signature.
 *   * `Document.sha256` ends up holding a digest R2 itself verified rather
 *     than a number the client told us twice.
 *
 * Anything other than an exact match is a 403 from R2, before a byte is
 * stored. Tests assert each of those refusals.
 */
export async function presignPut(
  config: R2Config,
  request: PresignedPutRequest,
): Promise<{ url: string; headers: Record<string, string>; expiresAt: Date }> {
  const headers: Record<string, string> = {
    'content-type': request.contentType,
    'content-length': String(request.sizeBytes),
    'x-amz-checksum-sha256': request.sha256Base64,
  }

  const url = new URL(objectUrl(config, request.key))
  url.searchParams.set('X-Amz-Expires', String(request.expiresInSeconds))

  const signed = await client(config).sign(url.toString(), {
    method: 'PUT',
    headers,
    // signQuery puts the credential in the query string so the browser needs
    // no Authorization header; allHeaders makes content-length part of the
    // signature rather than something R2 ignores.
    aws: { signQuery: true, allHeaders: true },
  })

  return {
    url: signed.url,
    // The client MUST send these back verbatim. They are not advisory — they
    // are what the signature covers.
    headers,
    expiresAt: new Date(Date.now() + request.expiresInSeconds * 1000),
  }
}

/** A short-lived read URL. Minted only after an authorization check. */
export async function presignGet(
  config: R2Config,
  key: string,
  expiresInSeconds: number,
  options: { downloadFilename?: string } = {},
): Promise<{ url: string; expiresAt: Date }> {
  const url = new URL(objectUrl(config, key))
  url.searchParams.set('X-Amz-Expires', String(expiresInSeconds))

  if (options.downloadFilename) {
    // Serve as an attachment with the name the user uploaded, not the uuid the
    // key carries.
    url.searchParams.set(
      'response-content-disposition',
      `attachment; filename="${options.downloadFilename.replace(/["\\]/g, '')}"`,
    )
  }

  const signed = await client(config).sign(url.toString(), {
    method: 'GET',
    aws: { signQuery: true },
  })

  return {
    url: signed.url,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
  }
}

export interface ObjectFacts {
  sizeBytes: number
  contentType: string | null
  etag: string | null
  checksumSha256: string | null
}

/**
 * What R2 actually holds at `key`, or null if nothing does.
 *
 * This is the check that keeps the phantom-row rule honest: confirm asks R2
 * what landed rather than believing the client's report of it.
 */
export async function headObject(
  config: R2Config,
  key: string,
): Promise<ObjectFacts | null> {
  const response = await client(config).fetch(objectUrl(config, key), {
    method: 'HEAD',
  })

  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`R2 HEAD ${key} failed: ${response.status}`)
  }

  return {
    sizeBytes: Number(response.headers.get('content-length') ?? 0),
    contentType: response.headers.get('content-type'),
    etag: response.headers.get('etag'),
    checksumSha256: response.headers.get('x-amz-checksum-sha256'),
  }
}

/**
 * The object's bytes, or null if nothing is stored at that key.
 *
 * Signed the same way `headObject` is — an authenticated GET rather than a
 * presigned URL fetched afterwards, because nothing outside the worker needs
 * to see this one and a URL is a capability that would then exist.
 *
 * Used by extraction (Phase 5), which is the only caller that needs the FILE
 * rather than a link to it: the model reads the document.
 */
export async function objectBytes(
  config: R2Config,
  key: string,
): Promise<Uint8Array | null> {
  const response = await client(config).fetch(objectUrl(config, key), {
    method: 'GET',
  })

  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`R2 GET ${key} failed: ${response.status}`)
  }

  return new Uint8Array(await response.arrayBuffer())
}

/** Used by reconciliation to clear orphans. Absent is success. */
export async function deleteObject(
  config: R2Config,
  key: string,
): Promise<void> {
  const response = await client(config).fetch(objectUrl(config, key), {
    method: 'DELETE',
  })
  if (!response.ok && response.status !== 404) {
    throw new Error(`R2 DELETE ${key} failed: ${response.status}`)
  }
}
