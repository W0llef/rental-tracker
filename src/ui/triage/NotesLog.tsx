import { useState } from 'react';
import type { FormEvent } from 'react';
import { addNote } from '../../commands/records';
import { deleteNote, updateNote } from '../../commands/triage';
import { db } from '../../db/db';
import { shortDate } from '../../domain/format';
import type { ID, ISODate, NoteEntry } from '../../model';
import type { NoteRow } from '../../state/derive';
import { useUi } from '../../state/ui';
import styles from './triage.module.css';

/**
 * The timestamped notes log (spec §6): add a note, tour note or call note; edit or delete
 * your own. Notes by others name their author and can't be changed here.
 */

type Kind = Exclude<NoteEntry['kind'], 'system'>;

const KINDS: { value: Kind; label: string }[] = [
  { value: 'note', label: 'Note' },
  { value: 'tour', label: 'Tour' },
  { value: 'call', label: 'Call' },
];

const KIND_TEXT: Record<NoteEntry['kind'], string> = {
  note: 'note',
  tour: 'tour',
  call: 'call',
  system: 'change',
};

function NoteForm({
  initialText = '',
  initialKind = 'note',
  submitLabel,
  onSubmit,
  onCancel,
  idBase,
}: {
  initialText?: string;
  initialKind?: Kind;
  submitLabel: string;
  onSubmit: (text: string, kind: Kind) => Promise<void>;
  onCancel?: () => void;
  idBase: string;
}) {
  const [text, setText] = useState(initialText);
  const [kind, setKind] = useState<Kind>(initialKind);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(text.trim(), kind);
      setText('');
      setKind('note');
    } catch (err) {
      setError(`Couldn’t save the note. ${err instanceof Error ? err.message : ''}`.trim());
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.noteForm} onSubmit={submit}>
      <label className={styles.visuallyHidden} htmlFor={`${idBase}-text`}>
        {submitLabel === 'Add note' ? 'New note' : 'Note'}
      </label>
      <textarea
        id={`${idBase}-text`}
        className={styles.textarea}
        rows={2}
        value={text}
        placeholder={submitLabel === 'Add note' ? 'Add a note, e.g. tour impressions' : ''}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
          if (e.key === 'Escape' && onCancel) {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      <div className={styles.noteFormRow}>
        <select
          className={styles.smallSelect}
          value={kind}
          aria-label="Kind of note"
          onChange={(e) => setKind(e.target.value as Kind)}
        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        <button type="submit" className={styles.smallPrimary} disabled={busy || !text.trim()}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className={styles.smallButton} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function NoteItem({ note, today, mine }: { note: NoteRow; today: ISODate; mine: boolean }) {
  const [editing, setEditing] = useState(false);
  const showNotice = useUi((s) => s.showNotice);
  const kind = note.kind === 'system' ? 'note' : note.kind;
  return (
    <li>
      <div className={styles.when}>
        {shortDate(note.createdAt.slice(0, 10), today)}, {KIND_TEXT[note.kind]}
        {note.authorName && <span className={styles.author}> · {note.authorName}</span>}
        {note.updatedAt !== note.createdAt && note.kind !== 'system' && (
          <span className={styles.author}> · edited</span>
        )}
        {mine && !editing && (
          <span className={styles.noteActions}>
            <button type="button" className={styles.textButton} onClick={() => setEditing(true)}>
              Edit<span className={styles.visuallyHidden}> note</span>
            </button>
            <button
              type="button"
              className={styles.textButton}
              onClick={() =>
                void deleteNote(db, note.id).catch((e: unknown) =>
                  showNotice(`Couldn’t delete the note. ${(e as Error).message}`),
                )
              }
            >
              Delete<span className={styles.visuallyHidden}> note</span>
            </button>
          </span>
        )}
      </div>
      {editing ? (
        <NoteForm
          idBase={`note-${note.id}`}
          initialText={note.text}
          initialKind={kind}
          submitLabel="Save"
          onSubmit={async (text, k) => {
            await updateNote(db, note.id, { text, kind: k });
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <p className={styles.noteText}>{note.text}</p>
      )}
    </li>
  );
}

export function NotesLog({
  notes,
  today,
  meId,
  owner,
}: {
  notes: readonly NoteRow[];
  today: ISODate;
  meId: ID;
  /** What the notes are about. */
  owner: { unitId: ID } | { buildingId: ID };
}) {
  const idBase = 'unitId' in owner ? `u-${owner.unitId}` : `b-${owner.buildingId}`;
  return (
    <div className={styles.notesLog}>
      <NoteForm
        idBase={`new-${idBase}`}
        submitLabel="Add note"
        onSubmit={async (text, kind) => {
          await addNote(db, { ...owner, text, kind });
        }}
      />
      {notes.length === 0 ? (
        <p className={styles.muted}>No notes yet.</p>
      ) : (
        <ol className={styles.notes}>
          {notes.map((n) => (
            <NoteItem
              key={n.id}
              note={n}
              today={today}
              mine={n.kind !== 'system' && (n.authorId === meId || n.authorId === null)}
            />
          ))}
        </ol>
      )}
    </div>
  );
}
