import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getSettings } from '../../commands/records';
import { db } from '../../db/db';
import { leaseMark } from '../../domain/cost';
import type { LeaseMarkInfo, TermStatus } from '../../domain/cost';
import { aLease } from '../../domain/format';
import { shownLeaseMark } from '../../domain/leaseMarks';
import type { LeaseMarkKind, LeaseMarkPlace, LeaseMarkPrefs } from '../../domain/leaseMarks';
import { useUi } from '../../state/ui';
import { LeaseIcon, LeaseMark } from '../common/Markers';
import styles from './settings.module.css';

/**
 * Settings → Lease length marks (Q36, as the owner approved it from the mockup): a master
 * switch, which cases get a mark, where marks show, and a live preview with example units.
 * Kept in this browser like pin choices; marks never change a cost.
 */

interface Example {
  id: string;
  title: string;
  building: string;
  specs: string;
  total: string;
  rent: string;
  status: TermStatus;
}

const EXAMPLES: Example[] = [
  {
    id: 'a',
    title: 'Unit 603',
    building: 'Lowertown Flats',
    specs: 'Studio · 1 ba · 547 ft²',
    total: '$1,516',
    rent: '$1,090',
    status: 'not-offered',
  },
  {
    id: 'b',
    title: 'Unit 201',
    building: 'Lowertown Flats',
    specs: 'Studio · 1 ba · 521 ft²',
    total: '$1,743',
    rent: '$1,345',
    status: 'offered',
  },
  {
    id: 'c',
    title: 'Unit 103',
    building: 'Cedar Row',
    specs: 'Studio · 1 ba · 469 ft²',
    total: '$1,435',
    rent: '$1,225',
    status: 'unknown',
  },
  {
    id: 'd',
    title: 'Unit 102',
    building: 'Grand Terrace',
    specs: 'Studio · 1 ba · ? ft²',
    total: '$1,830',
    rent: '$1,570',
    status: 'empty',
  },
];

const KINDS: { kind: LeaseMarkKind; text: string; sub: string }[] = [
  {
    kind: 'not-offered',
    text: 'It doesn’t list your lease length',
    sub: 'priced at the nearest length it lists',
  },
  {
    kind: 'unknown',
    text: 'Its lease terms are unknown',
    sub: 'you marked them ?, or the listing lists none',
  },
  { kind: 'empty', text: 'No lease terms are entered yet', sub: 'not filled in in its form' },
];

const PLACES: { place: LeaseMarkPlace; text: string; sub: string }[] = [
  { place: 'cards', text: 'List cards', sub: 'the tag with its name' },
  { place: 'map', text: 'The map', sub: 'an icon on pins and on rows of building cards' },
  {
    place: 'details',
    text: 'The unit’s monthly cost',
    sub: 'a note saying which lease length its costs use',
  },
];

/** Lease lengths the "doesn't list yours" example lists: the three just below yours. */
const shorter = (wanted: number) =>
  wanted > 3 ? [wanted - 3, wanted - 2, wanted - 1] : [wanted + 1, wanted + 2];

function costOf(e: Example, wanted: number) {
  const offered = e.status === 'not-offered' ? shorter(wanted) : [wanted];
  return {
    termStatus: e.status,
    wantedMonths: wanted,
    leaseMonths: e.status === 'not-offered' ? offered[offered.length - 1]! : wanted,
    offeredTerms: offered,
  };
}

