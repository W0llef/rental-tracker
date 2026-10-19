import { useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { DIRECTION_NAMES, enumLabel, leaseTermsLabel, money } from '../../domain/format';
import { numText, parseMoney, parseUrl, parseWhole } from '../../domain/input';
import { parseMonths } from '../../domain/triage';
import { DIRECTIONS, WINDOW_SIZES } from '../../model';
import type { Direction, Link, RecurringFee, Unit, UtilityTerm, WindowSpec } from '../../model';
import { newId } from '../../model/factories';
import { FieldRow, Segmented } from './fields';
import type { Option } from './fields';
import { useFormApi } from './formState';
import styles from './edit.module.css';

/** The form's editors for lists and structured values (DESIGN.md §4.3). */

const modified = (e: KeyboardEvent) => e.metaKey || e.ctrlKey || e.altKey;

/** A money box inside a list row: keeps what's typed while it can't be read. */
function MoneyCell({
  path,
  label,
  value,
  onChange,
  required,
}: {
  path: string;
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  required?: boolean;
}) {
  const form = useFormApi();
  const [text, setText] = useState(numText(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(numText(value));
  }
  const error = form.errors.get(path);
  return (
    <span className={styles.numWrap}>
      <span className={styles.affix} aria-hidden="true">
        $
      </span>
      <input
        className={styles.input}
        inputMode="decimal"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        value={text}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          const read = parseMoney(t);
          if (!read.ok) form.setError(path, `${label}: ${read.error}`);
          else if (required && read.value === null)
            form.setError(path, `${label}: enter an amount.`);
          else {
            form.setError(path, null);
            setSeen(read.value);
            onChange(read.value);
          }
        }}
      />
    </span>
  );
}

/** Errors reported by list rows, shown once under the list. */
function RowErrors({ prefix }: { prefix: string }) {
  const form = useFormApi();
  const mine = [...form.errors].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v);
  if (!mine.length) return null;
  return (
    <div className={styles.below}>
      {mine.map((m) => (
        <p key={m} className={styles.error} role="alert">
          {m}
        </p>
      ))}
    </div>
  );
}

/** Clears every error a list's removed row had reported. */
function useClearErrors() {
  const form = useFormApi();
  return (prefix: string) => {
    for (const k of form.errors.keys()) if (k.startsWith(prefix)) form.setError(k, null);
  };
}

// ── Exposure ───────────────────────────────────────────────────────────────

/**
 * Which way the unit faces (Q3): a list, the first one main. Buttons in compass order;
 * pressing one adds it (or takes it out); the main direction can be changed when there are
 * several. ← → move between directions, Space or ⏎ toggles, `?` is unknown.
 */
export function ExposureField({
  path,
  value,
  onChange,
  fromWindows,
  notApplicable,
}: {
  path: string;
  value: Direction[] | null;
  onChange: (v: Direction[] | null) => void;
  fromWindows: Direction[];
  notApplicable?: string;
}) {
  const labelId = useId();
  const form = useFormApi();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusAt, setFocusAt] = useState(0);
  const list = value ?? [];
  const unknown = (from?: Element) => {
    onChange(null);
    form.setMarked(path, true);
    if (from) form.nextEmpty(from);
  };
  const toggle = (d: Direction) => {
    const next = list.includes(d) ? list.filter((x) => x !== d) : [...list, d];
    onChange(next.length ? next : null);
    if (next.length) form.setMarked(path, false);
  };
  const missingFromWindows = fromWindows.filter((d) => !list.includes(d));
  return (
    <FieldRow
      path={path}
      label="Exposure"
      empty={value === null}
      labelId={labelId}
      notApplicable={notApplicable}
      onUnknown={() => unknown()}
      hint={
        list.length > 0 ? (
          <>
            Faces {list.map((d) => DIRECTION_NAMES[d]).join(', ')}; main:{' '}
            {DIRECTION_NAMES[list[0]!]}.
          </>
        ) : (
          'Press each direction the unit’s windows face; the first is the main one.'
        )
      }
    >
      <div className={styles.compassRow}>
        <div className={styles.directions} role="group" aria-labelledby={labelId}>
          {DIRECTIONS.map((d, i) => (
            <button
              key={d}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              className={styles.direction}
              aria-pressed={list.includes(d)}
              aria-label={`${DIRECTION_NAMES[d]}${list[0] === d ? ' (main)' : ''}`}
              tabIndex={i === focusAt ? 0 : -1}
              data-main={list[0] === d || undefined}
              onFocus={() => setFocusAt(i)}
              onClick={() => toggle(d)}
              onKeyDown={(e) => {
                if (modified(e)) return;
                const move = (to: number) => {
                  e.preventDefault();
                  const at = (to + DIRECTIONS.length) % DIRECTIONS.length;
                  setFocusAt(at);
                  refs.current[at]?.focus();
                };
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(i + 1);
                else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(i - 1);
                else if (e.key === '?') {
                  e.preventDefault();
                  unknown(e.currentTarget);
                }
              }}
            >
              {d}
            </button>
          ))}
        </div>
        {list.length > 1 && (
          <label className={styles.inline}>
            Main
            <select
              className={styles.select}
              value={list[0]}
              onChange={(e) => {
                const main = e.target.value as Direction;
                onChange([main, ...list.filter((x) => x !== main)]);
              }}
            >
              {list.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        )}
        {missingFromWindows.length > 0 && (
          <button
            type="button"
            className={styles.textButton}
            onClick={() => {
              onChange([...list, ...missingFromWindows]);
              form.setMarked(path, false);
            }}
          >
            Add the windows’ directions ({missingFromWindows.join(', ')})
          </button>
        )}
      </div>
    </FieldRow>
  );
}

