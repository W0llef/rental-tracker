import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { rejectUnits } from '../../commands/triage';
import { db } from '../../db/db';
import { unitFullName } from '../../domain/format';
import { cleanReason, common, findReason, offeredReasons, unitsCount } from '../../domain/triage';
import type { Dataset } from '../../state/derive';
import type { Rejecting } from '../../state/ui';
import styles from './triage.module.css';

/**
 * Reject with reasons (spec §6; DESIGN.md §4.1 "Reject reason" dialog): the reusable reasons
 * as checkboxes, a box for a new one (it joins the list), and a note. ⏎ rejects, Esc
 * cancels. Opened by X, the Reject buttons, or a person's Reasons button in Ratings.
 */
export function RejectDialog({
  rejecting,
  data,
  onClose,
}: {
  rejecting: Rejecting;
  data: Dataset;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const first = useRef<HTMLInputElement>(null);
  const rows = rejecting.unitIds
    .map((id) => data.unitById.get(id))
    .filter((r): r is NonNullable<typeof r> => !!r);
  const person = data.personById.get(rejecting.personId);
  const opinions = rows.map(
    (r) => r.opinions.find((o) => o.person.id === rejecting.personId)?.opinion,
  );
  // Start from what's there when all the units agree (editing an earlier reject).
  const sameReasons = common(opinions.map((o) => (o?.flag === 'reject' ? o.rejectReasonIds : [])));
  const sameNote = common(opinions.map((o) => o?.flagNote ?? null));

  const [chosen, setChosen] = useState<string[]>(sameReasons.mixed ? [] : sameReasons.value);
  const [other, setOther] = useState('');
  const [note, setNote] = useState(sameNote.mixed ? '' : (sameNote.value ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
    first.current?.focus();
  }, []);

  const reasons = offeredReasons(data.settings.rejectReasons, chosen);
  const isMe = rejecting.personId === data.me.id;
  const whose = isMe ? '' : ` for ${person?.name ?? 'them'}`;
  const what =
    rows.length === 1 && rows[0]
      ? unitFullName(rows[0].unit, rows[0].building)
      : unitsCount(rows.length);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (busy || !rows.length) return;
    setBusy(true);
    setError(null);
    try {
      const typed = cleanReason(other);
      const known = typed ? findReason(data.settings.rejectReasons, typed) : undefined;
      await rejectUnits(
        db,
        rows.map((r) => r.unit.id),
        rejecting.personId,
        {
          reasonIds: known ? [...chosen, known.id] : chosen,
          newReasons: typed && !known ? [typed] : [],
          // Several units with different notes keep theirs unless a note is typed.
          note: sameNote.mixed && !note.trim() ? undefined : note,
        },
      );
      onClose();
    } catch (err) {
      setError(`Couldn’t reject. ${err instanceof Error ? err.message : ''}`.trim());
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    // ⏎ rejects from anywhere but the note (where ⌘/Ctrl+⏎ does).
    if (e.key !== 'Enter' || e.shiftKey) return;
    const inNote = e.target instanceof HTMLTextAreaElement;
    if (inNote && !(e.metaKey || e.ctrlKey)) return;
    if (e.target instanceof HTMLButtonElement) return;
    e.preventDefault();
    void submit();
  }

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="reject-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <form className={styles.form} onSubmit={submit} onKeyDown={onKeyDown}>
        <header className={styles.head}>
          <h2 id="reject-title" className={styles.title}>
            Reject {what}
            {whose}
          </h2>
        </header>
        <div className={styles.body}>
          <fieldset className={styles.reasons}>
            <legend className={styles.legend}>Why? Choose any that apply.</legend>
            {reasons.map((r, i) => (
              <label key={r.id} className={styles.check}>
                <input
                  ref={i === 0 ? first : undefined}
                  type="checkbox"
                  checked={chosen.includes(r.id)}
                  onChange={(e) =>
                    setChosen((c) =>
                      e.target.checked ? [...c, r.id] : c.filter((id) => id !== r.id),
                    )
                  }
                />
                {r.label}
                {r.archived && <span className={styles.archived}> (archived)</span>}
              </label>
            ))}
            {sameReasons.mixed && (
              <p className={styles.hint}>
                These units have different reasons now; the ones you tick replace them.
              </p>
            )}
          </fieldset>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Another reason</span>
            <input
              className={styles.input}
              value={other}
              maxLength={40}
              onChange={(e) => setOther(e.target.value)}
              placeholder="e.g. Noisy street"
            />
            <span className={styles.hint}>Added to your list of reasons.</span>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Note</span>
            <textarea
              className={styles.textarea}
              value={note}
              rows={2}
              onChange={(e) => setNote(e.target.value)}
              placeholder={sameNote.mixed ? 'Mixed: leave empty to keep each unit’s note' : ''}
            />
          </label>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className={styles.foot}>
          <button type="button" className={styles.secondary} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={styles.primary} disabled={busy}>
            Reject <kbd aria-hidden="true">⏎</kbd>
          </button>
        </footer>
      </form>
    </dialog>
  );
}
