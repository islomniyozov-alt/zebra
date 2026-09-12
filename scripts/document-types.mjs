import { extname } from 'node:path'

// ---------------------------------------------------------------------------
// THE DOCUMENTS THIS SYSTEM READS, AND WHAT A RUNNER NEEDS TO KNOW ABOUT ONE.
//
// ── ONE RUNNER PER QUESTION, NOT PER DOCUMENT ─────────────────────────────
//
// There are two questions worth asking of a reader — "is it right" and "is it
// stable" — and they do not multiply by document type. `cdl-accuracy.mjs` and
// `cdl-variance.mjs` became `doc-accuracy.mjs` and `doc-variance.mjs` rather
// than growing medical-certificate twins, for the reason that extracted
// `envelope-parse.ts` and `DropZone`: two runners diverging is two places to
// fix a measurement bug, and a measurement bug is the kind that makes every
// number downstream wrong without looking wrong.
//
// WHAT ACTUALLY DIFFERS BETWEEN DOCUMENTS IS SMALL, which is the whole reason
// this works: a route, and whatever else the route needs in the form. Both
// read paths already return `{ fields, notice }`, so everything a runner does
// with a response is common.
// ---------------------------------------------------------------------------

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
}

export function mimeTypeOf(path) {
  return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * `extras` RESOLVES WHAT THE ROUTE NEEDS BESIDES THE FILE, AND REFUSES LOUDLY.
 *
 * The medical route names a driver, because a certificate lands on somebody's
 * page and the route resolves that driver through the tenant scope rather than
 * trusting the id. A runner that posted without one would get a 400 and report
 * it as a failed read — an instrument blaming the document for its own missing
 * argument, which is the shape this codebase keeps writing down.
 */
export const DOCUMENT_TYPES = {
  cdl: {
    label: 'commercial driver licence',
    route: '/api/cdl/read',
    corpus: 'corpus/cdl',
    extras: () => ({}),
  },
  coi: {
    label: 'ACORD certificate of insurance',
    // THE FRONT DOOR, NOT `/api/coi/read`, AND THAT IS DELIBERATE. A runner
    // that skipped the classifier would measure the reader alone and report it
    // as what a person gets — and on this document type the classifier is part
    // of the answer. `/api/compliance/read` returns the verdict beside the
    // proposal, which is the whole reading.
    route: '/api/compliance/read',
    corpus: 'corpus/coi',
    // NOTHING BESIDES THE FILE. A certificate used to need a `companyId` and no
    // longer does: `decideCoiSubject` places it from the insured and the VINs.
    // A runner supplying a carrier would be answering the question under test.
    extras: () => ({}),
  },
  med: {
    label: 'medical examiner certificate',
    route: '/api/med/read',
    corpus: 'corpus/med',
    extras: () => {
      const driverId = process.env.VERIFY_DRIVER_ID
      if (!driverId) {
        throw new Error(
          'The medical route needs a driver: set VERIFY_DRIVER_ID to one on the\n' +
            'target database. The route resolves it through the tenant scope, so it\n' +
            'must be a driver this login can see — posting without it returns 400,\n' +
            'which would read as a failed extraction rather than a missing argument.',
        )
      }
      return { driverId }
    },
  },
}

export function documentType(name) {
  const type = DOCUMENT_TYPES[name]
  if (!type) {
    throw new Error(
      `Unknown document type ${JSON.stringify(name)}. ` +
        `Known: ${Object.keys(DOCUMENT_TYPES).join(', ')}.`,
    )
  }
  return type
}

/**
 * Post one document to a read route, from inside the page.
 *
 * FROM INSIDE THE PAGE so the session cookie rides along — the same path a
 * drop zone takes, which is what makes this a reading of the deployed route
 * rather than of something assembled for the test.
 */
export async function readDocument(
  page,
  type,
  bytes,
  name,
  model = null,
  quarterTurns = 0,
) {
  return page.evaluate(
    async ({ b64, filename, mime, route, extras, turns }) => {
      const binary = atob(b64)
      const array = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i)
      let file = new File([array], filename, { type: mime })

      // ── THE ROTATION-NORMALISATION STEP, IN THE BROWSER THAT SHIPS IT ───
      //
      // `imageOrientation: 'from-image'` is the EXIF half and is always
      // applied, exactly as `downscale.ts` does — passed explicitly because
      // the spec default changed and a browser that ignores EXIF and one that
      // honours it would both be "correct".
      //
      // `turns` is the other half: what a PERSON does in `UprightCard` when
      // the file carries no EXIF. Supplied by the caller here, since a script
      // has nobody to ask.
      //
      // THIS REPRODUCES THE PIPELINE'S PRIMITIVES; IT DOES NOT DRIVE THE UI.
      // Said plainly because it matters when reading a number that came out of
      // it: the same `createImageBitmap` and the same canvas rotation, but not
      // the same React component, and not the 1600px downscale — these cards
      // are already under that edge.
      if (mime.startsWith('image/')) {
        const bitmap = await createImageBitmap(file, {
          imageOrientation: 'from-image',
        })
        const sideways = turns === 1 || turns === 3
        const canvas = document.createElement('canvas')
        canvas.width = sideways ? bitmap.height : bitmap.width
        canvas.height = sideways ? bitmap.width : bitmap.height
        const context = canvas.getContext('2d')
        context.translate(canvas.width / 2, canvas.height / 2)
        context.rotate((turns * Math.PI) / 2)
        context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)
        bitmap.close()
        const blob = await new Promise((resolve) =>
          canvas.toBlob(resolve, 'image/jpeg', 0.85),
        )
        file = new File([blob], filename, { type: 'image/jpeg' })
      }

      const body = new FormData()
      body.append('file', file)
      for (const [key, value] of Object.entries(extras)) body.append(key, value)
      const response = await fetch(route, { method: 'POST', body })
      return { status: response.status, text: await response.text() }
    },
    {
      b64: bytes.toString('base64'),
      filename: name,
      mime: mimeTypeOf(name),
      route: type.route,
      // THE MODEL RIDES IN THE FORM, allowlisted by the route. A named engine
      // is never defaulted away: a comparison whose column could quietly be
      // answered by the other provider measures nothing.
      extras: { ...type.extras(), ...(model ? { model } : {}) },
      turns: ((quarterTurns % 4) + 4) % 4,
    },
  )
}

/**
 * A field's reading, flattened so two runs can be compared.
 *
 * CODE LISTS ARE ARRAYS OF ENVELOPES, so their values AND their per-element
 * confidences both matter: a run returning the same codes at different
 * confidences has not returned the same answer, and collapsing that would hide
 * the instability the variance runner exists to find.
 */
export function readingOf(field) {
  const show = (value) => JSON.stringify(value ?? null)
  if (Array.isArray(field)) {
    return {
      value: show(field.map((entry) => entry?.value ?? null)),
      confidence:
        field.map((entry) => entry?.confidence ?? '—').join('+') || '—',
    }
  }
  return {
    value: show(field?.value ?? null),
    confidence: field?.confidence ?? '—',
  }
}

/** Sign in and land somewhere the read routes are reachable from. */
export async function signIn(page, base, email, password) {
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/(loads|dashboard)/, { timeout: 60_000 })
}