// ── Windows ────────────────────────────────────────────────────────────────

const SIZE_OPTIONS = WINDOW_SIZES.map((s) => ({ value: s, label: enumLabel(s) }));

/** One row per window or window wall: room, direction, size, what's in front of it. */
export function WindowsEditor({
  path,
  value,
  onChange,
  notApplicable,
}: {
  path: string;
  value: WindowSpec[] | null;
  onChange: (v: WindowSpec[] | null) => void;
  notApplicable?: string;
}) {
  const labelId = useId();
  const form = useFormApi();
  const list = value ?? [];
  const set = (id: string, patch: Partial<WindowSpec>) =>
    onChange(list.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  const add = () => {
    const w: WindowSpec = {
      id: newId(),
      room: null,
      direction: null,
      size: null,
      obstruction: null,
    };
    onChange([...list, w]);
    form.setMarked(path, false);
    // Focus the new row's room box once it's drawn.
    requestAnimationFrame(() =>
      document.querySelector<HTMLInputElement>(`[data-window="${w.id}"] input`)?.focus(),
    );
  };
  return (
    <FieldRow
      path={path}
      label="Windows"
      empty={value === null}
      labelId={labelId}
      notApplicable={notApplicable}
      onUnknown={() => {
        onChange(null);
        form.setMarked(path, true);
      }}
      wide
      hint="A window wall counts as one. Obstruction: what’s in front of it, like “building across the street, ~60 ft”."
    >
      <div className={styles.listEditor}>
        {list.length > 0 && (
          <table className={styles.table} aria-labelledby={labelId}>
            <thead>
              <tr>
                <th scope="col">Room</th>
                <th scope="col">Direction</th>
                <th scope="col">Size</th>
                <th scope="col">Obstruction</th>
                <th scope="col">
                  <span className={styles.visuallyHidden}>Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((w, i) => (
                <tr key={w.id} data-window={w.id}>
                  <td>
                    <input
                      className={styles.input}
                      aria-label={`Window ${i + 1} room`}
                      value={w.room ?? ''}
                      placeholder="Living"
                      onChange={(e) => set(w.id, { room: e.target.value || null })}
                    />
                  </td>
                  <td>
                    <select
                      className={styles.select}
                      aria-label={`Window ${i + 1} direction`}
                      value={w.direction ?? ''}
                      onChange={(e) =>
                        set(w.id, { direction: (e.target.value || null) as Direction | null })
                      }
                    >
                      <option value="">?</option>
                      {DIRECTIONS.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className={styles.select}
                      aria-label={`Window ${i + 1} size`}
                      value={w.size ?? ''}
                      onChange={(e) =>
                        set(w.id, { size: (e.target.value || null) as WindowSpec['size'] })
                      }
                    >
                      <option value="">?</option>
                      {SIZE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className={styles.input}
                      aria-label={`Window ${i + 1} obstruction`}
                      value={w.obstruction ?? ''}
                      placeholder="None"
                      onChange={(e) => set(w.id, { obstruction: e.target.value || null })}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className={styles.removeBtn}
                      aria-label={`Remove window ${i + 1}`}
                      onClick={() => {
                        const next = list.filter((x) => x.id !== w.id);
                        onChange(next.length ? next : null);
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <button type="button" className={styles.addBtn} onClick={add}>
          + Add window
        </button>
      </div>
    </FieldRow>
  );
}

// ── Utilities ──────────────────────────────────────────────────────────────

type Mode = UtilityTerm['mode'];

const UTILITY_MODES: readonly Option<Mode>[] = [
  { value: 'included', label: 'Included' },
  { value: 'extra', label: 'Extra $' },
  { value: 'tenant-paid', label: 'You pay' },
];

/**
 * Who pays for one utility (DESIGN.md §4.3): Included · Extra $ (a flat fee from the
 * landlord) · You pay (your estimate; blank uses your cost profile). I, E and Y choose.
 */
export function UtilityField({
  path,
  label,
  value,
  onChange,
  profileEstimate,
}: {
  path: string;
  label: string;
  value: UtilityTerm | null;
  onChange: (v: UtilityTerm | null) => void;
  /** What your cost profile assumes for this unit, shown as the estimate's placeholder. */
  profileEstimate: number | null;
}) {
  const labelId = useId();
  const form = useFormApi();
  const unknown = (from?: Element) => {
    onChange(null);
    form.setMarked(path, true);
    form.setError(path, null);
    if (from) form.nextEmpty(from);
  };
  const amount =
    value?.mode === 'extra' ? value.amount : value?.mode === 'tenant-paid' ? value.estimate : null;
  return (
    <FieldRow
      path={path}
      label={label}
      empty={value === null}
      labelId={labelId}
      onUnknown={() => unknown()}
    >
      <div className={styles.utility}>
        <Segmented
          label={label}
          labelId={labelId}
          value={value?.mode ?? null}
          options={UTILITY_MODES}
          keys={{ i: 'included', e: 'extra', y: 'tenant-paid' }}
          onQuestion={(from) => unknown(from)}
          onChange={(mode) => {
            form.setMarked(path, false);
            if (mode === 'included') onChange({ mode });
            else if (mode === 'extra') onChange({ mode, amount });
            else onChange({ mode, estimate: amount });
          }}
        />
        {value && value.mode !== 'included' && (
          <MoneyCell
            path={path}
            label={
              value.mode === 'extra' ? `${label} fee per month` : `${label} estimate per month`
            }
            value={amount}
            onChange={(n) =>
              onChange(
                value.mode === 'extra'
                  ? { mode: 'extra', amount: n }
                  : { mode: 'tenant-paid', estimate: n },
              )
            }
          />
        )}
        {value?.mode === 'tenant-paid' && value.estimate === null && profileEstimate !== null && (
          <span className={styles.hintInline}>
            Your cost profile: about {money(profileEstimate)}/mo
          </span>
        )}
      </div>
    </FieldRow>
  );
}

// ── Monthly fees ───────────────────────────────────────────────────────────

/** Amenity fee, tech fee, pet rent…: none, unknown, or a list (Q5). */
export function FeesEditor({
  path,
  value,
  onChange,
}: {
  path: string;
  value: RecurringFee[] | null;
  onChange: (v: RecurringFee[] | null) => void;
}) {
  const labelId = useId();
  const form = useFormApi();
  const clearErrors = useClearErrors();
  const list = value ?? [];
  const add = () => {
    const f = { id: newId(), label: '', amount: 0 };
    onChange([...list, f]);
    form.setMarked(path, false);
    requestAnimationFrame(() =>
      document.querySelector<HTMLInputElement>(`[data-fee="${f.id}"] input`)?.focus(),
    );
  };
  return (
    <FieldRow
      path={path}
      label="Monthly fees"
      empty={value === null}
      labelId={labelId}
      wide
      onUnknown={() => {
        onChange(null);
        form.setMarked(path, true);
      }}
      hint={
        value === null
          ? 'Fees charged every month besides rent: amenity, tech, trash…'
          : value.length === 0
            ? 'No monthly fees besides rent.'
            : undefined
      }
    >
      <div className={styles.listEditor} aria-labelledby={labelId} role="group">
        {list.map((f, i) => (
          <div key={f.id} className={styles.listRow} data-fee={f.id}>
            <input
              className={styles.input}
              aria-label={`Fee ${i + 1} name`}
              placeholder="Amenity fee"
              value={f.label}
              onChange={(e) =>
                onChange(list.map((x) => (x.id === f.id ? { ...x, label: e.target.value } : x)))
              }
            />
            <MoneyCell
              path={`${path}.${f.id}`}
              label={`Fee ${i + 1} amount`}
              value={f.amount}
              required
              onChange={(n) =>
                onChange(list.map((x) => (x.id === f.id ? { ...x, amount: n ?? 0 } : x)))
              }
            />
            <span className={styles.per}>/mo</span>
            <button
              type="button"
              className={styles.removeBtn}
              aria-label={`Remove fee ${i + 1}`}
              onClick={() => {
                clearErrors(`${path}.${f.id}`);
                onChange(list.filter((x) => x.id !== f.id));
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <div className={styles.listActions}>
          <button type="button" className={styles.addBtn} onClick={add}>
            + Add a fee
          </button>
          {value === null && (
            <button
              type="button"
              className={styles.addBtn}
              onClick={() => {
                onChange([]);
                form.setMarked(path, false);
              }}
            >
              No monthly fees
            </button>
          )}
        </div>
        <RowErrors prefix={`${path}.`} />
      </div>
    </FieldRow>
  );
}

// ── Rent by lease length ───────────────────────────────────────────────────

interface TermRow {
  key: string;
  months: string;
  rent: number | null;
}

/** When the rent depends on the lease length ("12 months $1,650, 15 months $1,600"). */
export function RentByTermEditor({
  path,
  value,
  onChange,
}: {
  path: string;
  value: Unit['rentByTerm'];
  onChange: (v: Unit['rentByTerm']) => void;
}) {
  const labelId = useId();
  const form = useFormApi();
  const [rows, setRows] = useState<TermRow[]>(() =>
    (value ?? []).map((t) => ({ key: newId(), months: String(t.months), rent: t.rent })),
  );
  /** Keeps the rows, checks them and passes the complete ones up. */
  const update = (next: TermRow[]) => {
    setRows(next);
    for (const k of form.errors.keys()) if (k.startsWith(`${path}.`)) form.setError(k, null);
    const out: { months: number; rent: number }[] = [];
    next.forEach((r, i) => {
      const m = parseWhole(r.months, { min: 1, max: 60, what: 'months' });
      if (!m.ok || m.value === null)
        form.setError(
          `${path}.${r.key}.months`,
          `Lease length ${i + 1}: enter months from 1 to 60.`,
        );
      else if (r.rent === null)
        form.setError(`${path}.${r.key}.rent`, `Lease length ${i + 1}: enter its rent.`);
      else out.push({ months: m.value, rent: r.rent });
    });
    onChange(out.length ? out : null);
  };
  return (
    <FieldRow
      path={path}
      label="Rent by lease length"
      empty={false}
      labelId={labelId}
      noUnknown
      wide
      hint="Only when the listing gives a different rent for different lease lengths."
    >
      <div className={styles.listEditor} role="group" aria-labelledby={labelId}>
        {rows.map((r, i) => (
          <div key={r.key} className={styles.listRow} data-term={r.key}>
            <span className={styles.numWrap}>
              <input
                className={styles.input}
                inputMode="numeric"
                aria-label={`Lease length ${i + 1} in months`}
                value={r.months}
                onChange={(e) =>
                  update(rows.map((x) => (x.key === r.key ? { ...x, months: e.target.value } : x)))
                }
              />
              <span className={styles.affix} aria-hidden="true">
                months
              </span>
            </span>
            <span className={styles.numWrap}>
              <span className={styles.affix} aria-hidden="true">
                $
              </span>
              <input
                className={styles.input}
                inputMode="decimal"
                aria-label={`Rent on lease length ${i + 1}`}
                defaultValue={numText(r.rent)}
                onChange={(e) => {
                  const m = parseMoney(e.target.value);
                  update(
                    rows.map((x) => (x.key === r.key ? { ...x, rent: m.ok ? m.value : null } : x)),
                  );
                }}
              />
            </span>
            <button
              type="button"
              className={styles.removeBtn}
              aria-label={`Remove lease length ${i + 1}`}
              onClick={() => update(rows.filter((x) => x.key !== r.key))}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          className={styles.addBtn}
          onClick={() => {
            const key = newId();
            update([...rows, { key, months: '', rent: null }]);
            requestAnimationFrame(() =>
              document.querySelector<HTMLInputElement>(`[data-term="${key}"] input`)?.focus(),
            );
          }}
        >
          + Add a lease length
        </button>
        <RowErrors prefix={`${path}.`} />
      </div>
    </FieldRow>
  );
}

// ── Lease terms ────────────────────────────────────────────────────────────

/** "12, 15" → [12, 15]; "none"; `?` unknown. */
export function LeaseTermsField({
  path,
  value,
  onChange,
}: {
  path: string;
  value: number[] | null;
  onChange: (v: number[] | null) => void;
}) {
  const id = useId();
  const form = useFormApi();
  const [text, setText] = useState(value ? (value.length ? value.join(', ') : 'none') : '');
  const [seen, setSeen] = useState(value);
  if (JSON.stringify(seen) !== JSON.stringify(value)) {
    setSeen(value);
    setText(value ? (value.length ? value.join(', ') : 'none') : '');
  }
  const marked = form.marked.has(path);
  return (
    <FieldRow
      path={path}
      label="Lease terms"
      empty={value === null && text.trim() === ''}
      controlId={id}
      onUnknown={() => {
        setText('');
        onChange(null);
        form.setError(path, null);
        form.setMarked(path, true);
      }}
      hint={
        value ? `Reads as: ${leaseTermsLabel(value)}` : 'Months offered, like “12, 15”, or “none”.'
      }
    >
      <input
        id={id}
        className={styles.input}
        value={text}
        autoComplete="off"
        placeholder={value === null && marked ? 'Unknown' : '12, 15'}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          if (!t.trim()) {
            form.setError(path, null);
            setSeen(null);
            onChange(null);
            return;
          }
          const months = parseMonths(t);
          if (months === undefined) form.setError(path, 'Enter months like “12, 15”, or “none”.');
          else {
            form.setError(path, null);
            setSeen(months);
            onChange(months);
            form.setMarked(path, false);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === '?' && !modified(e) && !text.trim()) {
            e.preventDefault();
            onChange(null);
            form.setMarked(path, true);
            form.nextEmpty(e.currentTarget);
          }
        }}
      />
    </FieldRow>
  );
}

// ── Move-in special ────────────────────────────────────────────────────────

export function SpecialField({
  path,
  value,
  onChange,
}: {
  path: string;
  value: Unit['moveInSpecial'];
  onChange: (v: Unit['moveInSpecial']) => void;
}) {
  const id = useId();
  return (
    <FieldRow
      path={path}
      label="Move-in special"
      empty={false}
      controlId={id}
      noUnknown
      wide
      hint="Like “6 weeks free on a 13-month lease”. Its value counts in M9’s effective rent."
    >
      <div className={styles.listRow}>
        <input
          id={id}
          className={`${styles.input} ${styles.grow}`}
          value={value?.text ?? ''}
          placeholder="None that you know of"
          onChange={(e) => {
            const text = e.target.value;
            onChange(text.trim() ? { text, valueUsd: value?.valueUsd ?? null } : null);
          }}
        />
        {value && (
          <MoneyCell
            path={`${path}.value`}
            label="Special worth, in dollars"
            value={value.valueUsd}
            onChange={(n) => onChange({ ...value, valueUsd: n })}
          />
        )}
      </div>
    </FieldRow>
  );
}

// ── Links ──────────────────────────────────────────────────────────────────

/** Other links: floor plan PDFs, virtual tours, reviews. Listing links live in Listings. */
export function LinksEditor({
  path,
  value,
  onChange,
}: {
  path: string;
  value: Link[];
  onChange: (v: Link[]) => void;
}) {
  const labelId = useId();
  const form = useFormApi();
  const clearErrors = useClearErrors();
  return (
    <FieldRow path={path} label="Links" empty={false} labelId={labelId} noUnknown wide>
      <div className={styles.listEditor} role="group" aria-labelledby={labelId}>
        {value.map((l, i) => (
          <div key={l.id} className={styles.listRow} data-link={l.id}>
            <input
              className={styles.input}
              aria-label={`Link ${i + 1} name`}
              placeholder="Virtual tour"
              value={l.label}
              onChange={(e) =>
                onChange(value.map((x) => (x.id === l.id ? { ...x, label: e.target.value } : x)))
              }
            />
            <input
              className={`${styles.input} ${styles.grow}`}
              aria-label={`Link ${i + 1} address`}
              placeholder="https://"
              defaultValue={l.url}
              onChange={(e) => {
                const k = `${path}.${l.id}`;
                const r = parseUrl(e.target.value);
                if (!r.ok || r.value === null)
                  form.setError(k, `Link ${i + 1}: ${r.ok ? 'enter a web address.' : r.error}`);
                else {
                  form.setError(k, null);
                  onChange(value.map((x) => (x.id === l.id ? { ...x, url: r.value! } : x)));
                }
              }}
            />
            <button
              type="button"
              className={styles.removeBtn}
              aria-label={`Remove link ${i + 1}`}
              onClick={() => {
                clearErrors(`${path}.${l.id}`);
                onChange(value.filter((x) => x.id !== l.id));
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          className={styles.addBtn}
          onClick={() => {
            const l = { id: newId(), label: '', url: '' };
            form.setError(`${path}.${l.id}`, `Link ${value.length + 1}: enter a web address.`);
            onChange([...value, l]);
            requestAnimationFrame(() =>
              document.querySelector<HTMLInputElement>(`[data-link="${l.id}"] input`)?.focus(),
            );
          }}
        >
          + Add link
        </button>
        <RowErrors prefix={`${path}.`} />
      </div>
    </FieldRow>
  );
}
