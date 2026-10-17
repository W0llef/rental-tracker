import type { AmenityKey, ISODate, UtilityKey, UtilityTerm } from '../model';
import { parseAddress } from './address';
import type { ParsedAddress } from './address';
import { money, shortDate, UTILITY_LABELS } from './format';

/**
 * Pasted listing text (PLAN.md §5.7, "Paste listing text"). Select all on a listing page,
 * copy, paste: this recognizes about 30 kinds of fact and returns them as `Fact`s for you to
 * confirm. Nothing is fetched. Pure.
 *
 * Rules that keep it honest:
 *  - The first mention wins: the top of a page is the listing; "similar homes" come later.
 *  - When the first mention of beds, baths, size or rent is a range ("Studio – 2 beds"), the
 *    page describes several units. Beds, baths and size are then left out; rent becomes
 *    "from" the low end.
 *  - "No …" before a feature makes it a no; features that aren't mentioned stay unknown.
 *  - Values outside sane limits (rent under $300, 40 bedrooms) are ignored.
 */

/** One recognized value. `field` is a path into the unit or building ("unit.rent"). */
export interface Fact {
  field: string;
  value: unknown;
  /** Chip text: "$1,650/mo", "Heat included". */
  label: string;
  /** Values set together with this one (e.g. "from" pricing with the rent). */
  also?: { field: string; value: unknown }[];
}

export interface ParsedText {
  facts: Fact[];
  /** An address found in the text (for Quick-add's address search). */
  address: ParsedAddress | null;
  /** Things worth telling you ("This page lists several units…"). */
  notes: string[];
}

// ── Text helpers ────────────────────────────────────────────────────────────

/** Unicode tidy-up so patterns can stay simple. */
export function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\u2007\u202f\t]/g, ' ')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/(\d)\s*\u00bd/g, '$1.5')
    .replace(/\u00bd/g, '.5')
    .replace(/[\u2022\u00b7|]/g, ' | ')
    .replace(/ {2,}/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n');
}

const MONEY = String.raw`\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?`;
const PER_MONTH = String.raw`(?:[ \t]*(?:\/\s?mo(?:nth)?\.?|per\s+month|a\s+month|monthly|\/\s?month))`;

const toNumber = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

interface Hit {
  m: RegExpExecArray;
  /** Position in the whole text, for "first mention wins". */
  at: number;
}

/** Every match of `re` (must be /g) with an optional guard on the text around it. */
function all(text: string, re: RegExp, guard?: (before: string, after: string) => boolean) {
  const out: Hit[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const before = text.slice(Math.max(0, m.index - 40), m.index).toLowerCase();
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 30).toLowerCase();
    if (!guard || guard(lineTail(before), lineHead(after))) out.push({ m, at: m.index });
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

const lineTail = (s: string) => s.slice(s.lastIndexOf('\n') + 1);
const lineHead = (s: string) => {
  const i = s.indexOf('\n');
  return i === -1 ? s : s.slice(0, i);
};

function first(text: string, re: RegExp, guard?: (before: string, after: string) => boolean) {
  return all(text, re, guard)[0] ?? null;
}

/** Tests a /g pattern without disturbing it. */
const matches = (re: RegExp, s: string) => new RegExp(re.source, re.flags.replace('g', '')).test(s);

/** The option whose pattern matched first in the text. */
function firstOption<T>(
  lower: string,
  options: [T, string, RegExp][],
  guard?: (b: string) => boolean,
) {
  const hit = earliest(
    ...options.map(([, , re]) => first(lower, re, guard ? (b) => guard(b) : undefined)),
  );
  return hit ? (options.find(([, , re]) => matches(re, hit.m[0])) ?? null) : null;
}

const earliest = (...hits: (Hit | null)[]) =>
  hits.filter((h): h is Hit => h !== null).sort((a, b) => a.at - b.at)[0] ?? null;

/** "no " (or "not ") right before a word. */
const negated = (before: string) => /\b(no|not|without|non)[\s-]*$/.test(before);

// ── Dates ───────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
] as const;

const pad = (n: number) => String(n).padStart(2, '0');

function isoDate(y: number, m: number, d: number): ISODate | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** A date with no year is the next one on or after a month ago. */
function withYear(m: number, d: number, today: ISODate): ISODate | null {
  const y = Number(today.slice(0, 4));
  const thisYear = isoDate(y, m, d);
  if (!thisYear) return null;
  const monthAgo = new Date(`${today}T00:00:00Z`);
  monthAgo.setUTCDate(monthAgo.getUTCDate() - 31);
  return thisYear < monthAgo.toISOString().slice(0, 10) ? isoDate(y + 1, m, d) : thisYear;
}

const DATE = String.raw`((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2})`;

export function parseDate(s: string, today: ISODate): ISODate | null {
  const t = s.toLowerCase().trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(t);
  if (m) {
    const [mo, d] = [Number(m[1]), Number(m[2])];
    if (!m[3]) return withYear(mo, d, today);
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return isoDate(y, mo, d);
  }
  m = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/.exec(t);
  if (m) {
    const mo = MONTH_NAMES.indexOf((m[1] ?? '').slice(0, 3) as (typeof MONTH_NAMES)[number]) + 1;
    if (mo === 0) return null;
    const d = Number(m[2]);
    return m[3] ? isoDate(Number(m[3]), mo, d) : withYear(mo, d, today);
  }
  return null;
}

