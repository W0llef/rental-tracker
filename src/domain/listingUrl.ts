import type { SiteKey } from '../model';
import { cityDisplay, METRO_CITIES } from './address';

/**
 * Listing links (PLAN.md §5.1, "Listing URL field"). No page is ever fetched: the site is
 * recognized from the domain, and where the link itself spells out an address or a
 * building name (Zillow `homedetails/…`, Apartments.com slugs, …) that becomes a hint for
 * the address search. `canonicalUrl` is what exact-duplicate checks compare. Pure.
 */

export interface UrlHints {
  /** Text to put in the address search: "1234 Example Ave S, Minneapolis, MN 55401". */
  addressQuery: string | null;
  /** A building or complex name read from the link: "The Larch". */
  name: string | null;
  unitNumber: string | null;
}

export interface ParsedListingUrl {
  /** The link as it will be saved (https added if missing). */
  url: string;
  site: SiteKey;
  /** Lowercase host without "www.", path without a trailing slash, no tracking parameters. */
  canonical: string;
  hints: UrlHints;
}

const SITES: [RegExp, SiteKey][] = [
  [/(^|\.)zillow\.com$/, 'zillow'],
  [/(^|\.)apartments\.com$/, 'apartments-com'],
  [/(^|\.)hotpads\.com$/, 'hotpads'],
  [/(^|\.)trulia\.com$/, 'trulia'],
  [/(^|\.)craigslist\.org$/, 'craigslist'],
  [/(^|\.)(facebook\.com|fb\.com)$/, 'facebook'],
  [/(^|\.)rent\.com$/, 'rent-com'],
  [/(^|\.)padmapper\.com$/, 'padmapper'],
];

/**
 * Listing sites with no key of their own. Any other domain is taken to be the building's
 * (or its manager's) own website.
 */
const OTHER_LISTING_SITES =
  /(^|\.)(apartmentlist|zumper|realtor|redfin|rentals|forrent|apartmentguide|apartmentfinder|rentcafe|rentable|homes|move|rentler|avail|turbotenant|cozy|streeteasy|craigslist)\.(com|org|net)$/;

export const SITE_FROM_HOST = (host: string): SiteKey => {
  const h = host.toLowerCase().replace(/^www\./, '');
  for (const [re, key] of SITES) if (re.test(h)) return key;
  if (OTHER_LISTING_SITES.test(h)) return 'other';
  return 'building-site';
};

const TRACKING =
  /^(utm_.*|fbclid|gclid|msclkid|mc_[a-z]+|ref|ref_src|referrer|source|src|cid|_ga)$/i;

/** Reads a pasted link. Returns null when it isn't a web address. */
export function parseListingUrl(raw: string): ParsedListingUrl | null {
  const text = raw.trim();
  if (!text || /\s/.test(text)) return null;
  // Another kind of link (mailto:, tel:) or an email address
  if (/^(?!https?:)[a-z][a-z0-9+.-]*:(?!\d)/i.test(text) || /^[^/]*@/.test(text)) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (!u.hostname.includes('.')) return null;

  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const site = SITE_FROM_HOST(host);
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : '';
  const path = decodeSafe(u.pathname).replace(/\/+$/, '');
  return {
    url: u.toString(),
    site,
    canonical: `${host}${path}${query}`.toLowerCase(),
    hints: hintsFor(site, path),
  };
}

