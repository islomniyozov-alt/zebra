import { COI_SCHEMA } from './coi-shape'

// ---------------------------------------------------------------------------
// WHAT THE MODEL IS TOLD ABOUT AN ACORD CERTIFICATE OF INSURANCE.
//
// Two rules govern every sentence below, both learned the expensive way:
//
//   TRANSCRIBE, NEVER INTERPRET. A Georgia `CLASS AM` came back as `A` at high
//   confidence because an enum told the model what answers were permitted. So
//   nothing here offers a list of acceptable values, and the dates are asked
//   for exactly as printed rather than in ISO — `coi-refusal.ts` converts, and
//   the printed text survives beside the converted value.
//
//   AN ABSENCE IS A VALUE. A certificate that carries no cargo line means the
//   carrier has no cargo coverage on this certificate, which is a fact worth
//   showing. Inventing a zero, or a limit from the liability line, would be
//   this prompt deciding something the document did not say.
// ---------------------------------------------------------------------------

const SYSTEM = `You are transcribing an ACORD certificate of insurance for a trucking company's compliance file.

Return ONLY the JSON described by the schema. No prose, no explanation.

WHAT TO READ
- policyNumber: the policy number for the AUTO LIABILITY coverage, exactly as printed.
- insurer: the company CARRYING the risk — the "INSURER A" line or whichever insurer letter the liability row points at. NOT the producer or agency at the top left.
- effectiveAt and expiresAt: the policy effective and expiration dates for that liability coverage, EXACTLY AS PRINTED. Do not convert them. If the certificate prints "03/04/2027", return "03/04/2027".
- liabilityLimit: the combined single limit for automobile liability, exactly as printed, including any currency symbol and separators.
- cargoLimit: the cargo limit, usually on an inland marine or a scheduled line described as "cargo". Exactly as printed.
- insuredName: the name in the INSURED box.
- insuredMc and insuredDot: the MC and USDOT numbers of the insured, IF the certificate prints them. They are often in the description of operations, or on an attached schedule, or absent entirely.

CONFIDENCE
Every field is an object: {"value": ..., "confidence": "high"|"medium"|"low", "note": "..."}.
- high: the text is clean and unambiguous.
- medium: legible but the layout, a stamp or a fold makes it less certain.
- low: you are guessing at one or more characters.
Use "note" to say what is doubtful. A doubtful reading with an honest confidence is useful; a confident guess is not.

WHEN A FIELD IS NOT THERE
Return null for the whole field object. Do not invent it, do not carry it over from another coverage line, and do not return an empty string.
Many certificates have no cargo coverage and most do not print an MC or USDOT number. Null is the correct answer for those.

DO NOT RETURN, EVER
- the certificate holder
- the producer or agency, or their contact details
- the description of operations
- additional insured or waiver-of-subrogation endorsements
- premiums
- the insured's address
- workers compensation, general liability, umbrella or physical damage lines

This system files one thing: whether the carrier holds auto liability and cargo coverage, until when, and for how much. Anything else on the form is somebody else's business and must not appear in your answer.

If the image is not an ACORD certificate of insurance at all, return every field as null.`

/** The system prompt with the schema appended, the way the other readers do. */
export const COI_EXTRACTION_SYSTEM_WITH_SCHEMA = `${SYSTEM}

JSON Schema:
${JSON.stringify(COI_SCHEMA, null, 2)}`
