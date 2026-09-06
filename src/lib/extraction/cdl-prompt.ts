import { CDL_SCHEMA } from './cdl-shape'

// ---------------------------------------------------------------------------
// WHAT THE MODEL IS ASKED FOR, AND WHAT IT IS TOLD NOT TO TAKE.
//
// UNTUNED, DELIBERATELY, AND THIS FILE SHOULD SAY SO UNTIL IT IS NOT. Every
// rule below comes from the AAMVA card design standard or from the owner's
// ruling — external truth about how a licence is printed. None of it comes
// from watching this prompt's output, because there is no card to watch it
// against: the corpus holds thirteen freight documents and zero licences.
//
// Phase 5 §9 item 7 is the rule this respects: changing a prompt before there
// is verified truth is tuning against the model's own answers. Transcribing a
// published standard is not tuning. The first accuracy run against a real card
// is what earns the right to edit anything here.
// ---------------------------------------------------------------------------

export const CDL_EXTRACTION_SYSTEM = [
  'You read a photograph or scan of a North American commercial driver licence',
  'and return JSON. You transcribe what is printed. You never infer, complete,',
  'or correct a value that is not legible.',
  '',
  'FIND FIELDS BY THEIR PRINTED AAMVA NUMBER, NOT BY ENGLISH LABEL OR BY',
  'POSITION. Every licence prints small numeric identifiers beside its fields.',
  'States relabel and rearrange constantly; the numbers do not move.',
  '',
  '  1   family name (surname)',
  '  2   given name(s)',
  '  4a  date issued',
  '  4b  date of expiry',
  '  4d  LICENCE NUMBER',
  '  9   class (A, B or C)',
  '  9a  endorsements',
  '  12  restrictions',
  '',
  'THE LICENCE NUMBER IS 4d AND ONLY 4d. The card also prints a long',
  'alphanumeric at 5DD, the DOCUMENT DISCRIMINATOR — an inventory number for',
  'the physical card. It is often longer, sometimes larger, and it is NOT the',
  'licence number. If you cannot find 4d, return null for licenceNumber. Never',
  'substitute 5DD, and never return a value you found only at 5DD.',
  '',
  'NAMES COME FROM 1 AND 2 AS LABELLED. Do not reorder them to match English',
  'name conventions. The card states which is the family name; many drivers do',
  'not follow the given-then-family pattern, and a swap files a person under',
  'the wrong name.',
  '',
  'DATES ARE ISO, yyyy-mm-dd, transcribed from the card. Do not compute, shift',
  'or normalise into a timezone. If a date is printed ambiguously, lower your',
  'confidence rather than choosing an interpretation.',
  '',
  'STATE: give the two-letter code from the state named across the top of the',
  'card, and put the ST value from the PRINTED ADDRESS in the note field so it',
  'can be cross-checked. Do not return the address itself.',
  '',
  'ENDORSEMENTS AND RESTRICTIONS are arrays of codes. If the card prints NONE',
  'or leaves the field empty, return an empty array — never the word NONE.',
  '',
  'isTemporary IS TRUE when the credential is marked TEMPORARY, INTERIM,',
  'PAPER, or is otherwise not a permanent card.',
  '',
  'DO NOT RETURN, AND DO NOT TRANSCRIBE ANYWHERE: date of birth, address,',
  'sex, height, weight, eye or hair colour, the signature, or the portrait.',
  'They are printed on the card and this system does not want them.',
  '',
  'CONFIDENCE IS PER FIELD: high when the characters are unambiguous, medium',
  'when legible but partly obscured, low when you are reconstructing. A glare',
  'across a digit is low, not high.',
  '',
  'If the image is not a driver licence at all, return null for every field.',
].join('\n')

export const CDL_EXTRACTION_SYSTEM_WITH_SCHEMA = [
  CDL_EXTRACTION_SYSTEM,
  '',
  'Return JSON matching exactly this schema:',
  JSON.stringify(CDL_SCHEMA),
].join('\n')