// ── The parser ──────────────────────────────────────────────────────────────

const AMENITIES: [AmenityKey, string, RegExp][] = [
  [
    'fitness',
    'Fitness center',
    /\b(?:fitness (?:center|centre|room|studio)|gym|exercise room|workout room|24[- ]hour fitness)\b/gi,
  ],
  ['pool', 'Pool', /\b(?:swimming pool|pool(?! table)(?! tables)|pools)\b/gi],
  [
    'studyRooms',
    'Study or work rooms',
    /\b(?:study rooms?|co-?working(?: space| lounge)?|business center|conference rooms?|work-?from-?home (?:space|lounge))\b/gi,
  ],
  [
    'outdoorDeck',
    'Rooftop or outdoor deck',
    /\b(?:roof(?:top)? (?:deck|terrace|patio|lounge)|sun ?deck|outdoor (?:deck|terrace|courtyard)|amenity deck)\b/gi,
  ],
  [
    'packageRoom',
    'Package room',
    /\b(?:package (?:room|lockers?|receiving|concierge)|parcel lockers?|amazon hub|luxer one)\b/gi,
  ],
  [
    'bikeStorage',
    'Bike storage',
    /\b(?:bike (?:storage|room|racks?|lockers?)|bicycle (?:storage|room|racks?)|bike repair)\b/gi,
  ],
  [
    'evCharging',
    'EV charging',
    /\b(?:ev charging|electric (?:vehicle|car) charging|car charging stations?|ev stations?)\b/gi,
  ],
  ['guestSuites', 'Guest suite', /\bguest (?:suites?|apartments?)\b/gi],
  ['petArea', 'Pet area', /\b(?:dog (?:run|park)|pet (?:spa|wash|park|area|run))\b/gi],
  ['frontDesk', 'Front desk', /\b(?:front desk|concierge|doorman|door attendant)\b(?! service)/gi],
  ['skywayConnected', 'Skyway connected', /\bskyway\b/gi],
];

/** Words that make a line about something other than the unit's rent. */
const NOT_RENT =
  /\b(deposits?|fees?|pets?|parking|garage|storage|insurance|utilit\w*|application|admin\w*|special|save|off|credit|bonus|income|earn\w*|salary|mortgage|estimate|zestimate|sold|tax\w*|hoa)\b/;

const FEE_STOP = new Set([
  'includes',
  'include',
  'including',
  'and',
  'with',
  'the',
  'a',
  'an',
  'plus',
  'monthly',
  'required',
  'mandatory',
  'month',
]);

const RENT_LIMITS = [300, 20_000] as const;
const inRange = (n: number | null, lo: number, hi: number): n is number =>
  n !== null && n >= lo && n <= hi;

