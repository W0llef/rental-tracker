import { forwardRef, useId, useState } from 'react';
import { buildingName } from '../../domain/format';
import type { Building } from '../../model';
import type { Place } from '../../services/geocode';
import { addressText } from './plan';
import type { SuggestStatus } from './useSuggestions';
import styles from './add.module.css';

export type AddressChoice =
  { kind: 'building'; building: Building } | { kind: 'place'; place: Place };

interface Option {
  id: string;
  choice: AddressChoice;
  title: string;
  detail: string;
}

/**
 * Address search (ARIA combobox): your own buildings first ("In your list"), then Photon's
 * suggestions. ↑↓ move, ⏎ picks, Esc closes the list (a second Esc closes the dialog).
 * Typing after a pick clears it.
 */
export const AddressField = forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange: (text: string) => void;
    onChoose: (choice: AddressChoice) => void;
    local: readonly Building[];
    places: readonly Place[];
    status: SuggestStatus;
    filled: boolean;
    invalid: boolean;
    describedBy?: string;
  }
>(function AddressField(
  { value, onChange, onChoose, local, places, status, filled, invalid, describedBy },
  ref,
) {
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const options: Option[] = [
    ...local.map((b) => ({
      id: `${id}-b-${b.id}`,
      choice: { kind: 'building', building: b } as const,
      title: buildingName(b),
      detail:
        buildingName(b) === b.address.line1
          ? `In your list · ${b.address.city ?? ''}`.replace(/ · $/, '')
          : `In your list · ${b.address.line1}`,
    })),
    ...places.map((p) => ({
      id: `${id}-p-${p.id.replace(/[^a-z0-9-]/gi, '')}`,
      choice: { kind: 'place', place: p } as const,
      title: p.name ?? p.address.line1,
      detail: p.name
        ? addressText({ line1: p.address.line1, city: p.address.city })
        : addressText({
            line1: '',
            city: p.address.city,
            state: p.address.state,
            zip: p.address.zip,
          }),
    })),
  ];
  const shown = open && (options.length > 0 || status === 'loading' || status === 'unavailable');
  const activeOption = shown && active >= 0 ? options[active] : undefined;

  const choose = (o: Option) => {
    onChoose(o.choice);
    setOpen(false);
    setActive(-1);
  };

  return (
    <div className={styles.combo}>
      <input
        ref={ref}
        id="qa-address"
        className={styles.input}
        data-filled={filled || undefined}
        type="text"
        role="combobox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeOption?.id}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        spellCheck={false}
        placeholder="Street address or building name"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (!options.length) return;
            e.preventDefault();
            setOpen(true);
            // Moving past either end returns to the text (no option active).
            const n = options.length;
            setActive((a) =>
              e.key === 'ArrowDown' ? (a >= n - 1 ? -1 : a + 1) : a === -1 ? n - 1 : a - 1,
            );
          } else if (e.key === 'Enter' && !e.shiftKey && activeOption) {
            e.preventDefault();
            choose(activeOption);
          } else if (e.key === 'Escape' && shown) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            setActive(-1);
          }
        }}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Address suggestions"
        className={styles.listbox}
        hidden={!shown}
      >
        {options.map((o, i) => (
          <li
            key={o.id}
            id={o.id}
            role="option"
            aria-selected={i === active}
            className={styles.option}
            data-kind={o.choice.kind}
            // Pick on mousedown, before the input loses focus and closes the list.
            onMouseDown={(e) => {
              e.preventDefault();
              choose(o);
            }}
            onMouseMove={() => setActive(i)}
          >
            <span className={styles.optionTitle}>{o.title}</span>{' '}
            {o.detail && <span className={styles.optionDetail}>{o.detail}</span>}
          </li>
        ))}
        {status === 'loading' && !places.length && (
          <li role="presentation" className={styles.optionNote}>
            Looking up addresses…
          </li>
        )}
        {status === 'unavailable' && (
          <li role="presentation" className={styles.optionNote}>
            Address suggestions aren’t available right now. You can still add the unit.
          </li>
        )}
      </ul>
    </div>
  );
});
