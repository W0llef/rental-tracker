import { canonicalUrl, parseListingUrl, readSlug } from '../../src/domain/listingUrl';

describe('listing links', () => {
  it('recognizes sites from the domain', () => {
    const site = (u: string) => parseListingUrl(u)?.site;
    expect(site('https://www.zillow.com/homedetails/x/1_zpid/')).toBe('zillow');
    expect(site('apartments.com/the-larch-minneapolis-mn/abc123/')).toBe('apartments-com');
    expect(site('https://hotpads.com/x/pad')).toBe('hotpads');
    expect(site('https://www.trulia.com/p/mn/minneapolis/x')).toBe('trulia');
    expect(site('https://minneapolis.craigslist.org/hnp/apa/d/x/7712345678.html')).toBe(
      'craigslist',
    );
    expect(site('https://www.facebook.com/marketplace/item/123/')).toBe('facebook');
    expect(site('https://www.rent.com/minnesota/minneapolis-apartments/x-4-100')).toBe('rent-com');
    expect(site('https://www.padmapper.com/buildings/p1/x')).toBe('padmapper');
    expect(site('https://www.zumper.com/apartment-buildings/p1/x')).toBe('other');
    expect(site('https://www.riverlightapts.com/floorplans')).toBe('building-site');
  });

  it('refuses text that is not a web address', () => {
    expect(parseListingUrl('')).toBeNull();
    expect(parseListingUrl('201 S Example St')).toBeNull();
    expect(parseListingUrl('riverlight')).toBeNull();
    expect(parseListingUrl('mailto:x@example.com')).toBeNull();
  });

  it('adds https when missing', () => {
    expect(parseListingUrl('zillow.com/homedetails/x/1_zpid')?.url).toBe(
      'https://zillow.com/homedetails/x/1_zpid',
    );
  });

  it('compares links without tracking parameters, www, case or a trailing slash', () => {
    const a = canonicalUrl(
      'https://www.zillow.com/homedetails/1234-Example-Ave/1_zpid/?utm_source=x',
    );
    const b = canonicalUrl('http://zillow.com/homedetails/1234-example-ave/1_zpid');
    expect(a).toBe(b);
    expect(canonicalUrl('https://example.com/unit?id=2&utm_medium=y')).toBe(
      'example.com/unit?id=2',
    );
    expect(canonicalUrl('https://example.com/unit?id=2')).not.toBe(
      canonicalUrl('https://example.com/unit?id=3'),
    );
    expect(canonicalUrl(null)).toBeNull();
  });

  it('reads the address and unit from a Zillow home link', () => {
    const p = parseListingUrl(
      'https://www.zillow.com/homedetails/1234-Example-Ave-S-APT-1504-Minneapolis-MN-55401/2084173445_zpid/',
    );
    expect(p?.hints).toEqual({
      addressQuery: '1234 Example Ave S, Minneapolis, MN 55401',
      name: null,
      unitNumber: '1504',
    });
  });

  it('reads a building name from Zillow and Apartments.com links', () => {
    expect(
      parseListingUrl('https://www.zillow.com/apartments/minneapolis-mn/riverlight/5XjKHx/')?.hints,
    ).toEqual({
      addressQuery: 'Riverlight, Minneapolis',
      name: 'Riverlight',
      unitNumber: null,
    });
    expect(
      parseListingUrl('https://www.apartments.com/the-larch-minneapolis-mn/abc1234/')?.hints,
    ).toEqual({
      addressQuery: 'The Larch, Minneapolis',
      name: 'The Larch',
      unitNumber: null,
    });
    expect(
      parseListingUrl('https://www.apartments.com/cedar-mill-apartments-st-louis-park-mn/x9y8z7w/')
        ?.hints.name,
    ).toBe('Cedar Mill');
  });

  it('reads an address from an Apartments.com and a HotPads link', () => {
    expect(
      parseListingUrl('https://www.apartments.com/1010-nicollet-mall-minneapolis-mn/q2w3e4r/')
        ?.hints.addressQuery,
    ).toBe('1010 Nicollet Mall, Minneapolis, MN');
    expect(
      parseListingUrl('https://hotpads.com/3520-example-ave-s-minneapolis-mn-55406-sx3k9p/pad')
        ?.hints.addressQuery,
    ).toBe('3520 Example Ave S, Minneapolis, MN 55406');
  });

  it('gives no hints for links that carry none', () => {
    expect(parseListingUrl('https://www.facebook.com/marketplace/item/123/')?.hints).toEqual({
      addressQuery: null,
      name: null,
      unitNumber: null,
    });
    expect(
      parseListingUrl('https://www.riverlightapts.com/floorplans/c')?.hints.addressQuery,
    ).toBeNull();
  });

  it('reads slugs', () => {
    expect(readSlug('the-larch-minneapolis-mn')).toMatchObject({
      name: 'The Larch',
      city: 'Minneapolis',
    });
    expect(readSlug('riverlight')).toMatchObject({ name: 'Riverlight', city: null });
  });
});
