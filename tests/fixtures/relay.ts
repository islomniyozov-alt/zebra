// ---------------------------------------------------------------------------
// THE HEADER IS REAL; THE DATA IS NOT.
//
// `corpus-amazon/` is gitignored — it holds trips somebody actually ran, with
// their driver's name on them — so nothing from it can be committed as a
// fixture. The COLUMN NAMES are Amazon's own and carry no freight, so the
// header below is transcribed byte for byte from the real export and every
// value under it is invented.
//
// TRANSCRIBED INCLUDING THE DOUBLE SPACE in `Stop 1  Planned Departure Date`.
// That typo is in the shipped export, on every stop's two departure columns
// and nowhere else, and a fixture that tidied it up would be a fixture that
// passes against a parser which cannot read the real file.
//
// Shared by the parser's own tests and by the integration suite, so there is
// one statement of what a Relay row looks like rather than two that drift.
// ---------------------------------------------------------------------------

export const RELAY_HEADER =
  'Block ID,Trip ID,Block/Trip,Trip Stage,Load ID,Facility Sequence,' +
  'Load Execution Status,Transit Operator Type,Driver Name,Equipment Type,' +
  'Trailer ID,Tractor Vehicle ID,Estimate Distance,Unit,Rate Type,' +
  'Estimated Cost,Currency,Truck Filter,Operator ID,Shipper Account,' +
  'Sub Carrier,CR_ID,Port Appointment Date,Port Appointment Time,' +
  'Port Pin Code,Spot Work,Contract Type,Contract ID,Domicile/Route,' +
  'Stop 1,Stop 1 UTC Offset,Stop 1 Planned Arrival Date,' +
  'Stop 1 Planned Arrival Time,Stop 1 Actual Check-In Date,' +
  'Stop 1 Actual Check-In Time,Stop 1  Planned Departure Date,' +
  'Stop 1  Planned Departure Time,Stop 1 Actual Departure Date,' +
  'Stop 1 Actual Departure Time,Stop 1 Container ID,' +
  'Stop 1 Earliest Permissible Arrival,Stop 1 Actual Geofence Arrival,' +
  'Stop 1 Actual Check-in Date/Time,' +
  'Stop 2,Stop 2 UTC Offset,Stop 2 Planned Arrival Date,' +
  'Stop 2 Planned Arrival Time,Stop 2 Actual Check-In Date,' +
  'Stop 2 Actual Check-In Time,Stop 2  Planned Departure Date,' +
  'Stop 2  Planned Departure Time,Stop 2 Actual Departure Date,' +
  'Stop 2 Actual Departure Time,Stop 2 Container ID,' +
  'Stop 2 Earliest Permissible Arrival,Stop 2 Actual Geofence Arrival,' +
  'Stop 2 Actual Check-in Date/Time'

/** One data row, in the real column order. Everything is a fabrication. */
export function relayRow(
  overrides: Partial<Record<string, string>> = {},
): string {
  const cells: Record<string, string> = {
    tripId: 'T-TESTTRIP1',
    stage: 'Completed',
    loadId: 'TESTLOAD1',
    sequence: 'AAA1->BBB2',
    execution: 'Completed',
    driver: 'A Driver',
    equipment: "53' Trailer",
    trailer: 'TRL1',
    tractor: 'TRC1',
    distance: '241.60',
    unit: 'mi',
    cost: '477.89',
    // stop 1
    s1: 'AAA1',
    s1offset: '-6',
    s1planArrDate: '08/11/2026',
    s1planArrTime: '23:30',
    s1actArrDate: '08/11/2026',
    s1actArrTime: '22:16',
    s1planDepDate: '08/12/2026',
    s1planDepTime: '00:01',
    s1actDepDate: '08/11/2026',
    s1actDepTime: '22:40',
    s1container: '',
    // stop 2
    s2: 'BBB2',
    s2offset: '-5',
    s2planArrDate: '08/12/2026',
    s2planArrTime: '06:31',
    s2actArrDate: '08/12/2026',
    s2actArrTime: '06:02',
    s2planDepDate: '08/12/2026',
    s2planDepTime: '07:02',
    s2actDepDate: '08/12/2026',
    s2actDepTime: '07:15',
    s2container: '',
    ...overrides,
  }

  return [
    '', // Block ID — empty in every real row
    cells['tripId'],
    'Trip',
    cells['stage'],
    cells['loadId'],
    cells['sequence'],
    cells['execution'],
    'Single Driver',
    cells['driver'],
    cells['equipment'],
    cells['trailer'],
    cells['tractor'],
    cells['distance'],
    cells['unit'],
    'PER_LOAD',
    cells['cost'],
    'USD',
    '',
    '',
    'TransfersInitialPlacement',
    'AZNU',
    '',
    '',
    '',
    '',
    'Yes',
    '',
    '',
    '',
    cells['s1'],
    cells['s1offset'],
    cells['s1planArrDate'],
    cells['s1planArrTime'],
    cells['s1actArrDate'],
    cells['s1actArrTime'],
    cells['s1planDepDate'],
    cells['s1planDepTime'],
    cells['s1actDepDate'],
    cells['s1actDepTime'],
    cells['s1container'],
    '',
    '',
    '',
    cells['s2'],
    cells['s2offset'],
    cells['s2planArrDate'],
    cells['s2planArrTime'],
    cells['s2actArrDate'],
    cells['s2actArrTime'],
    cells['s2planDepDate'],
    cells['s2planDepTime'],
    cells['s2actDepDate'],
    cells['s2actDepTime'],
    cells['s2container'],
    '',
    '',
    '',
  ].join(',')
}
