// GENERATED FROM THE ARTEFACT, NOT TYPED BY HAND.
//
// Six real Datatruck statements in `corpus/datatruck`, read out of the PDFs
// themselves: the fonts are CID-keyed subsets, so every figure here came
// through each font's ToUnicode CMap rather than off a screen. Two ligatures
// live in the Private Use Area — U+E007 is "ff" and U+E009 is "tt" — which is
// why the raw text says "Payment tari" and "Se lement" until they are mapped.
//
// THE CORPUS IS GITIGNORED. That is the whole reason this file exists: an
// acceptance that only runs where somebody's `corpus/` happens to be is an
// acceptance for one laptop. `tests/trips-csv.test.ts` records the rule.
//
// Checked before it was written down: in all six, the per-line amounts sum to
// the printed Earnings total, the grosses sum to the printed gross, and the
// mileages sum to the printed mileage. A transcription that did not tie to its
// own totals would be a transcription with a typo in it.

export interface StatementLoadRow {
  loadNumber: string
  puDate: number
  delDate: number
  grossCents: number
  milesHundredths: number
  /** The Total amount column — what the engine has to reproduce. */
  amountCents: number
  /**
   * The rate THIS LINE actually paid, in basis points.
   *
   * Only present where a statement mixes them, which ST-005395 does: four
   * lines at 30% and two at 20%, under a header that reads 20%. Derived from
   * the printed figures rather than assumed — see the note on that fixture.
   */
  percentBps?: number
}

export interface StatementChargeRow {
  type: string
  description: string
  quantity: number
  rateCents: number
  /** Signed as printed: deductions negative, other pay positive. */
  totalCents: number
}

export interface StatementFixture {
  number: string
  batch: string
  company: string
  driver: string
  unitNumber: string
  /** "88% from gross", verbatim. */
  tariff: string
  percentBps: number
  periodStart: number
  periodEnd: number
  statementDate: number
  checkDate: number
  loads: StatementLoadRow[]
  totals: { grossCents: number; milesHundredths: number; amountCents: number }
  deductions: StatementChargeRow[]
  otherPay: StatementChargeRow[]
  summary: {
    earningsCents: number
    advancesCents: number
    reimbursementsCents: number
    deductionsCents: number
    otherPayCents: number
    netCents: number
  }
  ytd: {
    earningsCents: number
    advancesCents: number
    reimbursementsCents: number
    deductionsCents: number
    otherPayCents: number
    netCents: number
  }
}

