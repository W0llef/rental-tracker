import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cacheKey } from '../../src/services/geocode/cache';
import { createGeocoder, GeocodeError } from '../../src/services/geocode';
import { nominatimUrl, readNominatim } from '../../src/services/geocode/nominatim';
import { photonUrl, readPhoton } from '../../src/services/geocode/photon';
import { rateLimit } from '../../src/services/geocode/rateLimit';
import { makeDb } from './helpers';

const json = (name: string) =>
  JSON.parse(readFileSync(resolve(__dirname, '../fixtures/geocode', name), 'utf8')) as unknown;

const respond = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('Photon', () => {
  it('asks for the metro, biased to downtown', () => {
    const u = new URL(photonUrl('201 S Example'));
    expect(u.origin + u.pathname).toBe('https://photon.komoot.io/api/');
    expect(u.searchParams.get('q')).toBe('201 S Example');
    expect(u.searchParams.get('bbox')).toBe('-94.1,44.55,-92.65,45.45');
    expect(u.searchParams.get('lat')).toBe('44.9778');
  });

  it('reads addresses, building names, streets and neighborhoods', () => {
    const places = readPhoton(json('photon-riverlight.json'));
    expect(places).toHaveLength(2); // the Canadian result is dropped
    expect(places[0]).toEqual({
      id: 'photon:W1001',
      name: 'Riverlight',
      address: {
        line1: '201 South Example Street',
        city: 'Minneapolis',
        state: 'MN',
        zip: '55401',
      },
      location: { lat: 44.9801, lng: -93.2601, source: 'photon', precision: 'address' },
      neighborhood: 'Downtown East',
    });
    expect(places[1]).toMatchObject({
      name: null,
      address: { line1: 'South Example Street' },
      location: { precision: 'street' },
    });
    expect(readPhoton(null)).toEqual([]);
  });
});

describe('Nominatim', () => {
  it('asks for one result inside the metro', () => {
    const u = new URL(nominatimUrl('1010 Nicollet Mall'));
    expect(u.searchParams.get('limit')).toBe('1');
    expect(u.searchParams.get('bounded')).toBe('1');
    expect(u.searchParams.get('viewbox')).toBe('-94.1,45.45,-92.65,44.55');
  });

  it('reads the first result', () => {
    expect(readNominatim(json('nominatim-1010.json'))).toEqual({
      id: 'nominatim:4242',
      name: null,
      address: { line1: '1010 Nicollet Mall', city: 'Minneapolis', state: 'MN', zip: '55403' },
      location: { lat: 44.9731, lng: -93.2752, source: 'nominatim', precision: 'address' },
      neighborhood: 'Downtown West',
    });
    expect(readNominatim([])).toBeNull();
  });
});

describe('geocoder', () => {
  it('caches suggestions, ignoring case and spacing', async () => {
    const db = makeDb();
    const fetchFn = vi.fn(() => respond(json('photon-riverlight.json')));
    const g = createGeocoder({ db, fetchFn: fetchFn as unknown as typeof fetch });
    expect(await g.suggest('ri')).toEqual([]); // too short: no request
    const a = await g.suggest('Riverlight');
    const b = await g.suggest('  riverlight ');
    expect(a).toHaveLength(2);
    expect(b).toEqual(a);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(await db.geocodeCache.get(cacheKey('photon', 'Riverlight'))).toBeTruthy();
  });

  it('forgets cached answers after 30 days', async () => {
    const db = makeDb();
    await db.geocodeCache.put({
      key: cacheKey('photon', 'riverlight'),
      at: '2020-01-01T00:00:00.000Z',
      value: [],
    });
    const fetchFn = vi.fn(() => respond(json('photon-riverlight.json')));
    const g = createGeocoder({ db, fetchFn: fetchFn as unknown as typeof fetch });
    expect(await g.suggest('riverlight')).toHaveLength(2);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('says so when offline or when the service fails', async () => {
    const db = makeDb();
    const offline = createGeocoder({
      db,
      fetchFn: vi.fn() as unknown as typeof fetch,
      online: () => false,
    });
    await expect(offline.suggest('Riverlight')).rejects.toBeInstanceOf(GeocodeError);
    await expect(offline.lookup('Riverlight')).rejects.toBeInstanceOf(GeocodeError);

    const failing = createGeocoder({
      db,
      fetchFn: (() => respond({}, 503)) as unknown as typeof fetch,
    });
    await expect(failing.suggest('Riverlight')).rejects.toThrow(/503/);
    const unreachable = createGeocoder({
      db,
      fetchFn: (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch,
    });
    await expect(unreachable.lookup('1010 Nicollet Mall')).rejects.toThrow(/could not be reached/);
  });

  it('looks an address up once and remembers it, even when nothing was found', async () => {
    const db = makeDb();
    const fetchFn = vi.fn((url: string) =>
      respond(url.includes('Nowhere') ? [] : json('nominatim-1010.json')),
    );
    const g = createGeocoder({ db, fetchFn: fetchFn as unknown as typeof fetch });
    expect((await g.lookup('1010 Nicollet Mall'))?.address.line1).toBe('1010 Nicollet Mall');
    expect(await g.lookup('1010 nicollet mall')).not.toBeNull();
    expect(await g.lookup('12 Nowhere Rd')).toBeNull();
    expect(await g.lookup('12 Nowhere Rd')).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe('rate limit', () => {
  it('spaces task starts and survives failures', async () => {
    vi.useFakeTimers();
    try {
      const starts: number[] = [];
      const schedule = rateLimit(1000, () => Date.now());
      const t0 = Date.now();
      const run = (fail = false) =>
        schedule(async () => {
          starts.push(Date.now() - t0);
          if (fail) throw new Error('x');
          return 1;
        });
      const a = run();
      const b = run(true).catch(() => 'failed');
      const c = run();
      await vi.runAllTimersAsync();
      expect(await a).toBe(1);
      expect(await b).toBe('failed');
      expect(await c).toBe(1);
      expect(starts).toEqual([0, 1000, 2000]);
    } finally {
      vi.useRealTimers();
    }
  });
});
