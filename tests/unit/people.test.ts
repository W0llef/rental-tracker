import { othersSummary, ratingsSummary, resolveMe, starRange } from '../../src/domain/people';
import type { PersonOpinion } from '../../src/domain/people';
import type { Flag, Rating } from '../../src/model';
import { emptyOpinionFields, newPerson } from '../../src/model/factories';

const row = (name: string, rating: Rating, flag: Flag = 'none', isMe = false): PersonOpinion => ({
  person: newPerson({ name }),
  isMe,
  record: null,
  opinion: { ...emptyOpinionFields(), rating, flag },
});

describe('others on a card', () => {
  it('summarizes everyone else in one chip: who, star range, picks and rejects', () => {
    const s = othersSummary([
      row('Jordan', 5, 'pick', true), // you: never part of "others"
      row('Alex', 2, 'reject'),
      row('Sam', 4),
      row('Kim', 0, 'pick'),
      row('Lee', 0), // said nothing: left out
    ])!;
    expect(s.rows.map((r) => r.person.name)).toEqual(['Alex', 'Sam', 'Kim']);
    expect(starRange(s)).toBe('★2–4');
    expect([s.picks, s.rejects]).toEqual([1, 1]);
    expect(ratingsSummary(s.rows)).toBe(
      'Alex: 2 of 5 stars, reject; Sam: 4 of 5 stars; Kim: not rated, pick',
    );
  });

  it('shows a single rating as is, and nothing when nobody else said anything', () => {
    expect(starRange(othersSummary([row('Alex', 3)])!)).toBe('★3');
    expect(starRange(othersSummary([row('Alex', 0, 'pick')])!)).toBeNull();
    expect(othersSummary([row('Me', 4, 'none', true), row('Alex', 0)])).toBeNull();
  });
});

describe('who is me after a restore', () => {
  const people = [
    { id: 'a', deletedAt: null },
    { id: 'b', deletedAt: null },
    { id: 'gone', deletedAt: '2026-10-18T00:00:00.000Z' },
  ];
  it('prefers you, then the file’s maker, then its only person', () => {
    expect(resolveMe(people, 'a', 'b')).toBe('a');
    expect(resolveMe(people, 'x', 'b')).toBe('b');
    expect(resolveMe(people, 'x', 'gone')).toBeNull();
    expect(resolveMe([{ id: 'solo', deletedAt: null }], 'x', null)).toBe('solo');
  });
});