export function parseListingText(input: string, today: ISODate): ParsedText {
  const text = cleanText(input);
  const lower = text.toLowerCase();
  const facts: Fact[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  const add = (fact: Fact) => {
    if (seen.has(fact.field)) return;
    seen.add(fact.field);
    facts.push(fact);
  };

  // ── Address ────────────────────────────────────────────────────────────
  let address: ParsedAddress | null = null;
  for (const line of text.split('\n')) {
    if (line.length > 120 || !/^\d/.test(line)) continue;
    if (!/(\bmn\b|minnesota|\b5[45]\d{3}\b)/i.test(line)) continue;
    const p = parseAddress(line);
    if (
      p &&
      /[a-z]{2,}/i.test(p.line1.replace(/^\S+\s*/, '')) &&
      !/\b(bd|ba|beds?|baths?|sq)\b/i.test(p.line1)
    ) {
      address = p;
      break;
    }
  }

  // ── Rent ───────────────────────────────────────────────────────────────
  const rentGuard = (before: string, after: string) =>
    !NOT_RENT.test(before.slice(-30)) && !/^\s*(?:\S+\s+)?(deposit|fee|off|credit|pet)/.test(after);
  const range = first(
    lower,
    new RegExp(`${MONEY}\\s*(?:-|to)\\s*${MONEY}${PER_MONTH}?`, 'g'),
    rentGuard,
  );
  const from = first(
    lower,
    new RegExp(`(?:starting at|starts at|from|as low as)\\s*${MONEY}|${MONEY}\\s*\\+`, 'g'),
    (b, a) => rentGuard(b, a) && !/^\s*(?:sq|ft)/.test(a),
  );
  const monthly = first(lower, new RegExp(`${MONEY}${PER_MONTH}`, 'g'), rentGuard);
  const labeled = first(
    lower,
    new RegExp(`\\b(?:monthly rent|base rent|rent|price|asking)\\b\\s*:?\\s*${MONEY}`, 'g'),
    (b) => !/(pet|parking|storage)\s*$/.test(b),
  );
  const rentHit = earliest(range, from, monthly, labeled);
  if (rentHit) {
    // "Monthly rent $1,450 – $2,960": a labeled first price that starts a range.
    const after = lower.slice(
      rentHit.at + rentHit.m[0].length,
      rentHit.at + rentHit.m[0].length + 12,
    );
    const isFrom = rentHit === range || rentHit === from || /^[ \t]*(?:-|to)[ \t]*\$/.test(after);
    const n = toNumber(rentHit.m[1] ?? rentHit.m[2]);
    if (inRange(n, ...RENT_LIMITS)) {
      add({
        field: 'unit.rent',
        value: n,
        label: isFrom ? `from ${money(n)}/mo` : `${money(n)}/mo`,
        also: [{ field: 'unit.rentIsFrom', value: isFrom }],
      });
    }
  }

  // ── Beds, baths, size ──────────────────────────────────────────────────
  const BEDS = String.raw`(?:bd|bds|beds?|bedrooms?|br|bdrm|bdrms)\b`;
  const BED_SEP = String.raw`\s*(?:-|to|&|and|or|,|\/)\s*`;
  const bedRange = first(
    lower,
    new RegExp(
      String.raw`\b(?:studio|\d)(?:\s*${BEDS})?(?:${BED_SEP}(?:studio|\d)(?:\s*${BEDS})?)*${BED_SEP}\d\s*${BEDS}`,
      'g',
    ),
  );
  const bedOne = earliest(
    first(
      lower,
      new RegExp(String.raw`\b(\d{1,2})\s*${BEDS}`, 'g'),
      (b) => !/(-|to|&|and|or|,|\/)\s*$/.test(b),
    ),
    first(lower, /\bbed(?:room)?s?\s*:\s*(\d{1,2})\b/g),
    first(
      lower,
      /(?:^|\| |\bbeds?:?\s*)studio\b/gm,
      (b, a) =>
        !/(yoga|fitness|art|recording|music|dance|photo|pilates)\s*$/.test(b) &&
        !/^\s*(?:-|to|&|and|,\s*\d|apartments|apts)/.test(a),
    ),
  );
  let severalUnits = false;
  if (bedRange && (!bedOne || bedRange.at < bedOne.at)) severalUnits = true;
  else if (bedOne) {
    const raw = bedOne.m[1];
    const beds = raw === undefined ? 0 : Number(raw);
    if (beds <= 10)
      add({ field: 'unit.bedrooms', value: beds, label: beds === 0 ? 'Studio' : `${beds} bd` });
  }

  const BATHS = String.raw`(?:ba|bath|baths|bathrooms?|bthrm)\b`;
  const bathRange = first(
    lower,
    new RegExp(
      String.raw`\b(\d(?:\.\d)?)\s*(?:${BATHS})?\s*(?:-|to|or)\s*(\d(?:\.\d)?)\s*${BATHS}`,
      'g',
    ),
  );
  const bathOne = earliest(
    first(
      lower,
      new RegExp(String.raw`\b(\d(?:\.\d)?)\s*${BATHS}`, 'g'),
      (b) => !/(-|to)\s*$/.test(b),
    ),
    first(lower, /\bbath(?:room)?s?\s*:\s*(\d(?:\.\d)?)\b/g),
  );
  if (bathRange && (!bathOne || bathRange.at < bathOne.at)) severalUnits = true;
  else if (bathOne) {
    const baths = Math.round(Number(bathOne.m[1]) * 2) / 2;
    if (baths >= 0.5 && baths <= 10)
      add({ field: 'unit.bathrooms', value: baths, label: `${baths} ba` });
  }

  const SQFT = String.raw`(?:sq\.?\s*ft\.?|sqft|square\s*f(?:ee|oo)t|sf\b|ft²|ft2|sq\.?\s*feet)`;
  const sizeRange = first(
    lower,
    new RegExp(
      String.raw`\b(\d{1,2},?\d{3}|\d{3})\s*(?:-|to)\s*(\d{1,2},?\d{3}|\d{3})\s*${SQFT}`,
      'g',
    ),
  );
  const sizeOne = earliest(
    first(
      lower,
      new RegExp(String.raw`\b(\d{1,2},?\d{3}|\d{3})\s*${SQFT}`, 'g'),
      (b) => !/(-|to)\s*$/.test(b) && !/(lot|land|acre)/.test(b),
    ),
    first(lower, /\b(?:square feet|sq\.? ?ft\.?|size)\s*:\s*(\d{1,2},?\d{3}|\d{3})\b/g),
  );
  if (sizeRange && (!sizeOne || sizeRange.at < sizeOne.at)) severalUnits = true;
  else if (sizeOne) {
    const sq = toNumber(sizeOne.m[1]);
    if (inRange(sq, 150, 10_000))
      add({ field: 'unit.squareFeet', value: sq, label: `${sq.toLocaleString('en-US')} ft²` });
  }
  if (severalUnits)
    notes.push(
      'This page lists several units, so rent is “from” the lowest and the unit’s own details are left for you.',
    );
  /** Facts about one unit, skipped when the page lists several. */
  const addUnit = (fact: Fact) => {
    if (!severalUnits) add(fact);
  };

  // ── Unit, floor, floor plan ────────────────────────────────────────────
  const unitHit = first(
    text,
    /\b(?:unit|apt\.?|apartment)[ \t]*#?[ \t]*([a-z]?\d{1,5}[a-z]?)\b(?![ \t]*(?:of|bed|bd|ba|bath|sq|ft|units|floors?\b))/gi,
    (b) => !/(per|each|every|for|in|all)\s*$/.test(b),
  );
  const unitNumber = unitHit?.m[1]?.toUpperCase() ?? address?.unit ?? null;
  if (unitNumber)
    addUnit({ field: 'unit.unitNumber', value: unitNumber, label: `Unit ${unitNumber}` });

  const floorHit = earliest(
    first(lower, /\b(\d{1,2})(?:st|nd|rd|th)[- ]floor\b(?![- ]plan)/g),
    first(lower, /\bfloor\s*:\s*(\d{1,2})\b/g),
    first(lower, /\bfloor (\d{1,2})\b(?! of)(?![- ]?plan)/g, (b) => !/(top|ground)\s*$/.test(b)),
  );
  const floor = floorHit ? Number(floorHit.m[1]) : null;
  if (floor !== null && floor >= 1 && floor <= 80)
    addUnit({ field: 'unit.floor', value: floor, label: `Floor ${floor}` });

  const planHit = earliest(
    first(text, /\bfloor ?plan\s*:\s*([A-Z0-9][\w'’ -]{0,24}?)\s*$/gim),
    first(text, /\b[Pp]lan ([A-Z]\d?|\d{1,2}[A-Z]?)\b(?! of)/g),
  );
  if (planHit?.m[1]) {
    const name = planHit.m[1].trim();
    const plan = /^(plan|the)\b/i.test(name) || name.length > 3 ? name : `Plan ${name}`;
    addUnit({ field: 'unit.floorPlanName', value: plan, label: plan });
  }

  // ── Availability and lease ─────────────────────────────────────────────
  const nowHit = first(
    lower,
    /\b(?:available|availability|move[- ]in(?: date)?|date available)\s*:?\s*(?:now|immediately|today)\b/g,
  );
  const dateHit = first(
    lower,
    new RegExp(
      String.raw`\b(?:available|avail\.?|availability|move[- ]in(?: date)?|date available|available date)\s*:?\s*(?:on\s+|from\s+|starting\s+|beginning\s+)?${DATE}`,
      'g',
    ),
  );
  const avail = earliest(nowHit, dateHit);
  if (avail) {
    const date = avail === nowHit ? today : parseDate(avail.m[1] ?? '', today);
    if (date) {
      const label = date <= today ? 'Available now' : `Available ${shortDate(date, today)}`;
      addUnit({ field: 'unit.availableDate', value: date < today ? today : date, label });
    }
  }

  const leaseList = first(
    lower,
    /\blease (?:terms?|lengths?|options?|duration)\s*:?\s*([^\n]{1,60})/g,
  );
  const leasePhrase = first(
    lower,
    /\b((?:\d{1,2}[ \t]*(?:,|or|and|\/)[ \t]*)*\d{1,2})[- ]?(?:month|mo)s?\.?[- ]leases?\b/g,
  );
  const usable = (h: Hit | null) => (h?.m[1] && !/\d\s*(?:-|to)\s*\d/.test(h.m[1]) ? h : null);
  const leaseHit = earliest(usable(leaseList), usable(leasePhrase));
  let terms = leaseHit
    ? [...(leaseHit.m[1] ?? '').matchAll(/\b(\d{1,2})\b/g)].map((x) => Number(x[1]))
    : [];
  terms = [...new Set(terms.filter((n) => n >= 1 && n <= 36))].sort((a, b) => a - b);
  if (terms.length) {
    const list =
      terms.length === 1
        ? String(terms[0])
        : `${terms.slice(0, -1).join(', ')} or ${terms[terms.length - 1]}`;
    add({ field: 'unit.leaseTermsMonths', value: terms, label: `${list} month lease` });
  }

  // ── Deposit and fees ───────────────────────────────────────────────────
  const moneyFact = (field: string, label: string, hits: (Hit | null)[], max = 20_000) => {
    const hit = earliest(...hits);
    const n = toNumber(hit?.m[1]);
    if (hit && inRange(n, 0, max)) add({ field, value: n, label: `${label} ${money(n)}` });
  };
  moneyFact('unit.deposit', 'Deposit', [
    first(
      lower,
      new RegExp(String.raw`\b(?:security )?deposit\s*:?\s*(?:of\s*|from\s*)?${MONEY}`, 'g'),
      (b) => !/(pet|animal|parking|storage)\s*$/.test(b),
    ),
    first(lower, new RegExp(String.raw`${MONEY}[ \t]*(?:security[ \t]+)?deposit\b`, 'g')),
  ]);
  moneyFact(
    'unit.applicationFee',
    'Application fee',
    [
      first(lower, new RegExp(String.raw`\bapp(?:lication)?\.?\s+fee\s*:?\s*${MONEY}`, 'g')),
      first(
        lower,
        new RegExp(
          String.raw`${MONEY}[ \t]*(?:per (?:adult|applicant|person)[ \t]+)?app(?:lication)?\.?[ \t]+fee`,
          'g',
        ),
      ),
    ],
    500,
  );
  moneyFact(
    'unit.adminFee',
    'Admin fee',
    [
      first(
        lower,
        new RegExp(String.raw`\badmin(?:istration|istrative)?\.?\s+fee\s*:?\s*${MONEY}`, 'g'),
      ),
      first(
        lower,
        new RegExp(String.raw`${MONEY}[ \t]*admin(?:istration|istrative)?\.?[ \t]+fee`, 'g'),
      ),
    ],
    2_000,
  );

  const fees: { label: string; amount: number }[] = [];
  const feeRe = new RegExp(
    String.raw`\b([a-z/]+(?:[ \t]+[a-z/]+){0,2})[ \t]+fee[ \t]*:?[ \t]*${MONEY}${PER_MONTH}`,
    'g',
  );
  for (const hit of all(lower, feeRe)) {
    const label = (hit.m[1] ?? '')
      .split(/\s+/)
      .filter((w) => !FEE_STOP.has(w))
      .slice(-2)
      .join(' ');
    if (!label) continue;
    if (/(pet|parking|garage|storage|application|app|admin|deposit|late|one[- ]time)/.test(label))
      continue;
    const amount = toNumber(hit.m[2]);
    const name = `${label.charAt(0).toUpperCase()}${label.slice(1)} fee`;
    if (!inRange(amount, 1, 500) || fees.some((f) => f.label === name)) continue;
    fees.push({ label: name, amount });
  }
  if (fees.length) {
    add({
      field: 'unit.recurringFees',
      value: fees,
      label: `Monthly fees: ${fees.map((f) => `${f.label} ${money(f.amount)}`).join(', ')}`,
    });
  }

  const special = earliest(
    first(lower, /\b(\d+|one|two|three|four|six|eight)\s+(weeks?|months?)\s+(?:of\s+)?free\b/g),
    first(lower, new RegExp(String.raw`${MONEY}\s+off\b`, 'g')),
    first(lower, /\b(?:special|promo|promotion|concession)\s*:\s*\S/g),
  );
  if (special) {
    const lineStart = text.lastIndexOf('\n', special.at) + 1;
    const lineEnd = text.indexOf('\n', special.at);
    let line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();
    line = line.replace(/^(?:special|promo|promotion|concession)\s*:\s*/i, '');
    if (line.length > 120) line = `${line.slice(0, 117)}…`;
    const off = new RegExp(String.raw`${MONEY}\s+off`).exec(line.toLowerCase());
    add({
      field: 'unit.moveInSpecial',
      value: { text: line, valueUsd: off ? toNumber(off[1]) : null },
      label: `Special: ${line.length > 40 ? `${line.slice(0, 38)}…` : line}`,
    });
  }

  // ── In-unit features ───────────────────────────────────────────────────
  const has = (re: RegExp) => first(lower, re, (b) => !negated(b)) !== null;
  const hasNo = (re: RegExp) => first(lower, re) !== null;

  if (
    has(
      /\b(?:in[- ](?:unit|home) (?:laundry|washer|w\/d)|(?:washer\s*(?:\/|&|and)\s*dryer|w\/d)\s*(?:in[- ](?:unit|home|apartment)|in (?:every|each|the) (?:unit|home|apartment)|included)|laundry\s*:\s*in[- ]unit|full[- ]size washer)\b/g,
    ) ||
    has(/^(?:washer\s*(?:\/|&|and)\s*dryer|w\/d)$/gm)
  ) {
    add({ field: 'unit.laundry', value: 'in-unit', label: 'In-unit laundry' });
  } else if (
    has(
      /\b(?:laundry\s*:\s*(?:shared|in building|on[- ]site|common)|shared laundry|on[- ]site laundry|laundry (?:facilit(?:y|ies)|rooms?|on (?:each|every) floor|in (?:the )?building)|coin[- ]op(?:erated)? laundry)\b/g,
    )
  ) {
    add({ field: 'unit.laundry', value: 'in-building', label: 'Laundry in building' });
  } else if (hasNo(/\bno laundry\b|\blaundry\s*:\s*none\b/g)) {
    add({ field: 'unit.laundry', value: 'none', label: 'No laundry' });
  }

  const tri = (
    field: string,
    yes: string,
    no: string,
    re: RegExp,
    guard?: (b: string) => boolean,
  ) => {
    const hit = first(lower, re, guard ? (b) => guard(b) : undefined);
    if (!hit) return;
    const isNo = negated(lineTail(lower.slice(Math.max(0, hit.at - 20), hit.at)));
    add({ field, value: !isNo, label: isNo ? no : yes });
  };
  tri('unit.dishwasher', 'Dishwasher', 'No dishwasher', /\bdishwashers?\b/g);
  tri(
    'unit.balcony',
    'Balcony or patio',
    'No balcony',
    /\b(?:private )?(?:balcon(?:y|ies)|patios?|lanai)\b/g,
    (b) => !/(roof|rooftop|community|shared|outdoor|courtyard|amenity|juliet)\s*$/.test(b),
  );
  tri(
    'unit.fireplace',
    'Fireplace',
    'No fireplace',
    /\bfireplaces?\b/g,
    (b) => !/(outdoor|community|lobby|clubhouse|lounge)\s*$/.test(b),
  );

  const ac: [string, string, RegExp][] = [
    ['central', 'Central air', /\bcentral (?:air|a\/?c|air conditioning|cooling)\b/g],
    ['mini-split', 'Mini-split A/C', /\b(?:mini[- ]split|ductless)\b/g],
    ['window-unit', 'Window A/C', /\bwindow (?:a\/?c|air conditioners?|ac units?|units?)\b/g],
    [
      'wall-unit',
      'Wall A/C',
      /\b(?:wall (?:a\/?c|air conditioners?|units?)|through[- ]the[- ]wall a\/?c|ptac)\b/g,
    ],
    ['none', 'No A/C', /\bno (?:a\/?c|air conditioning)\b/g],
  ];
  const acPick = firstOption(lower, ac);
  if (acPick) add({ field: 'unit.acType', value: acPick[0], label: acPick[1] });

  const heat: [string, string, RegExp][] = [
    ['forced-air', 'Forced-air heat', /\bforced[- ]air\b/g],
    ['radiator', 'Radiator heat', /\b(?:radiators?|steam heat|hot[- ]water heat|boiler heat)\b/g],
    ['baseboard', 'Baseboard heat', /\bbaseboard(?: heat(?:ing|ers?)?)?\b/g],
    [
      'radiant-floor',
      'Radiant floor heat',
      /\b(?:radiant(?: floor)? heat(?:ing)?|heated floors?)\b/g,
    ],
    ['heat-pump', 'Heat pump', /\bheat pumps?\b/g],
  ];
  const heatPick = firstOption(lower, heat);
  if (heatPick) add({ field: 'unit.heatingType', value: heatPick[0], label: heatPick[1] });

  if (has(/\bpartially furnished|semi[- ]furnished\b/g))
    add({ field: 'unit.furnished', value: 'partial', label: 'Partly furnished' });
  else if (hasNo(/\bunfurnished\b|\bfurnished\s*:\s*no\b/g))
    add({ field: 'unit.furnished', value: 'no', label: 'Unfurnished' });
  else if (
    first(
      lower,
      /\b(?:fully )?furnished\b(?!\s*(?:options?|units?|apartments?|available|upon|on request))/g,
      (b) => !negated(b) && !/(un|optional(?:ly)?|can be)\s*$/.test(b),
    )
  )
    add({ field: 'unit.furnished', value: 'full', label: 'Furnished' });

  const typeHit = earliest(
    first(
      lower,
      /\b(apartment|condo|condominium|townhouse|townhome|house|single[- ]family(?: home)?)\s+for rent\b/g,
    ),
    first(
      lower,
      /\b(?:home|property|unit) type\s*:\s*(apartment|condo|condominium|townhouse|townhome|single[- ]family|house)\b/g,
    ),
  );
  if (typeHit?.m[1]) {
    const t = typeHit.m[1];
    const value = t.startsWith('condo')
      ? 'condo'
      : t.startsWith('town')
        ? 'townhome'
        : t.startsWith('apartment')
          ? 'apartment'
          : 'house';
    add({ field: 'unit.type', value, label: value.charAt(0).toUpperCase() + value.slice(1) });
  }

  // ── Parking and storage ────────────────────────────────────────────────
  const parkingType: [string, string, RegExp][] = [
    [
      'garage',
      'Garage parking',
      /\b(?:(?:garage|underground|heated|covered|indoor|ramp|structured)\s+parking|parking\s*:\s*(?:\w+\s+)?garage|(?:attached|detached|heated|underground|parking) garage)\b/g,
    ],
    [
      'surface',
      'Surface parking',
      /\b(?:(?:surface|off[- ]street|outdoor|uncovered)\s+parking|parking lot|parking\s*:\s*(?:surface|off[- ]street|lot))\b/g,
    ],
    ['street', 'Street parking', /\b(?:on[- ])?street parking\b|\bparking\s*:\s*street\b/g],
    ['none', 'No parking', /\bno parking\b/g],
  ];
  const pPick = firstOption(lower, parkingType, (b) => !/(guest|visitor)\s*$/.test(b));
  if (pPick) add({ field: 'unit.parking.type', value: pPick[0], label: pPick[1] });
  const pCost = earliest(
    first(
      lower,
      new RegExp(
        String.raw`\b(?:garages?|underground|parking|surface|stalls?)\b[^$\n]{0,30}${MONEY}`,
        'g',
      ),
      (b) => !/(guest|bike)\s*$/.test(b),
    ),
    first(
      lower,
      new RegExp(
        String.raw`${MONEY}${PER_MONTH}?[ \t]*(?:for[ \t]+)?(?:a[ \t]+)?(?:garage[ \t]+|underground[ \t]+|reserved[ \t]+)?(?:parking|stall)\b`,
        'g',
      ),
    ),
  );
  const pAmount = toNumber(pCost?.m[1]);
  if (pCost && inRange(pAmount, 0, 1000) && !/included|free/.test(pCost.m[0])) {
    add({
      field: 'unit.parking.extraSpaceCost',
      value: pAmount,
      label: `Parking ${money(pAmount)}/mo`,
    });
  }
  const pIncl = first(
    lower,
    /\b(?:parking (?:is )?included|(\d|one|two) (?:parking )?(?:spaces?|stalls?) included|includes? (?:\w+ )?parking|free parking)\b/g,
    (b) => !negated(b),
  );
  if (pIncl) {
    const n = pIncl.m[1] === 'two' || pIncl.m[1] === '2' ? 2 : 1;
    add({
      field: 'unit.parking.spacesIncluded',
      value: n,
      label: `${n} parking space${n === 1 ? '' : 's'} included`,
    });
  }

  const sCost = first(
    lower,
    new RegExp(
      String.raw`\b(?:storage|storage units?|storage lockers?)\b[^$\n]{0,25}${MONEY}`,
      'g',
    ),
    (b) => !/(bike|bicycle|package)\s*$/.test(b),
  );
  const sAmount = toNumber(sCost?.m[1]);
  if (sCost && inRange(sAmount, 0, 500)) {
    add({ field: 'unit.storage.cost', value: sAmount, label: `Storage ${money(sAmount)}/mo` });
    add({ field: 'unit.storage.included', value: false, label: 'Storage extra' });
  } else if (
    first(
      lower,
      /\b(?:storage(?: unit| locker)? (?:is )?included|includes? (?:a )?storage)\b/g,
      (b) => !negated(b) && !/(bike|bicycle)\s*$/.test(b),
    )
  ) {
    add({ field: 'unit.storage.included', value: true, label: 'Storage included' });
  }

  // ── Utilities ──────────────────────────────────────────────────────────
  for (const [key, term] of readUtilities(lower)) {
    const name = UTILITY_LABELS[key];
    const label =
      term.mode === 'included'
        ? `${name} included`
        : term.mode === 'extra'
          ? term.amount === null
            ? `${name} billed extra`
            : `${name} billed ${money(term.amount)}/mo`
          : `${name}: you pay`;
    add({ field: `unit.utilities.${key}`, value: term, label });
  }

  // ── Pets ───────────────────────────────────────────────────────────────
  if (hasNo(/\bno pets\b|\bpets?\s*(?::\s*)?not allowed\b|\bpets\s*:\s*no\b/g)) {
    add({ field: 'building.pets.cats', value: false, label: 'No cats' });
    add({ field: 'building.pets.dogs', value: false, label: 'No dogs' });
  }
  const petYes = (animal: string) =>
    new RegExp(
      String.raw`\b(?:${animal}s?\s*(?:are\s+)?(?::\s*)?(?:allowed|ok|okay|welcome|friendly|accepted|yes)|${animal}[- ]friendly)\b`,
      'g',
    );
  const petNo = (animal: string) =>
    new RegExp(String.raw`\b(?:no ${animal}s?|${animal}s?\s*(?::\s*)?(?:not allowed|no))\b`, 'g');
  for (const [animal, field] of [
    ['cat', 'cats'],
    ['dog', 'dogs'],
  ] as const) {
    const Name = animal === 'cat' ? 'Cats' : 'Dogs';
    if (first(lower, petNo(animal)))
      add({ field: `building.pets.${field}`, value: false, label: `No ${field}` });
    else if (first(lower, petYes(animal), (b) => !negated(b)))
      add({ field: `building.pets.${field}`, value: true, label: `${Name} OK` });
  }
  if (
    first(
      lower,
      /\b(?:pets?\s*(?::\s*)?(?:allowed|ok|welcome|friendly|yes)|pet[- ]friendly|cats and dogs (?:allowed|ok|welcome)|dogs and cats (?:allowed|ok|welcome))\b/g,
      (b) => !negated(b),
    )
  ) {
    add({ field: 'building.pets.cats', value: true, label: 'Cats OK' });
    add({ field: 'building.pets.dogs', value: true, label: 'Dogs OK' });
  }
  moneyFact(
    'building.pets.monthlyRent',
    'Pet rent',
    [
      first(
        lower,
        new RegExp(
          String.raw`\b(?:monthly )?pet (?:rent|fee\s*(?=:?\s*\$[\d,]+${PER_MONTH}))\s*:?\s*${MONEY}`,
          'g',
        ),
      ),
      first(lower, new RegExp(String.raw`${MONEY}${PER_MONTH}?[ \t]*pet rent`, 'g')),
    ],
    300,
  );
  moneyFact(
    'building.pets.deposit',
    'Pet deposit',
    [
      first(lower, new RegExp(String.raw`\bpet deposit\s*:?\s*${MONEY}`, 'g')),
      first(lower, new RegExp(String.raw`${MONEY}[ \t]*(?:refundable )?pet deposit`, 'g')),
    ],
    3_000,
  );
  moneyFact(
    'building.pets.oneTimeFee',
    'Pet fee',
    [
      first(
        lower,
        new RegExp(
          String.raw`\b(?:one[- ]time |non[- ]?refundable )?pet fee\s*:?\s*${MONEY}(?![\d,.])(?!${PER_MONTH})`,
          'g',
        ),
      ),
      first(
        lower,
        new RegExp(String.raw`${MONEY}[ \t]*(?:one[- ]time |non[- ]?refundable )pet fee`, 'g'),
      ),
    ],
    3_000,
  );

  // ── Building ───────────────────────────────────────────────────────────
  for (const [key, label, re] of AMENITIES) {
    const hit = first(lower, re);
    if (!hit) continue;
    const isNo = negated(lineTail(lower.slice(Math.max(0, hit.at - 20), hit.at)));
    add({
      field: `building.amenities.${key}`,
      value: !isNo,
      label: isNo ? `No ${label.toLowerCase()}` : label,
    });
  }

  const year = first(
    lower,
    /\b(?:built in|year built\s*:?|built\s*:|constructed in|completed in|built)\s*(1[89]\d\d|20\d\d)\b/g,
  );
  const y = year ? Number(year.m[1]) : null;
  if (y && y >= 1850 && y <= Number(today.slice(0, 4)) + 2)
    add({ field: 'building.yearBuilt', value: y, label: `Built ${y}` });

  const stories = earliest(
    first(lower, /\b(\d{1,2})[- ](?:story|stories|storey|storeys)\b/g),
    first(lower, /\b(?:stories|floors in building|building floors)\s*:\s*(\d{1,2})\b/g),
    first(lower, /\b(\d{1,2}) floors\b/g),
  );
  const nFloors = stories ? Number(stories.m[1]) : null;
  if (nFloors && nFloors >= 1 && nFloors <= 80)
    add({ field: 'building.floors', value: nFloors, label: `${nFloors} floors` });

  const smoking: ['not-allowed' | 'designated-areas' | 'allowed', string, RegExp][] = [
    [
      'not-allowed',
      'No smoking',
      /\b(?:no smoking|non[- ]smoking|smoke[- ]free|smoking\s*:\s*(?:no|not allowed)|smoking (?:is )?not (?:allowed|permitted))\b/g,
    ],
    [
      'designated-areas',
      'Smoking in designated areas',
      /\bdesignated smoking (?:areas?|zones?)\b/g,
    ],
    [
      'allowed',
      'Smoking allowed',
      /\bsmoking (?:is )?(?:allowed|permitted)\b|\bsmoking\s*:\s*yes\b/g,
    ],
  ];
  const smokePick = firstOption(lower, smoking, (b) => !negated(b));
  if (smokePick) add({ field: 'building.smoking', value: smokePick[0], label: smokePick[1] });

  if (hasNo(/\bno elevators?\b|\bwalk[- ]up\b/g))
    add({ field: 'building.elevator', value: false, label: 'No elevator' });
  else if (has(/\belevators?\b/g))
    add({ field: 'building.elevator', value: true, label: 'Elevator' });

  return { facts, address, notes };
}

// ── Utilities ───────────────────────────────────────────────────────────────

const UTILITY_WORDS: [UtilityKey, RegExp][] = [
  ['heat', /\bheat(?:ing)?\b(?!\s*pump)(?!ed)/],
  [
    'electric',
    /\belectric(?:ity)?\b(?!\s*(?:vehicle|car|fireplace|stove|range|oven|cooktop|charging))/,
  ],
  ['waterSewer', /\b(?:water|sewer|sewage)\b(?!\s*(?:heater|front|view|softener))/],
  ['trash', /\b(?:trash|garbage|refuse|recycling)\b/],
  ['gas', /\bgas\b(?!\s*(?:stove|range|fireplace|grills?|cooktop|oven))/],
  ['internet', /\b(?:internet|wi-?fi|broadband)\b/],
];

const INCLUDED =
  /\b(included|includes|including|paid by (?:owner|landlord|management)|landlord pays|owner pays|no charge)\b|:\s*(?:landlord|owner|management)\s*$/;
const TENANT =
  /\b(not included|excluded|tenants? pays?|residents? pays?|renters? pays?|you pay|paid by (?:tenant|resident|renter)|tenant[- ]paid|resident[- ]paid|responsible for|separately metered|individually metered)\b|:\s*(?:tenants?|residents?|renters?)\s*$/;

/** Which utilities a listing says are included, billed, or yours to pay. First mention wins. */
export function readUtilities(lower: string): [UtilityKey, UtilityTerm][] {
  const out = new Map<UtilityKey, UtilityTerm>();
  const set = (k: UtilityKey, t: UtilityTerm) => {
    if (!out.has(k)) out.set(k, t);
  };
  // A heading followed by a list: "Utilities included" / "Water" / "Trash removal".
  const lines = lower.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i] ?? '';
    const mode =
      /^(?:utilities included|included utilities|utilities included in rent)\s*:?\s*$/.test(head)
        ? 'included'
        : /^(?:tenant[- ]paid utilities|utilities (?:not included|paid by (?:tenant|resident)))\s*:?\s*$/.test(
              head,
            )
          ? 'tenant'
          : null;
    if (!mode) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const item = lines[j] ?? '';
      if (!item || item.length > 30) break;
      const keys = UTILITY_WORDS.filter(([, re]) => re.test(item)).map(([k]) => k);
      if (!keys.length) break;
      keys.forEach((k) =>
        set(
          k,
          mode === 'included' ? { mode: 'included' } : { mode: 'tenant-paid', estimate: null },
        ),
      );
    }
  }
  // Clauses: lines and sentences; a clause that says both "included" and "not included" is
  // split further at commas and "but".
  const clauses = lower
    .split(/\n|(?<!\d)\.(?!\d)|;/)
    .flatMap((c) => (INCLUDED.test(c) && TENANT.test(c) ? c.split(/,|\bbut\b|\bwhile\b/) : [c]));
  for (const clause of clauses) {
    if (/\ball utilities (?:are )?(?:included|paid)\b/.test(clause) && !/not/.test(clause)) {
      (['heat', 'electric', 'waterSewer', 'trash', 'gas'] as const).forEach((k) =>
        set(k, { mode: 'included' }),
      );
      continue;
    }
    const keys = UTILITY_WORDS.filter(([, re]) => re.test(clause)).map(([k]) => k);
    if (!keys.length) continue;
    const tenant = TENANT.test(clause);
    const incl = !tenant && INCLUDED.test(clause);
    const fee = new RegExp(`${MONEY}${PER_MONTH}`).exec(clause);
    if (incl) keys.forEach((k) => set(k, { mode: 'included' }));
    else if (tenant) keys.forEach((k) => set(k, { mode: 'tenant-paid', estimate: null }));
    else if (fee && /\b(?:fee|billed|flat|charge)\b|^\s*[a-z/ &,]+:\s*\$/.test(clause)) {
      const amount = toNumber(fee[1]);
      if (amount !== null && amount <= 500) keys.forEach((k) => set(k, { mode: 'extra', amount }));
    } else if (/^\s*(?:utilities|[a-z/ &]+)\s*:\s*(?:yes|paid)\s*$/.test(clause)) {
      keys.forEach((k) => set(k, { mode: 'included' }));
    }
  }
  return [...out.entries()];
}
