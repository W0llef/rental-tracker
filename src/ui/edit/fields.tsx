import { useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { numText } from '../../domain/input';
import type { Parsed } from '../../domain/input';
import { useFormApi } from './formState';
import styles from './edit.module.css';

/**
 * Form fields with the three states of DESIGN.md §4.3: filled, unknown (`?` pressed, italic
 * "Unknown") and empty-not-yet-asked (a faint dashed border, so you can see what's left).
 * Every field row carries `data-field` (its path) and, while empty and not marked unknown,
 * `data-empty`, which is what ⌘/Ctrl+↓ jumps between.
 */

const modified = (e: KeyboardEvent) => e.metaKey || e.ctrlKey || e.altKey;

interface RowProps {
  path: string;
  label: string;
  /** The value is unknown (null). */
  empty: boolean;
  children: ReactNode;
  /** The control's id, for the label; groups name themselves with `labelId` instead. */
  controlId?: string;
  labelId?: string;
  hint?: ReactNode;
  /** Hide the "?" button (fields that can't be unknown). */
  noUnknown?: boolean;
  onUnknown?: () => void;
  /** A field that doesn't apply (a floor plan's floor): shown, never counted as empty. */
  notApplicable?: ReactNode;
  wide?: boolean;
}

/** One labelled field: label · control · [?] · hint and error. */
export function FieldRow({
  path,
  label,
  empty,
  children,
  controlId,
  labelId,
  hint,
  noUnknown,
  onUnknown,
  notApplicable,
  wide,
}: RowProps) {
  const form = useFormApi();
  const marked = form.marked.has(path);
  const error = form.errors.get(path);
  const errorId = `${controlId ?? labelId ?? path}-error`;
  return (
    <div
      className={wide ? `${styles.row} ${styles.rowWide}` : styles.row}
      data-field={path}
      data-empty={(empty && !marked && !notApplicable) || undefined}
      data-unknown={(empty && marked && !notApplicable) || undefined}
      data-invalid={error ? true : undefined}
    >
      {controlId ? (
        <label htmlFor={controlId} className={styles.label} id={labelId}>
          {label}
        </label>
      ) : (
        <span className={styles.label} id={labelId}>
          {label}
        </span>
      )}
      <div className={styles.control}>
        {notApplicable ? <p className={styles.na}>{notApplicable}</p> : children}
        {!noUnknown && !notApplicable && onUnknown && (
          <button
            type="button"
            className={styles.unknownBtn}
            tabIndex={-1}
            aria-pressed={empty && marked}
            title={`Mark ${label.toLowerCase()} unknown (?)`}
            aria-label={`Mark ${label} unknown`}
            onClick={onUnknown}
          >
            ?
          </button>
        )}
      </div>
      {(hint || error) && (
        <div className={styles.below}>
          {error && (
            <p className={styles.error} id={errorId} role="alert">
              {error}
            </p>
          )}
          {hint && !error && <p className={styles.hint}>{hint}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * Marks a field unknown: clears its value, remembers the mark for this session and moves on
 * to the next empty field (research mode, PLAN.md §5.7).
 */
function useUnknown(path: string, clear: () => void) {
  const form = useFormApi();
  return (from?: Element | null) => {
    clear();
    form.setError(path, null);
    form.setMarked(path, true);
    if (from) form.nextEmpty(from);
  };
}

/** `?` on a control: unknown (in a text box only when it's empty, so "?" can be typed). */
function questionKey(e: KeyboardEvent<HTMLElement>, unknown: (from: Element) => void, text = '') {
  if (e.key !== '?' || modified(e) || text.trim() !== '') return false;
  e.preventDefault();
  unknown(e.currentTarget);
  return true;
}

// ── Text ───────────────────────────────────────────────────────────────────

export function TextField({
  path,
  label,
  value,
  onChange,
  multiline,
  placeholder,
  hint,
  wide,
  autoComplete = 'off',
  type = 'text',
}: {
  path: string;
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  multiline?: boolean;
  placeholder?: string;
  hint?: ReactNode;
  wide?: boolean;
  autoComplete?: string;
  type?: 'text' | 'email' | 'tel' | 'url';
}) {
  const id = useId();
  const form = useFormApi();
  const unknown = useUnknown(path, () => onChange(null));
  const marked = form.marked.has(path);
  const props = {
    id,
    className: multiline ? styles.textarea : styles.input,
    value: value ?? '',
    placeholder: value === null && marked ? 'Unknown' : placeholder,
    autoComplete,
    onChange: (e: { target: { value: string } }) => {
      const t = e.target.value;
      onChange(t.trim() === '' ? null : t);
      if (t) form.setMarked(path, false);
    },
    onBlur: () => {
      // Trim on the way out; blank is unknown.
      if (value !== null && value.trim() !== value) onChange(value.trim() || null);
    },
    onKeyDown: (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      questionKey(e, unknown, value ?? ''),
  };
  return (
    <FieldRow
      path={path}
      label={label}
      empty={value === null}
      controlId={id}
      hint={hint}
      wide={wide || multiline}
      onUnknown={() => unknown()}
    >
      {multiline ? <textarea rows={3} {...props} /> : <input type={type} {...props} />}
    </FieldRow>
  );
}

// ── Numbers and money ──────────────────────────────────────────────────────

/**
 * A number typed as text, read with `parse` ("$1,650", "720 sq ft"). What's typed stays as
 * typed while it can't be read, with the reason under it; saving waits until it can.
 */
export function NumberField({
  path,
  label,
  value,
  onChange,
  parse,
  prefix,
  suffix,
  placeholder,
  hint,
  notApplicable,
  size = 'short',
}: {
  path: string;
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  parse: (text: string) => Parsed<number>;
  prefix?: string;
  suffix?: string;
  placeholder?: string;
  hint?: ReactNode;
  notApplicable?: ReactNode;
  size?: 'short' | 'medium';
}) {
  const id = useId();
  const form = useFormApi();
  const [text, setText] = useState(numText(value));
  // Follow the value when it changes from outside (copy details, a rent that follows prices).
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    const read = parse(text);
    if (!read.ok || read.value !== value) setText(numText(value));
  }
  const unknown = useUnknown(path, () => {
    setText('');
    onChange(null);
  });
  const marked = form.marked.has(path);
  const error = form.errors.get(path);
  return (
    <FieldRow
      path={path}
      label={label}
      empty={value === null && text.trim() === ''}
      controlId={id}
      hint={hint}
      notApplicable={notApplicable}
      onUnknown={() => unknown()}
    >
      <span className={size === 'medium' ? styles.numWrapMedium : styles.numWrap}>
        {prefix && (
          <span className={styles.affix} aria-hidden="true">
            {prefix}
          </span>
        )}
        <input
          id={id}
          className={styles.input}
          inputMode="decimal"
          autoComplete="off"
          value={text}
          placeholder={value === null && marked ? 'Unknown' : placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => {
            const t = e.target.value;
            setText(t);
            const read = parse(t);
            if (read.ok) {
              form.setError(path, null);
              setSeen(read.value);
              onChange(read.value);
              if (read.value !== null) form.setMarked(path, false);
            } else form.setError(path, read.error);
          }}
          onKeyDown={(e) => questionKey(e, unknown)}
        />
        {suffix && (
          <span className={styles.affix} aria-hidden="true">
            {suffix}
          </span>
        )}
      </span>
    </FieldRow>
  );
}

// ── Dates ──────────────────────────────────────────────────────────────────

export function DateField({
  path,
  label,
  value,
  onChange,
  hint,
}: {
  path: string;
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  hint?: ReactNode;
}) {
  const id = useId();
  const form = useFormApi();
  const unknown = useUnknown(path, () => onChange(null));
  return (
    <FieldRow
      path={path}
      label={label}
      empty={value === null}
      controlId={id}
      hint={hint}
      onUnknown={() => unknown()}
    >
      <input
        id={id}
        type="date"
        className={styles.input}
        value={value ?? ''}
        onChange={(e) => {
          onChange(e.target.value || null);
          if (e.target.value) form.setMarked(path, false);
        }}
        onKeyDown={(e) => questionKey(e, unknown)}
      />
    </FieldRow>
  );
}

// ── Choices ────────────────────────────────────────────────────────────────

export interface Option<T extends string> {
  value: T;
  label: string;
}

/** A menu of choices; its first entry is "Unknown". */
export function SelectField<T extends string>({
  path,
  label,
  value,
  options,
  onChange,
  hint,
  unknownLabel = 'Unknown',
}: {
  path: string;
  label: string;
  value: T | null;
  options: readonly Option<T>[];
  onChange: (v: T | null) => void;
  hint?: ReactNode;
  unknownLabel?: string;
}) {
  const id = useId();
  const form = useFormApi();
  const unknown = useUnknown(path, () => onChange(null));
  return (
    <FieldRow
      path={path}
      label={label}
      empty={value === null}
      controlId={id}
      hint={hint}
      onUnknown={() => unknown()}
    >
      <select
        id={id}
        className={styles.select}
        value={value ?? ''}
        onChange={(e) => {
          const v = (e.target.value || null) as T | null;
          onChange(v);
          form.setMarked(path, v === null);
        }}
        onKeyDown={(e) => questionKey(e, unknown)}
      >
        <option value="">{value === null && !form.marked.has(path) ? '—' : unknownLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldRow>
  );
}

/**
 * Buttons that act as one choice (a radio group): ← → move and choose, letters choose
 * their option (Y, N…), `?` is unknown. One tab stop for the whole group.
 */
export function Segmented<T extends string>({
  label,
  labelId,
  value,
  options,
  onChange,
  onQuestion,
  keys,
}: {
  label: string;
  labelId?: string;
  value: T | null;
  options: readonly Option<T>[];
  onChange: (v: T) => void;
  onQuestion?: (from: Element) => void;
  /** Letter keys for options, e.g. { y: 'yes', n: 'no' }. */
  keys?: Record<string, T>;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = options.findIndex((o) => o.value === value);
  const tabAt = current === -1 ? 0 : current;
  const pick = (i: number) => {
    const o = options[i];
    if (!o) return;
    onChange(o.value);
    refs.current[i]?.focus();
  };
  return (
    <div
      className={styles.segmented}
      role="radiogroup"
      aria-label={labelId ? undefined : label}
      aria-labelledby={labelId}
    >
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={i === tabAt ? 0 : -1}
          className={styles.segment}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (modified(e)) return;
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
              e.preventDefault();
              pick((i + 1) % options.length);
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
              e.preventDefault();
              pick((i - 1 + options.length) % options.length);
            } else if (e.key === '?' && onQuestion) {
              e.preventDefault();
              onQuestion(e.currentTarget);
            } else if (keys && keys[e.key.toLowerCase()]) {
              e.preventDefault();
              const at = options.findIndex((x) => x.value === keys[e.key.toLowerCase()]);
              pick(at);
            }
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const TRI: readonly Option<'yes' | 'no'>[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

/** Yes · No · ? (DESIGN.md §4.3). Y and N choose; `?` marks it unknown. */
export function TriField({
  path,
  label,
  value,
  onChange,
  hint,
}: {
  path: string;
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
  hint?: ReactNode;
}) {
  const labelId = useId();
  const form = useFormApi();
  const unknown = useUnknown(path, () => onChange(null));
  return (
    <FieldRow
      path={path}
      label={label}
      empty={value === null}
      labelId={labelId}
      hint={hint}
      onUnknown={() => unknown()}
    >
      <Segmented
        label={label}
        labelId={labelId}
        value={value === null ? null : value ? 'yes' : 'no'}
        options={TRI}
        keys={{ y: 'yes', n: 'no' }}
        onChange={(v) => {
          onChange(v === 'yes');
          form.setMarked(path, false);
        }}
        onQuestion={(from) => unknown(from)}
      />
    </FieldRow>
  );
}

/** A plain checkbox for yes/no settings that are never unknown ("Rent is a starting price"). */
export function CheckField({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  hint?: ReactNode;
}) {
  return (
    <div className={styles.checkRow}>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </label>
      {hint && <p className={styles.hint}>{hint}</p>}
    </div>
  );
}

/** A section of the form: a heading the nav scrolls to, and its fields. */
export function FormSection({
  id,
  title,
  children,
  lead,
}: {
  id: string;
  title: string;
  children: ReactNode;
  lead?: ReactNode;
}) {
  return (
    <section className={styles.section} aria-labelledby={`sec-${id}`} data-section={id}>
      <h2 className={styles.sectionTitle} id={`sec-${id}`} tabIndex={-1}>
        {title}
      </h2>
      {lead && <p className={styles.lead}>{lead}</p>}
      <div className={styles.fields}>{children}</div>
    </section>
  );
}