/** Exact-duplicate key for a stored listing URL (null when it can't be read). */
export function canonicalUrl(url: string | null): string | null {
  return url ? (parseListingUrl(url)?.canonical ?? null) : null;
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const NONE: UrlHints = { addressQuery: null, name: null, unitNumber: null };

/** Words that end a slug and aren't part of a name: ids, "apartments", the city and state. */
const NOISE = new Set(['apartments', 'apartment', 'apts', 'for', 'rent', 'rentals', 'homes']);

const titleWord = (w: string) =>
  /^\d/.test(w) || /^(n|s|e|w|ne|nw|se|sw)$/i.test(w)
    ? w.toUpperCase()
    : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

/**
 * "1234-example-ave-s-apt-1504-minneapolis-mn-55401" → address, unit and city.
 * "the-larch-minneapolis-mn" → name "The Larch", city Minneapolis.
 */
export function readSlug(slug: string): UrlHints & { city: string | null } {
  let ws = slug.toLowerCase().replace(/_/g, '-').split('-').filter(Boolean);
  let zip: string | null = null;
  // Trailing ids: "55401", "5xjkhx", "sx3k9p", "2084173445"
  while (ws.length) {
    const last = ws[ws.length - 1] as string;
    if (/^\d{5}$/.test(last) && !zip) {
      zip = last;
      ws.pop();
    } else if (/^(?=.*\d)[a-z0-9]{6,}$/.test(last) || /^\d{6,}$/.test(last)) {
      ws.pop();
    } else break;
  }
  let state = false;
  if (ws[ws.length - 1] === 'mn') {
    state = true;
    ws.pop();
  }
  let city: string | null = null;
  if (state || zip) {
    const joined = ws.join(' ');
    const found = METRO_CITIES.find((c) => joined.endsWith(` ${c}`) || joined === c);
    if (found) {
      city = cityDisplay(found);
      ws = ws.slice(0, ws.length - found.split(' ').length);
    } else if (ws.length > 1) {
      // An unlisted city: take the last word.
      city = cityDisplay(ws.pop() as string);
    }
  }
  while (ws.length && NOISE.has(ws[ws.length - 1] as string)) ws.pop();
  if (!ws.length) return { ...NONE, city };

  if (/^\d+[a-z]?$/.test(ws[0] as string) && ws.length >= 2) {
    // An address. A unit designator splits off the unit.
    let unitNumber: string | null = null;
    const ui = ws.findIndex((w, i) => i > 1 && /^(apt|unit|ste|suite|#)$/.test(w));
    if (ui > 0 && ws[ui + 1]) {
      unitNumber = (ws[ui + 1] as string).toUpperCase();
      ws = ws.slice(0, ui);
    }
    const line1 = ws.map(titleWord).join(' ');
    const tail = [city, [state || city ? 'MN' : null, zip].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', ');
    return { addressQuery: tail ? `${line1}, ${tail}` : line1, name: null, unitNumber, city };
  }
  const name = ws.map((w) => (/^(at|of|on|the|and)$/.test(w) ? w : titleWord(w))).join(' ');
  return {
    addressQuery: null,
    name: name.charAt(0).toUpperCase() + name.slice(1),
    unitNumber: null,
    city,
  };
}

function hintsFor(site: SiteKey, path: string): UrlHints {
  const segs = path.split('/').filter(Boolean);
  const pick = (h: UrlHints & { city: string | null }): UrlHints => ({
    addressQuery: h.addressQuery ?? (h.name && h.city ? `${h.name}, ${h.city}` : null),
    name: h.name,
    unitNumber: h.unitNumber,
  });
  switch (site) {
    case 'zillow': {
      // /homedetails/<address-slug>/<id>_zpid/ · /apartments/<city-st>/<name>/<id>/ · /b/<name-city-st-id>/
      if (segs[0] === 'homedetails' && segs[1]) return pick(readSlug(segs[1]));
      if (segs[0] === 'apartments' && segs[2]) {
        const city = segs[1] ? readSlug(segs[1]).city : null;
        const h = readSlug(segs[2]);
        return pick({ ...h, city: h.city ?? city });
      }
      if (segs[0] === 'b' && segs[1]) return pick(readSlug(segs[1]));
      return NONE;
    }
    case 'apartments-com':
      // /<name-or-address>-<city>-mn/<id>/
      return segs[0] ? pick(readSlug(segs[0])) : NONE;
    case 'hotpads':
      // /<slug>-<city>-mn-<zip>-<id>/pad
      return segs[0] ? pick(readSlug(segs[0])) : NONE;
    case 'trulia': {
      // /p/mn/<city>/<address-slug>--<id> · /building/<name-…>
      if (segs[0] === 'p' && segs[3]) return pick(readSlug(segs[3].split('--')[0] ?? ''));
      if (segs[0] === 'building' && segs[1]) return pick(readSlug(segs[1]));
      return NONE;
    }
    case 'rent-com': {
      // /minnesota/<city>-apartments/<name>-<id>
      const city = segs[1]?.replace(/-apartments$/, '');
      if (segs[2]) {
        const h = readSlug(segs[2]);
        return pick({ ...h, city: h.city ?? (city ? cityDisplay(city.replace(/-/g, ' ')) : null) });
      }
      return NONE;
    }
    default:
      return NONE;
  }
}
