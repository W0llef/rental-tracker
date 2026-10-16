import { PHOTO_PREVIEW as PREVIEW } from '../../domain/pinLayout';
import type { UnitType } from '../../model';
import { TypeGlyph } from './Pin';
import styles from './map.module.css';

/**
 * A unit's larger photo, drawn above everything on the map while you point at its thumbnail
 * (owner review 4): just the photo and the unit's name. Until photos arrive (M11) it shows
 * the unit-type icon.
 */
export function PhotoPreview({
  title,
  type,
  left,
  top,
}: {
  title: string;
  type: UnitType | null;
  left: number;
  top: number;
}) {
  return (
    <div
      className={styles.preview}
      style={{ left, top, width: PREVIEW.w, height: PREVIEW.h }}
      aria-hidden="true"
      data-preview
    >
      <span className={styles.previewPhoto}>
        <TypeGlyph type={type} />
        <small>No photo yet</small>
      </span>
      <span className={styles.previewTitle}>{title}</span>
    </div>
  );
}