export const DATATRUCK_STATEMENTS: StatementFixture[] = [
  {
    number: 'ST-005284',
    batch: 'SB-000436',
    company: 'Statement Date:',
    driver: 'Hassan Ali Hirsi',
    unitNumber: '9438',
    tariff: '88% from gross',
    percentBps: 8800,
    periodStart: Date.UTC(2026, 7, 9),
    periodEnd: Date.UTC(2026, 7, 15),
    statementDate: Date.UTC(2026, 7, 19),
    checkDate: Date.UTC(2026, 7, 21),
    loads: [
      {
        loadNumber: 'T-116W49TX6',
        puDate: Date.UTC(2026, 7, 8),
        delDate: Date.UTC(2026, 7, 9),
        grossCents: 49033,
        milesHundredths: 17580,
        amountCents: 43149,
      },
      {
        loadNumber: '111KBMHMD',
        puDate: Date.UTC(2026, 7, 9),
        delDate: Date.UTC(2026, 7, 9),
        grossCents: 74362,
        milesHundredths: 21100,
        amountCents: 65439,
      },
      {
        loadNumber: 'T-112WP9ZVD',
        puDate: Date.UTC(2026, 7, 9),
        delDate: Date.UTC(2026, 7, 9),
        grossCents: 97359,
        milesHundredths: 34830,
        amountCents: 85676,
      },
      {
        loadNumber: '1148NZVJG',
        puDate: Date.UTC(2026, 7, 10),
        delDate: Date.UTC(2026, 7, 10),
        grossCents: 69972,
        milesHundredths: 30364,
        amountCents: 61575,
      },
      {
        loadNumber: 'T-111Y169CJ',
        puDate: Date.UTC(2026, 7, 10),
        delDate: Date.UTC(2026, 7, 11),
        grossCents: 128412,
        milesHundredths: 15500,
        amountCents: 113003,
      },
      {
        loadNumber: '113BL8XZJ',
        puDate: Date.UTC(2026, 7, 11),
        delDate: Date.UTC(2026, 7, 11),
        grossCents: 85599,
        milesHundredths: 25500,
        amountCents: 75327,
      },
      {
        loadNumber: 'T-113PDBV26',
        puDate: Date.UTC(2026, 7, 11),
        delDate: Date.UTC(2026, 7, 12),
        grossCents: 203363,
        milesHundredths: 75879,
        amountCents: 178959,
      },
      {
        loadNumber: '114LR63J7',
        puDate: Date.UTC(2026, 7, 12),
        delDate: Date.UTC(2026, 7, 13),
        grossCents: 93416,
        milesHundredths: 34734,
        amountCents: 82206,
      },
      {
        loadNumber: '111ZR9GMP',
        puDate: Date.UTC(2026, 7, 13),
        delDate: Date.UTC(2026, 7, 13),
        grossCents: 17500,
        milesHundredths: 11722,
        amountCents: 15400,
      },
      {
        loadNumber: '114Y6RKK1',
        puDate: Date.UTC(2026, 7, 13),
        delDate: Date.UTC(2026, 7, 14),
        grossCents: 83584,
        milesHundredths: 25719,
        amountCents: 73554,
      },
      {
        loadNumber: '116591VZM',
        puDate: Date.UTC(2026, 7, 14),
        delDate: Date.UTC(2026, 7, 14),
        grossCents: 64109,
        milesHundredths: 11600,
        amountCents: 56416,
      },
      {
        loadNumber: 'T-113JP2J3N',
        puDate: Date.UTC(2026, 7, 14),
        delDate: Date.UTC(2026, 7, 14),
        grossCents: 48371,
        milesHundredths: 3500,
        amountCents: 42566,
      },
      {
        loadNumber: '111G4J4H7',
        puDate: Date.UTC(2026, 7, 14),
        delDate: Date.UTC(2026, 7, 14),
        grossCents: 43403,
        milesHundredths: 22232,
        amountCents: 38195,
      },
      {
        loadNumber: '111PP2HV2',
        puDate: Date.UTC(2026, 7, 14),
        delDate: Date.UTC(2026, 7, 15),
        grossCents: 143268,
        milesHundredths: 39700,
        amountCents: 126076,
      },
      {
        loadNumber: '111C5M3CG',
        puDate: Date.UTC(2026, 7, 15),
        delDate: Date.UTC(2026, 7, 15),
        grossCents: 117881,
        milesHundredths: 40078,
        amountCents: 103735,
      },
    ],
    totals: {
      grossCents: 1319632,
      milesHundredths: 410038,
      amountCents: 1161276,
    },
    deductions: [
      {
        type: 'Fuel',
        description: 'Auto calculated Fuel cost',
        quantity: 1,
        rateCents: 263421,
        totalCents: -263421,
      },
      {
        type: 'Insurance',
        description: 'Insurance (GL, AL, Cargo, TI) for August $1800/$450',
        quantity: 1,
        rateCents: 45000,
        totalCents: -45000,
      },
      {
        type: 'Ifta',
        description: '',
        quantity: 1,
        rateCents: 5000,
        totalCents: -5000,
      },
      {
        type: 'Admin Fee',
        description: '',
        quantity: 1,
        rateCents: 5000,
        totalCents: -5000,
      },
    ],
    otherPay: [],
    summary: {
      earningsCents: 1161276,
      advancesCents: 0,
      reimbursementsCents: 0,
      deductionsCents: -318421,
      otherPayCents: 0,
      netCents: 842855,
    },
    ytd: {
      earningsCents: 14672164,
      advancesCents: 0,
      reimbursementsCents: 0,
      deductionsCents: -8069603,
      otherPayCents: 160734,
      netCents: 6763295,
    },
  },
  {
    number: 'ST-005301',
    batch: 'SB-000437',
    company: 'Statement Date:',
    driver: 'Shodmon Muzaffarov',
    unitNumber: '0484',
    tariff: '32% from gross',
    percentBps: 3200,
    periodStart: Date.UTC(2026, 7, 16),
    periodEnd: Date.UTC(2026, 7, 22),
    statementDate: Date.UTC(2026, 7, 25),
    checkDate: Date.UTC(2026, 7, 27),
    loads: [
      {
        loadNumber: '2004343686',
        puDate: Date.UTC(2026, 7, 16),
        delDate: Date.UTC(2026, 7, 17),
        grossCents: 186120,
        milesHundredths: 57903,
        amountCents: 59558,
      },
      {
        loadNumber: '2004343919',
        puDate: Date.UTC(2026, 7, 17),
        delDate: Date.UTC(2026, 7, 17),
        grossCents: 130730,
        milesHundredths: 49339,
        amountCents: 41834,
      },
      {
        loadNumber: '2004363705',
        puDate: Date.UTC(2026, 7, 18),
        delDate: Date.UTC(2026, 7, 19),
        grossCents: 227280,
        milesHundredths: 70283,
        amountCents: 72730,
      },
      {
        loadNumber: '2004326716',
        puDate: Date.UTC(2026, 7, 19),
        delDate: Date.UTC(2026, 7, 20),
        grossCents: 390720,
        milesHundredths: 131151,
        amountCents: 125030,
      },
      {
        loadNumber: '2004364595',
        puDate: Date.UTC(2026, 7, 20),
        delDate: Date.UTC(2026, 7, 22),
        grossCents: 393460,
        milesHundredths: 149274,
        amountCents: 125907,
      },
    ],
    totals: {
      grossCents: 1328310,
      milesHundredths: 457950,
      amountCents: 425059,
    },
    deductions: [],
    otherPay: [],
    summary: {
      earningsCents: 425059,
      advancesCents: 0,
      reimbursementsCents: 0,
      deductionsCents: 0,
      otherPayCents: 0,
      netCents: 425059,
    },
    ytd: {
      earningsCents: 13049561,
      advancesCents: 0,
      reimbursementsCents: 0,
      deductionsCents: -4348722,
      otherPayCents: 47250,
      netCents: 8748089,
    },
  },
  {
    number: 'ST-005310',
    batch: 'SB-000438',
    company: 'Statement Date:',
    driver: 'Hassan Ali Hirsi',
    unitNumber: '9438',
    tariff: '88% from gross',
    percentBps: 8800,
    periodStart: Date.UTC(2026, 7, 16),
    periodEnd: Date.UTC(2026, 7, 22),
    statementDate: Date.UTC(2026, 7, 25),
    checkDate: Date.UTC(2026, 7, 27),
    loads: [
      {
        loadNumber: 'T-115ZQKY6S',
        puDate: Date.UTC(2026, 7, 16),
        delDate: Date.UTC(2026, 7, 16),
        grossCents: 86810,
        milesHundredths: 16586,
        amountCents: 76393,
      },
      {
        loadNumber: 'T-112WXXWS5',
        puDate: Date.UTC(2026, 7, 16),
        delDate: Date.UTC(2026, 7, 16),
        grossCents: 108736,
        milesHundredths: 23904,
        amountCents: 95688,
      },
      {
        loadNumber: '111XG28QK',
        puDate: Date.UTC(2026, 7, 16),
        delDate: Date.UTC(2026, 7, 16),
        grossCents: 57754,
        milesHundredths: 15372,
        amountCents: 50824,
      },
      {
        loadNumber: '113XKZR31',
        puDate: Date.UTC(2026, 7, 16),
        delDate: Date.UTC(2026, 7, 17),
        grossCents: 77999,
        milesHundredths: 16000,
        amountCents: 68639,
      },
      {
        loadNumber: 'T-112WMNZCX',
        puDate: Date.UTC(2026, 7, 17),
        delDate: Date.UTC(2026, 7, 17),
        grossCents: 79139,
        milesHundredths: 32428,
        amountCents: 69642,
      },
      {
        loadNumber: '115FRTN5P',
        puDate: Date.UTC(2026, 7, 18),
        delDate: Date.UTC(2026, 7, 18),
        grossCents: 85398,
        milesHundredths: 26266,
        amountCents: 75150,
      },
      {
        loadNumber: 'T-112CK6V8S',
        puDate: Date.UTC(2026, 7, 18),
        delDate: Date.UTC(2026, 7, 19),
        grossCents: 188946,
        milesHundredths: 45375,
        amountCents: 166272,
      },
      {
        loadNumber: '11456FLGT',
        puDate: Date.UTC(2026, 7, 19),
        delDate: Date.UTC(2026, 7, 19),
        grossCents: 106239,
        milesHundredths: 26855,
        amountCents: 93490,
      },
      {
        loadNumber: '113KQ1GR1',
        puDate: Date.UTC(2026, 7, 20),
        delDate: Date.UTC(2026, 7, 21),
        grossCents: 130055,
        milesHundredths: 60997,
        amountCents: 114448,
      },
    ],
    totals: {
      grossCents: 921076,
      milesHundredths: 263783,
      amountCents: 810546,
    },
    deductions: [
      {
        type: 'Fuel',
        description: 'Auto calculated Fuel cost',
        quantity: 1,
        rateCents: 175040,
        totalCents: -175040,
      },
      {
        type: 'Tolls',
        description: 'TollPrePass 08/01/2026 to 08/31/2026',
        quantity: 1,
        rateCents: 15721,
        totalCents: -15721,
      },
      {
        type: 'Ifta',
        description: '',
        quantity: 1,
        rateCents: 5000,
        totalCents: -5000,
      },
      {
        type: 'Admin Fee',
        description: '',
        quantity: 1,
        rateCents: 5000,
        totalCents: -5000,
      },
      {
        type: 'Insurance',
        description: 'Insurance (GL, AL, Cargo, TI) for August 24days',
        quantity: 1,
        rateCents: 4355,
        totalCents: -4355,
      },
    ],
    otherPay: [],
    summary: {
      earningsCents: 810546,
      advancesCents: 0,
      reimbursementsCents: 0,
      deductionsCents: -205116,
      otherPayCents: 0,
      netCents: 605430,
    },
    ytd: {
      earningsCents: 15482710,
      advancesCents: 0,
      reimbursementsCents: 0,
      deductionsCents: -8274719,
      otherPayCents: 160734,
      netCents: 7368725,
    },
  },
  {
    number: 'ST-005317',
    batch: 'SB-000438',
    company: 'Statement Date:',
    driver: 'JERRY ROBERT MCKANE',
    unitNumber: '2146',
    tariff: '30% from gross',
    percentBps: 3000,
    periodStart: Date.UTC(2026, 7, 16),
    periodEnd: Date.UTC(2026, 7, 22),
    statementDate: Date.UTC(2026, 7, 25),
    checkDate: Date.UTC(2026, 7, 27),
    loads: [
      {
        loadNumber: '1138JCPWX',
        puDate: Date.UTC(2026, 7, 16),
        delDate: Date.UTC(2026, 7, 16),
        grossCents: 13700,
        milesHundredths: 375,
        amountCents: 4110,
      },
      {
        loadNumber: '111W24PBB',
        puDate: Date.UTC(2026, 7, 16),
        delDate: Date.UTC(2026, 7, 16),
        grossCents: 19961,
        milesHundredths: 11892,
        amountCents: 5988,
      },
      {
        loadNumber: '111CMCWDL',
        puDate: Date.UTC(2026, 7, 16),
        delDate: Date.UTC(2026, 7, 16),
        grossCents: 112813,
        milesHundredths: 46585,
        amountCents: 33844,
      },
      {
        loadNumber: 'T-1141SGK6F',
        puDate: Date.UTC(2026, 7, 17),
        delDate: Date.UTC(2026, 7, 17),
        grossCents: 138225,
        milesHundredths: 45805,
        amountCents: 41468,
      },
      {
        loadNumber: '111PG8M2G',
        puDate: Date.UTC(2026, 7, 17),
        delDate: Date.UTC(2026, 7, 18),
        grossCents: 112201,
        milesHundredths: 35099,
        amountCents: 33660,
      },
      {
        loadNumber: 'T-112NRC7GV',
        puDate: Date.UTC(2026, 7, 18),
        delDate: Date.UTC(2026, 7, 18),
        grossCents: 69423,
        milesHundredths: 33809,
        amountCents: 20827,
      },
      {
        loadNumber: 'T-1165V8MJ9',
        puDate: Date.UTC(2026, 7, 20),
        delDate: Date.UTC(2026, 7, 20),
        grossCents: 211830,
        milesHundredths: 28014,
        amountCents: 63549,
      },
      {
        loadNumber: '116QB5J35',
        puDate: Date.UTC(2026, 7, 21),
        delDate: Date.UTC(2026, 7, 21),
        grossCents: 135377,
        milesHundredths: 51224,
        amountCents: 40613,
      },
      {
        loadNumber: 'T-1156TVBRF',
        puDate: Date.UTC(2026, 7, 21),
        delDate: Date.UTC(2026, 7, 22),
        grossCents: 201951,
        milesHundredths: 35868,
        amountCents: 60585,
      },
      {
        loadNumber: '111VS62GS',
        puDate: Date.UTC(2026, 7, 22),
        delDate: Date.UTC(2026, 7, 22),
        grossCents: 68434,
        milesHundredths: 34152,
        amountCents: 20530,
      },
    ],
    totals: {
      grossCents: 1083915,
      milesHundredths: 322823,
      amountCents: 325174,
    },
    deductions: [
      {
        type: 'Other',
        description: 'Charge for late Del Load#111VS62GS',
        quantity: 1,
        rateCents: 25000,
        totalCents: -25000,
      },
      {
        type: 'Escrow',
        description: 'Security Deposit $2500/$500',
        quantity: 1,
        rateCents: 25000,
        totalCents: -25000,
      },
    ],
    otherPay: [
      {
        type: 'Other',
        description: 'truck wash',
        quantity: 1,
        rateCents: 6270,
        totalCents: 6270,
      },
    ],
    summary: {
      earningsCents: 325174,
      advancesCents: 0,
      reimbursementsCents: 0,
      deductionsCents: -50000,
      otherPayCents: 6270,
      netCents: 281444,
    },
    ytd: {
      earningsCents: 2677033,
      advancesCents: 0,
      reimbursementsCents: 0,
      deductionsCents: -475000,
      otherPayCents: 161520,
      netCents: 2363553,
    },
  },
  {
    number: 'ST-005336',
    batch: 'SB-000439',
    company: 'Statement Date:',
    driver: 'Shodmon Muzaffarov',
    unitNumber: '8842',
    tariff: '32% from gross',
    percentBps: 3200,
    periodStart: Date.UTC(2026, 7, 23),
    periodEnd: Date.UTC(2026, 7, 29),
    statementDate: Date.UTC(2026, 8, 2),
    checkDate: Date.UTC(2026, 8, 4),
    loads: [
      {
        loadNumber: '2004394134',
        puDate: Date.UTC(2026, 7, 23),
        delDate: Date.UTC(2026, 7, 24),
        grossCents: 338250,
        milesHundredths: 108413,
        amountCents: 108240,
      },
      {
        loadNumber: '2004388420',
        puDate: Date.UTC(2026, 7, 24),
        delDate: Date.UTC(2026, 7, 24),
        grossCents: 150810,
        milesHundredths: 50348,
        amountCents: 48259,
      },
      {
        loadNumber: '2004368041',
        puDate: Date.UTC(2026, 7, 25),
        delDate: Date.UTC(2026, 7, 25),
        grossCents: 150810,
        milesHundredths: 44709,
        amountCents: 48259,
      },
      {
        loadNumber: '2004416373',
        puDate: Date.UTC(2026, 7, 25),
        delDate: Date.UTC(2026, 7, 26),
        grossCents: 157410,
        milesHundredths: 53656,
        amountCents: 50371,
      },
      {
        loadNumber: '2004427447',
        puDate: Date.UTC(2026, 7, 26),
        delDate: Date.UTC(2026, 7, 26),
        grossCents: 151800,
        milesHundredths: 52080,
        amountCents: 48576,
      },
    ],
    totals: {
      grossCents: 949080,
      milesHundredths: 309206,
      amountCents: 303705,
    },
    deductions: [],
    otherPay: [],
    summary: {
      earningsCents: 303705,
      advancesCents: 0,
      reimbursementsCents: 0,
      deductionsCents: 0,
      otherPayCents: 0,
      netCents: 303705,
    },
    ytd: {
      earningsCents: 13353266,
      advancesCents: 0,
      reimbursementsCents: 0,
      deductionsCents: -4348722,
      otherPayCents: 47250,
      netCents: 9051794,
    },
  },
  {
    number: 'ST-005352',
    batch: 'SB-000440',
    company: 'Statement Date:',
    driver: 'JERRY ROBERT MCKANE',
    unitNumber: '2146',
    tariff: '30% from gross',
    percentBps: 3000,
    periodStart: Date.UTC(2026, 7, 23),
    periodEnd: Date.UTC(2026, 7, 29),
    statementDate: Date.UTC(2026, 8, 2),
    checkDate: Date.UTC(2026, 8, 4),
    loads: [
      {
        loadNumber: '115NMPLX9',
        puDate: Date.UTC(2026, 7, 22),
        delDate: Date.UTC(2026, 7, 23),
        grossCents: 82130,
        milesHundredths: 34930,
        amountCents: 24639,
      },
      {
        loadNumber: 'T-115QBKD2K',
        puDate: Date.UTC(2026, 7, 23),
        delDate: Date.UTC(2026, 7, 23),
        grossCents: 98125,
        milesHundredths: 29503,
        amountCents: 29438,
      },
      {
        loadNumber: 'T-1169WGXF2',
        puDate: Date.UTC(2026, 7, 24),
        delDate: Date.UTC(2026, 7, 24),
        grossCents: 100000,
        milesHundredths: 27191,
        amountCents: 30000,
      },
      {
        loadNumber: '114GLR9MZ',
        puDate: Date.UTC(2026, 7, 24),
        delDate: Date.UTC(2026, 7, 25),
        grossCents: 96481,
        milesHundredths: 25974,
        amountCents: 28944,
      },
      {
        loadNumber: '113C4H9JY',
        puDate: Date.UTC(2026, 7, 25),
        delDate: Date.UTC(2026, 7, 25),
        grossCents: 78569,
        milesHundredths: 20729,
        amountCents: 23571,
      },
      {
        loadNumber: 'T-11424DY6N',
        puDate: Date.UTC(2026, 7, 29),
        delDate: Date.UTC(2026, 7, 29),
        grossCents: 100296,
        milesHundredths: 45748,
        amountCents: 30089,
      },
    ],
    totals: {
      grossCents: 555601,
      milesHundredths: 184075,
      amountCents: 166681,
    },
    deductions: [
      {
        type: 'Escrow',
        description: 'Security Deposit $2500/$250',
        quantity: 1,
        rateCents: 25000,
        totalCents: -25000,
      },
    ],
    otherPay: [],
    summary: {
      earningsCents: 166681,
      advancesCents: 0,
      reimbursementsCents: 0,
      deductionsCents: -25000,
      otherPayCents: 0,
      netCents: 141681,
    },
    ytd: {
      earningsCents: 2843714,
      advancesCents: 0,
      reimbursementsCents: 0,
      deductionsCents: -500000,
      otherPayCents: 161520,
      netCents: 2505234,
    },
  },
]

