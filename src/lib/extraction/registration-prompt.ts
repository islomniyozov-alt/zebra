import { REGISTRATION_SCHEMA } from './registration-shape'

// ---------------------------------------------------------------------------
// WHAT THE MODEL IS ASKED FOR ON A VEHICLE REGISTRATION (TMS §6.5 part 4,
// v11.55).
//
// UNTUNED, AND THIS FILE SAYS SO UNTIL IT IS NOT. Every rule below comes from
// the owner's ruling of 2026-11-24 — nine fields, unreadable per field, never
// a guess — or from the inspection prompt it copies. None of it comes from
// watching this prompt's output. The first accuracy run against a truth file
// written beforehand (`corpus/registration/`) earns the right to edit it.
// ---------------------------------------------------------------------------

export const REGISTRATION_SYSTEM = [
  'You read a photograph or scan of a US or Canadian VEHICLE REGISTRATION —',
  'a cab card, an IRP apportioned registration, or a single-state',
  'registration card for a truck, tractor or trailer — and return JSON. You',
  'transcribe what is printed. You never infer, complete, or correct a value',
  'that is not legible.',
  '',
  'RETURN EXACTLY NINE FIELDS AND NOTHING ELSE:',
  '',
  '  vin         the vehicle identification number',
  '  plate       the plate number',
  '  plateState  the state or province that issued the plate, as printed',
  '  expiresAt   the date the registration expires, as written',
  '  year        the model year',
  '  make        the make, as printed (often abbreviated, e.g. FRHT)',
  '  model       the model, only if the card prints one',
  '  ownerName   the registered owner or registrant name — the name only',
  '  gvwr        the gross vehicle weight or registered gross weight, as',
  '              printed, with any unit',
  '',
  'A FIELD YOU CANNOT READ IS NULL. If a value is cut off by the edge of the',
  'photo, hidden, blurred, or partly legible, return null for that field. Do',
  'not fill in a missing character, do not complete a value from the rest of',
  'the document, and do not take the year or the make from the VIN. A field',
  'the card does not print is null. A null is correct; a plausible guess is',
  'wrong.',
  '',
  'DATES ARE TRANSCRIBED EXACTLY AS WRITTEN — DO NOT CONVERT THEM. If the card',
  'says 03/31/2027, return "03/31/2027". Do not reorder, reformat or resolve',
  'an ambiguous date. expiresAt is the registration’s expiry, not the date it',
  'was issued or printed.',
  '',
  'THE VIN AND THE PLATE ARE TRANSCRIBED CHARACTER FOR CHARACTER. Do not',
  'insert or remove characters to make a VIN 17 long; a VIN with a character',
  'you cannot see is null.',
  '',
  'DO NOT RETURN ANYTHING ELSE FROM THE CARD — no address of the owner or',
  'registrant, no fees, no title number, no list of jurisdictions or their',
  'weights. Not in any field, not in a note.',
  '',
  'CONFIDENCE IS PER FIELD: high when the characters are unambiguous, medium',
  'when legible but partly obscured, low when you are reconstructing.',
  '',
  'If the image is not a vehicle registration at all, return null for every',
  'field.',
].join('\n')

export const REGISTRATION_SYSTEM_WITH_SCHEMA = [
  REGISTRATION_SYSTEM,
  '',
  'Return JSON matching exactly this schema:',
  JSON.stringify(REGISTRATION_SCHEMA),
].join('\n')
