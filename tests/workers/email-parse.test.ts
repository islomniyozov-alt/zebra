import { describe, expect, it } from 'vitest'
import PostalMime from 'postal-mime'

// ---------------------------------------------------------------------------
// THE MAIL WORKER'S HALF, PROVEN INSIDE WORKERD (Phase 6 §4 step 4).
//
// Cloudflare Email Routing is not enabled on zebratms.com yet — no MX records
// exist — so the delivery hop cannot be exercised. Everything either side of
// it can be, and this is the side that runs in the mail worker: a real
// forwarded booking email, parsed by the same library on the same runtime.
//
// FORWARDED, because that is how the first ones will arrive. Spec §15 says
// manual forwarding must work identically, and a forward is the harder case:
// the booking becomes a nested `message/rfc822` part, the interesting text
// sits behind two boundaries, and the outer headers are the forwarder's rather
// than Amazon's.
// ---------------------------------------------------------------------------

/** The booking, as Amazon writes it — quoted-printable, like real mail. */
const BOOKING = [
  'Load Board - Trip 115M68R2H booked',
  'Dear RAM HAULAGE LLC,',
  'You have successfully booked the following trip.',
  '115M68R2H Starts in 20h 37m',
  'PCW1 ROSSFORD, OH >  MDW4 JOLIET, IL',
  'Fri 14 Aug 03:45 EDT > Fri 14 Aug 09:08 CDT',
  "53' Trailer |  Trailer provided  |  Solo Driver",
  'Estimated Payout  -  $551.81 ( $2.10/mi)  | 262.56mi',
].join('\r\n')

const FORWARDED = [
  'From: Dispatcher <dispatch@example.test>',
  'To: loads@zebratms.com',
  'Subject: Fwd: Load Board - Trip 115M68R2H booked',
  'Message-ID: <fwd-115M68R2H@example.test>',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="OUTER"',
  '',
  '--OUTER',
  'Content-Type: text/plain; charset="utf-8"',
  'Content-Transfer-Encoding: 7bit',
  '',
  'Booking below, please book it.',
  '',
  '--OUTER',
  'Content-Type: message/rfc822',
  '',
  'From: Amazon Relay <relay-noreply@amazon.com>',
  'To: dispatch@example.test',
  'Subject: Load Board - Trip 115M68R2H booked',
  'MIME-Version: 1.0',
  'Content-Type: multipart/alternative; boundary="INNER"',
  '',
  '--INNER',
  'Content-Type: text/plain; charset="utf-8"',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  // `=E2=80=90` is U+2010 HYPHEN, which the real booking contains — and the
  // reason quoted-printable is in this fixture rather than plain 7bit.
  'CONTRACT =E2=80=90 b407d92e-3b44-46fc-aadf-afdaa8793376',
  BOOKING.replace(/\r\n/g, '\r\n'),
  '',
  '--INNER',
  'Content-Type: text/html; charset="utf-8"',
  'Content-Transfer-Encoding: 7bit',
  '',
  '<html><body><p>Trip 115M68R2H booked</p></body></html>',
  '',
  '--INNER--',
  '',
  '--OUTER',
  'Content-Type: application/pdf; name="ratecon.pdf"',
  'Content-Disposition: attachment; filename="ratecon.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  // A tiny but genuine PDF header, so the mime type is not the only evidence.
  'JVBERi0xLjQKJeLjz9MK',
  '',
  '--OUTER--',
  '',
].join('\r\n')

describe('a forwarded booking email, parsed on workerd', () => {
  it('finds the headers the endpoint keys on', async () => {
    const parsed = await PostalMime.parse(FORWARDED)

    // The Message-ID is the idempotency key: Cloudflare can deliver twice.
    expect(parsed.messageId).toBe('<fwd-115M68R2H@example.test>')
    expect(parsed.subject).toContain('Trip 115M68R2H booked')
  })

  // THE ONE THAT MATTERS. The booking is two boundaries deep and
  // quoted-printable; a parser that only read the top-level text part would
  // hand the reader "Booking below, please book it." and nothing else — a
  // draft with no lane, no times and no money, looking for all the world like
  // a booking email the model failed on.
  it('reaches the booking through the forward and decodes it', async () => {
    const parsed = await PostalMime.parse(FORWARDED)
    const everything = [
      parsed.text ?? '',
      ...(parsed.attachments ?? []).map((attachment) =>
        typeof attachment.content === 'string' ? attachment.content : '',
      ),
    ].join('\n')

    expect(everything).toContain('115M68R2H')
    expect(everything).toContain('PCW1 ROSSFORD, OH')
    expect(everything).toContain('MDW4 JOLIET, IL')
    expect(everything).toContain('$551.81')
    // Quoted-printable decoded, not passed through: `=E2=80=90` became the
    // hyphen the real message carries.
    expect(everything).toContain('CONTRACT ‐ b407d92e')
    expect(everything).not.toContain('=E2=80=90')
  })

  it('keeps the PDF as an attachment the endpoint can read', async () => {
    const parsed = await PostalMime.parse(FORWARDED)
    const pdf = (parsed.attachments ?? []).find(
      (attachment) => attachment.mimeType === 'application/pdf',
    )

    expect(pdf).toBeDefined()
    expect(pdf!.filename).toBe('ratecon.pdf')
    expect(pdf!.content).toBeInstanceOf(ArrayBuffer)

    // Really a PDF, not just labelled one.
    const head = new Uint8Array(pdf!.content as ArrayBuffer).slice(0, 5)
    expect(new TextDecoder().decode(head)).toBe('%PDF-')
  })

  // The bytes have to be taken before the parser sees them: `message.raw` is a
  // stream, and whoever reads it first is the only one who reads it. Spec §12
  // needs the original kept, so the worker reads once and parses the copy.
  it('parses from bytes, which is how the worker keeps the original too', async () => {
    const raw = new TextEncoder().encode(FORWARDED)
    const parsed = await PostalMime.parse(raw)
    expect(parsed.subject).toContain('115M68R2H')
    // And the bytes are still there afterwards, which a stream would not be.
    expect(raw.byteLength).toBeGreaterThan(0)
  })
})