// ---------------------------------------------------------------------------
// THE SEVENTH, AND IT DOES NOT AGREE WITH THE BRIEF.
//
// `corpus/datatruck/Settlement  0292.pdf`, read the same way as the six above.
// It is ST-005395 — MCKANE, unit 2146, the week of 8/30 to 9/5.
//
// ── WHAT THE DOCUMENT SAYS ───────────────────────────────────────────────
//
// Item 8's acceptance says "ST-005395 still reproduces at 30% (every load
// delivered <= 9/3)". The statement in front of me does not: it carries SIX
// lines at TWO DIFFERENT RATES, under a header reading "20% from gross".
//
//   111D585DVR    DEL 9/3    $780.37  -> $234.11   30%
//   111PP4X5W     DEL 9/2  $1,171.94  -> $351.58   30%
//   113Y77KN3     DEL 9/2    $614.73  -> $122.95   20%
//   T-114QYL1J1   DEL 9/2  $1,054.59  -> $210.92   20%
//   T-116MDCJ5W   DEL 9/1  $2,845.45  -> $853.64   30%
//   1151MYQGT     DEL 8/30   $666.22  -> $199.87   30%
//
// THE SPLIT IS NOT BY DATE. Three loads delivered 9/2 and two of them paid
// 20% while the third paid 30%, so no rule keyed on the delivery date can
// produce this statement — and "a driver's own rule in force on the delivery
// date" is exactly what item 8 specifies. The 20% is also already running on
// 9/2, which is before the 2026-09-04 the rules are meant to take effect.
//
// The obvious reading is that the two 20% lines are the TEAM loads and this
// document is team driving already happening in Datatruck. That is a reading,
// not a fact, and it is the owner's to confirm — which is why this fixture is
// NOT in `DATATRUCK_STATEMENTS` above. Adding it there would either fail the
// reproduction or force a rate model nobody has ruled on.
//
// ── WHY IT IS TRANSCRIBED ANYWAY ─────────────────────────────────────────
//
// Because the artefact is the thing, and because it ties: the six line
// amounts sum to the printed $1,973.07, the grosses to $7,133.30, the mileage
// to 2,216.93 — and the year-to-date figures continue ST-005352 exactly
// ($28,437.14 + $1,973.07 = $30,410.21, and the same for net and deductions).
// A transcription that agreed with itself but not with the statement before it
// would be a transcription with a typo in it.
export const DATATRUCK_STATEMENT_ST005395: StatementFixture = {
  number: 'ST-005395',
  batch: 'SB-000442',
  company: 'RAM Haulage LLC',
  driver: 'JERRY ROBERT MCKANE',
  unitNumber: '2146',
  tariff: '20% from gross',
  // The HEADER's rate. Four of the six lines do not pay it.
  percentBps: 2000,
  periodStart: Date.UTC(2026, 7, 30),
  periodEnd: Date.UTC(2026, 8, 5),
  statementDate: Date.UTC(2026, 8, 8),
  checkDate: Date.UTC(2026, 8, 10),
  loads: [
    {
      loadNumber: '1151MYQGT',
      puDate: Date.UTC(2026, 7, 30),
      delDate: Date.UTC(2026, 7, 30),
      grossCents: 66622,
      milesHundredths: 19653,
      amountCents: 19987,
      percentBps: 3000,
    },
    {
      loadNumber: 'T-116MDCJ5W',
      puDate: Date.UTC(2026, 7, 31),
      delDate: Date.UTC(2026, 8, 1),
      grossCents: 284545,
      milesHundredths: 105897,
      amountCents: 85364,
      percentBps: 3000,
    },
    {
      loadNumber: 'T-114QYL1J1',
      puDate: Date.UTC(2026, 7, 25),
      delDate: Date.UTC(2026, 8, 2),
      grossCents: 105459,
      milesHundredths: 22577,
      amountCents: 21092,
      percentBps: 2000,
    },
    {
      loadNumber: '113Y77KN3',
      puDate: Date.UTC(2026, 8, 2),
      delDate: Date.UTC(2026, 8, 2),
      grossCents: 61473,
      milesHundredths: 8161,
      amountCents: 12295,
      percentBps: 2000,
    },
    {
      loadNumber: '111PP4X5W',
      puDate: Date.UTC(2026, 8, 2),
      delDate: Date.UTC(2026, 8, 2),
      grossCents: 117194,
      milesHundredths: 33137,
      amountCents: 35158,
      percentBps: 3000,
    },
    {
      loadNumber: '111D585DVR',
      puDate: Date.UTC(2026, 8, 3),
      delDate: Date.UTC(2026, 8, 3),
      grossCents: 78037,
      milesHundredths: 32268,
      amountCents: 23411,
      percentBps: 3000,
    },
  ],
  totals: {
    grossCents: 713330,
    milesHundredths: 221693,
    amountCents: 197307,
  },
  deductions: [
    {
      type: 'Loan',
      description: 'Cash Advance 09/14/2026',
      quantity: 1,
      rateCents: 20000,
      totalCents: -20000,
    },
    {
      type: 'Escrow',
      description: 'Security Deposit $2500/$2500',
      quantity: 1,
      rateCents: 25000,
      totalCents: -25000,
    },
  ],
  otherPay: [],
  summary: {
    earningsCents: 197307,
    advancesCents: 0,
    reimbursementsCents: 0,
    deductionsCents: -45000,
    otherPayCents: 0,
    netCents: 152307,
  },
  ytd: {
    earningsCents: 3041021,
    advancesCents: 0,
    reimbursementsCents: 0,
    deductionsCents: -545000,
    otherPayCents: 161520,
    netCents: 2657541,
  },
}
