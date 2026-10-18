import { diffPaths, planRevert, stateAfter, valueText } from '../../src/domain/history';
import type { ChangeEntry } from '../../src/db/changeLog';
import {
  cleanReason,
  common,
  findReason,
  offeredReasons,
  toggledLabel,
} from '../../src/domain/triage';

describe('triage rules', () => {
  it('toggles a label only when every target already has it', () => {
    expect(toggledLabel(['red', 'red'], 'red')).toBeNull();
    expect(toggledLabel(['red', null], 'red')).toBe('red');
    expect(toggledLabel(['blue'], 'red')).toBe('red');
    expect(toggledLabel([], 'red')).toBe('red');
  });

  it('says "mixed" when values differ', () => {
    expect(common([1, 1])).toEqual({ mixed: false, value: 1 });
    expect(common([{ mode: 'included' }, { mode: 'included' }])).toMatchObject({ mixed: false });
    expect(common([null, 1])).toEqual({ mixed: true });
    expect(common([])).toEqual({ mixed: true });
  });

  it('cleans and matches reasons', () => {
    expect(cleanReason('  Too   noisy ')).toBe('Too noisy');
    expect(cleanReason('   ')).toBeNull();
    const reasons = [
      { id: 'a', label: 'Too far', archived: false },
      { id: 'b', label: 'Old', archived: true },
    ];
    expect(findReason(reasons, 'too FAR')?.id).toBe('a');
    expect(offeredReasons(reasons, []).map((r) => r.id)).toEqual(['a']);
    expect(offeredReasons(reasons, ['b']).map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('history helpers', () => {
  it('diffs nested objects key by key and arrays whole', () => {
    expect(
      diffPaths(
        { a: 1, u: { heat: null, electric: 1 }, list: [1, 2] },
        { a: 1, u: { heat: 2, electric: 1 }, list: [1, 3] },
      ),
    ).toEqual([['u', 'heat'], ['list']]);
  });

  it('puts the first later "before" of each record back', () => {
    const e = (seq: number, key: string, before: unknown): ChangeEntry => ({
      seq,
      key,
      before,
      after: null,
      table: 'units',
      actionId: String(seq),
      at: '',
      label: '',
      kind: 'do',
      target: null,
    });
    expect(stateAfter([e(5, 'x', { v: 2 }), e(3, 'x', { v: 1 }), e(4, 'y', null)])).toEqual([
      { table: 'units', key: 'x', value: { v: 1 } },
      { table: 'units', key: 'y', value: null },
    ]);
  });

  it('treats a record added by the action and changed since as a clash', () => {
    const plan = planRevert(
      [{ table: 'notes', key: 'n', before: null, after: { id: 'n', text: 'a' } }],
      new Map([['notes\u0000n', { id: 'n', text: 'b' }]]),
      'now',
    );
    expect(plan.safe).toEqual([]);
    expect(plan.all).toEqual([{ table: 'notes', key: 'n', value: null }]);
    expect(plan.clashes).toHaveLength(1);
  });

  it('writes values in a few words', () => {
    expect(valueText(null)).toBe('unknown');
    expect(valueText(true)).toBe('yes');
    expect(valueText([12, 15])).toBe('12, 15');
    expect(valueText('x'.repeat(60))).toHaveLength(40);
  });
});