function Preview({ prefs, wanted }: { prefs: LeaseMarkPrefs; wanted: number }) {
  const [picked, setPicked] = useState('a');
  const pickedExample = EXAMPLES.find((e) => e.id === picked) ?? EXAMPLES[0]!;
  const note = shownLeaseMark(costOf(pickedExample, wanted), prefs, 'details');
  const mapMark = (e: Example) => shownLeaseMark(costOf(e, wanted), prefs, 'map');
  const [rowA, rowB, pinC, pinD] = EXAMPLES as [Example, Example, Example, Example];
  return (
    <section className={styles.markPreview} aria-labelledby="lease-preview-h">
      <h3 id="lease-preview-h" className={styles.subTitle}>
        Preview, comparing at {wanted} months (example units; pick one to see its monthly cost)
      </h3>
      <div className={styles.previewCols}>
        <ul className={styles.previewCards} aria-label="Example cards">
          {EXAMPLES.map((e) => {
            const mark = shownLeaseMark(costOf(e, wanted), prefs, 'cards');
            return (
              <li key={e.id}>
                <button
                  type="button"
                  className={styles.previewCard}
                  aria-pressed={picked === e.id}
                  onClick={() => setPicked(e.id)}
                >
                  <span className={styles.previewThumb} aria-hidden="true" />
                  <span className={styles.previewBody}>
                    <span>
                      <b>{e.title}</b> <span className={styles.previewMuted}>{e.building}</span>
                    </span>
                    <span className={styles.previewMuted}>{e.specs}</span>
                    <span>
                      <b className={styles.previewTotal}>{e.total}</b>/mo{' '}
                      <span className={styles.previewMuted}>{e.rent} rent</span>
                    </span>
                    {mark && (
                      <span>
                        <LeaseMark kind={mark.kind} label={mark.label} explain={mark.explain} />
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className={styles.previewRight}>
          <div className={styles.previewMap} role="img" aria-label="Example map with marks">
            <div className={styles.previewMapCard}>
              <b>Lowertown Flats</b>
              {[rowA, rowB].map((e) => {
                const m = mapMark(e);
                return (
                  <span key={e.id} className={styles.previewRow}>
                    <b>{e.total}</b>
                    <span className={styles.previewMuted}>{e.title}</span>
                    {m && <MapIcon mark={m} />}
                  </span>
                );
              })}
            </div>
            {[pinC, pinD].map((e, i) => {
              const m = mapMark(e);
              return (
                <span
                  key={e.id}
                  className={styles.previewPin}
                  style={{ left: `${62 + i * 18}%`, top: `${44 + i * 20}%` }}
                >
                  {e.total}
                  {m && (
                    <span className={styles.previewBadge} title={m.explain}>
                      <LeaseIcon kind={m.kind} />
                    </span>
                  )}
                </span>
              );
            })}
          </div>
          <div className={styles.previewCost}>
            <p className={styles.previewMuted}>
              <b>{pickedExample.title}</b> · Monthly cost
            </p>
            {note ? (
              <p className={styles.previewNote}>
                <LeaseMark kind={note.kind} label={note.label} explain={note.explain} />{' '}
                {note.explain}
              </p>
            ) : (
              <p className={styles.previewMuted}>
                {pickedExample.status === 'not-offered'
                  ? `Priced for the ${costOf(pickedExample, wanted).leaseMonths}-month lease, the nearest it lists.`
                  : `Priced for ${aLease(wanted)}.`}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function MapIcon({ mark }: { mark: LeaseMarkInfo }) {
  return (
    <span className={styles.previewBadgeInline} title={mark.explain}>
      <LeaseIcon kind={mark.kind} />
    </span>
  );
}

export function LeaseMarksSection() {
  const settings = useLiveQuery(() => getSettings(db), []);
  const prefs = useUi((s) => s.leaseMarks);
  const setPrefs = useUi((s) => s.setLeaseMarks);
  if (!settings) return null;
  const wanted = settings.costProfile.defaultLeaseMonths;
  const example = (kind: LeaseMarkKind) =>
    leaseMark({ ...costOf({ ...EXAMPLES[0]!, status: kind }, wanted), termStatus: kind })!;

  return (
    <>
      <p className={styles.lead}>
        You compare units at {aLease(wanted)} (<Link to="/settings/cost">Cost profile</Link>). These
        marks say when a unit’s lease lengths don’t back that up.
      </p>

      <div className={styles.card}>
        <label className={styles.switchRow}>
          <input
            type="checkbox"
            role="switch"
            className={styles.switch}
            checked={prefs.on}
            onChange={(e) => setPrefs({ ...prefs, on: e.target.checked })}
          />
          Show lease length marks
        </label>
        <p className={styles.switchNote}>
          {prefs.on
            ? 'Marks the units below on cards, the map and their monthly cost.'
            : 'Off: no marks anywhere, as if every unit offers your lease length. Good if you don’t enter lease terms.'}
        </p>
      </div>

      <fieldset className={`${styles.card} ${styles.markGroup}`} disabled={!prefs.on}>
        <legend className={styles.markLegend}>Mark a unit when</legend>
        {KINDS.map((k) => {
          const m = example(k.kind);
          return (
            <label key={k.kind} className={styles.markCheck}>
              <input
                type="checkbox"
                checked={prefs.kinds[k.kind]}
                onChange={(e) =>
                  setPrefs({ ...prefs, kinds: { ...prefs.kinds, [k.kind]: e.target.checked } })
                }
              />
              <span className={styles.markText}>
                <span className={styles.markName}>{k.text}</span>
                <span className={styles.markSub}>
                  <LeaseMark kind={m.kind} label={m.label} explain={m.explain} /> {k.sub}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <fieldset className={`${styles.card} ${styles.markGroup}`} disabled={!prefs.on}>
        <legend className={styles.markLegend}>Show them on</legend>
        {PLACES.map((p) => (
          <label key={p.place} className={styles.markCheck}>
            <input
              type="checkbox"
              checked={prefs.places[p.place]}
              onChange={(e) =>
                setPrefs({ ...prefs, places: { ...prefs.places, [p.place]: e.target.checked } })
              }
            />
            <span className={styles.markText}>
              <span className={styles.markName}>{p.text}</span>{' '}
              <span className={styles.markSub}>{p.sub}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className={styles.note}>
        The marks never change a cost: a unit that lists other lease lengths is always priced at the
        nearest one. Kept in this browser, like your pin choices.
      </p>

      <Preview prefs={prefs} wanted={wanted} />
    </>
  );
}
