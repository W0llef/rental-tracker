import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * M7: triage with the keyboard and the detail panel, multi-select and Edit together, toasts
 * with Undo, History (Undo this, Restore to here, Deleted), the notes log, and Settings →
 * Labels and reasons.
 */

const isPhone = (name: string) => name.includes('phone');

async function loadSample(page: Page) {
  await page.goto('/#/debug');
  await page.getByRole('button', { name: 'Load sample data' }).click();
  await expect(page.getByTestId('debug-message')).toContainText('Loaded');
  await page.goto('/#/');
  await expect(page.getByTestId('list-count')).toContainText('34 units in 10 buildings');
}

const cards = (page: Page) => page.getByRole('list', { name: 'Units' }).getByRole('link');
const toast = (page: Page) => page.getByRole('status').filter({ has: page.locator('p') });
const panel = (page: Page) => page.getByRole('article');

/** Opens the cheapest unit (Unit 603 at Lowertown Flats in the sample data). */
async function openFirst(page: Page) {
  await cards(page).first().click();
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Unit 603');
}

test.describe('triage', () => {
  test.beforeEach(async ({ page }) => loadSample(page));

  test('flags, stars and labels from the keyboard, with toasts and undo', async ({
    page,
  }, info) => {
    test.skip(isPhone(info.project.name), 'Keyboard triage is for laptops');
    await openFirst(page);
    const flags = panel(page).getByRole('group', { name: 'Your flag' });

    await page.keyboard.press('u');
    await page.keyboard.press('p');
    await expect(flags.getByRole('button', { name: /^Pick/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(toast(page)).toContainText('Flagged Unit 603 at Lowertown Flats as pick');

    await page.keyboard.press('2');
    await expect(toast(page)).toContainText('Rated Unit 603 at Lowertown Flats 2 stars');
    await page.keyboard.press('6'); // your red label
    await page.keyboard.press('Shift+Digit8'); // the shared green label
    await expect(panel(page).getByRole('group', { name: 'Your label' })).toContainText('Red');
    await expect(panel(page).getByRole('group', { name: 'Shared label' })).toContainText('Green');
    const card = cards(page).first();
    await expect(card.getByRole('img', { name: 'Your label: Red' })).toBeVisible();
    await expect(card.getByRole('img', { name: 'Shared label: Green' })).toBeVisible();

    // ⌘/Ctrl+Z undoes the last one; the toast offers Redo.
    await page.keyboard.press('ControlOrMeta+z');
    await expect(toast(page)).toContainText('Undid: Shared label Green');
    await expect(card.getByRole('img', { name: 'Shared label: Green' })).toHaveCount(0);
    await toast(page).getByRole('button', { name: 'Redo' }).click();
    await expect(card.getByRole('img', { name: 'Shared label: Green' })).toBeVisible();
    // 6 again takes your label off
    await page.keyboard.press('6');
    await expect(card.getByRole('img', { name: 'Your label: Red' })).toHaveCount(0);
  });

  test('rejects with reasons and a new reason, then edits the notes', async ({ page }, info) => {
    await openFirst(page);
    const flags = panel(page).getByRole('group', { name: 'Your flag' });
    if (isPhone(info.project.name)) await flags.getByRole('button', { name: /^Reject/ }).click();
    else await page.keyboard.press('x');
    const dialog = page.getByRole('dialog', { name: 'Reject Unit 603 at Lowertown Flats' });
    await dialog.getByRole('checkbox', { name: 'Too far' }).check();
    await dialog.getByRole('textbox', { name: 'Another reason' }).fill('Noisy street');
    await dialog.getByRole('textbox', { name: 'Note' }).fill('Right by the freeway');
    await dialog.getByRole('textbox', { name: 'Another reason' }).press('Enter');
    await expect(dialog).toHaveCount(0);
    const ratingsNow = page.getByRole('region', { name: 'Ratings' });
    await expect(ratingsNow).toContainText('Rejected: Too far, Noisy street');
    if (!isPhone(info.project.name))
      await expect(cards(page).first()).toContainText('Rejected: Too far, Noisy street');
    await expect(toast(page)).toContainText('Rejected Unit 603 at Lowertown Flats: Too far');

    const ratings = page.getByRole('region', { name: 'Ratings' });
    await expect(ratings).toContainText('Right by the freeway');
    await ratings.getByRole('button', { name: 'Edit notes (You)' }).click();
    await ratings.getByRole('textbox', { name: 'Your rating note' }).fill('Great light');
    await ratings.getByRole('button', { name: 'Save notes' }).click();
    await expect(ratings).toContainText('Great light');

    // The new reason is in Settings → Labels and reasons, and can be archived there.
    await page.goto('/#/settings/labels');
    const reasons = page.getByRole('region', { name: 'Reject reasons' });
    await expect(reasons.getByRole('textbox', { name: 'Reason', exact: true }).last()).toHaveValue(
      'Noisy street',
    );
    await reasons.getByRole('button', { name: 'Archive Noisy street' }).click();
    await expect(reasons.getByRole('button', { name: 'Bring back Noisy street' })).toBeVisible();
  });

  test('status and the notes log', async ({ page }, info) => {
    await openFirst(page);
    await panel(page).getByRole('combobox', { name: 'Status' }).selectOption('applied');
    await expect(toast(page)).toContainText('Status → Applied on Unit 603');
    if (!isPhone(info.project.name)) await expect(cards(page).first()).toContainText('Applied');
    const notes = page.getByRole('region', { name: 'Notes' });
    await notes.getByRole('textbox', { name: 'New note' }).fill('Toured at 5, quiet hallway');
    await notes.getByRole('combobox', { name: 'Kind of note' }).selectOption('tour');
    await notes.getByRole('button', { name: 'Add note' }).click();
    const mine = notes.getByRole('listitem').filter({ hasText: 'Toured at 5' });
    await expect(mine).toContainText('quiet hallway');
    await expect(mine).toContainText('tour');
    await mine.getByRole('button', { name: 'Edit note' }).click();
    await mine
      .getByRole('textbox', { name: 'Note', exact: true })
      .fill('Toured at 5, loud hallway');
    await mine.getByRole('button', { name: 'Save' }).click();
    await expect(mine).toContainText('loud hallway');
    await expect(mine).toContainText('edited');
    await mine.getByRole('button', { name: 'Delete note' }).click();
    await expect(notes).not.toContainText('loud hallway');
    await toast(page).getByRole('button', { name: 'Undo' }).click();
    await expect(notes).toContainText('loud hallway');
  });

  test('selects several units, triages them together and edits them together', async ({
    page,
  }, info) => {
    test.skip(isPhone(info.project.name), '⌘/Ctrl- and Shift-click are for laptops');
    await cards(page).nth(1).click();
    await cards(page)
      .nth(2)
      .click({ modifiers: ['ControlOrMeta'] });
    await cards(page)
      .nth(4)
      .click({ modifiers: ['Shift'] });
    const bar = page.getByRole('region', { name: 'Selected units' });
    // Shift-click selects the range from the last ⌘/Ctrl-clicked unit
    await expect(bar).toContainText('3 units selected');
    await expect(cards(page).nth(3)).toHaveAttribute('data-picked', 'true');
    await expect(cards(page).nth(1)).not.toHaveAttribute('data-picked', 'true');
    await cards(page)
      .nth(1)
      .click({ modifiers: ['ControlOrMeta'] });
    await expect(bar).toContainText('4 units selected');

    await page.keyboard.press('3');
    for (const i of [1, 2, 3, 4])
      await expect(
        cards(page).nth(i).getByRole('img', { name: '3 of 5 stars', exact: true }),
      ).toBeVisible();
    await expect(toast(page)).toContainText('Rated 4 units 3 stars');

    await bar.getByRole('button', { name: 'Edit together…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit 4 units together' });
    await expect(dialog.getByRole('combobox', { name: 'Status' })).toContainText('Mixed');
    await dialog.getByRole('combobox', { name: 'Heat', exact: true }).selectOption('included');
    await dialog.getByRole('combobox', { name: 'Status' }).selectOption('reviewing');
    await dialog.getByRole('button', { name: 'Apply to 4 units' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(toast(page)).toContainText('on 4 units');
    for (const i of [1, 2, 3, 4]) await expect(cards(page).nth(i)).toContainText('Reviewing');

    // One Undo takes the whole edit back.
    await toast(page).getByRole('button', { name: 'Undo' }).click();
    await expect(cards(page).nth(1)).not.toContainText('Reviewing');

    await page.keyboard.press('Escape');
    await expect(bar).toHaveCount(0);
  });

  test('History: Undo this, Restore to here, and Deleted', async ({ page }) => {
    await openFirst(page);
    const status = panel(page).getByRole('combobox', { name: 'Status' });
    await status.selectOption('applied');
    await panel(page)
      .getByRole('group', { name: 'Your rating' })
      .first()
      .getByRole('button', {
        name: '1 star',
        exact: true,
      })
      .click();
    await page.getByRole('button', { name: 'Delete unit…' }).click();
    await page.getByRole('button', { name: 'Delete unit', exact: true }).click();

    await page.getByRole('link', { name: 'History', exact: true }).click();
    const history = page.getByRole('article', { name: 'History' });
    const rows = history.getByRole('listitem');
    await expect(rows.first()).toContainText('Deleted Unit 603 at Lowertown Flats');
    await expect(rows.nth(2)).toContainText('Status');

    // Undo the status change on its own: the unit stays deleted.
    await rows
      .nth(2)
      .getByRole('button', { name: /^Undo this/ })
      .click();
    await expect(rows.first()).toContainText('Undid: Status');

    // Deleted: bring the unit back
    await history.getByRole('button', { name: 'Deleted', exact: true }).click();
    await history.getByRole('button', { name: 'Restore Unit 603 at Lowertown Flats' }).click();
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Unit 603');
    await expect(panel(page).getByRole('combobox', { name: 'Status' })).not.toHaveValue('applied');

    // Restore to here: back to right after the sample data was loaded.
    await page.getByRole('link', { name: 'History', exact: true }).click();
    const all = page.getByRole('article', { name: 'History' }).getByRole('listitem');
    await all
      .last()
      .getByRole('button', { name: /^Restore to here/ })
      .click();
    await page
      .getByRole('group', { name: 'Restore to here' })
      .getByRole('button', { name: 'Restore to here' })
      .click();
    await expect(all.first()).toContainText('Went back to');
    await page.goto('/#/');
    await openFirst(page);
    await expect(
      panel(page).getByRole('group', { name: 'Your rating' }).first().getByRole('button', {
        name: '1 star',
        exact: true,
      }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  test('the shortcut sheet lists every key', async ({ page }, info) => {
    test.skip(isPhone(info.project.name), 'Keyboard sheet is for laptops');
    await page.keyboard.press('?');
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(sheet).toContainText('Reject (asks why');
    await expect(sheet).toContainText('Edit the open unit or building');
    await expect(sheet).toContainText('Next empty field');
    await expect(sheet).toContainText('arrives in M10');
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await page.keyboard.press('c');
    await expect(toast(page)).toContainText('Compare arrives in M10');
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`passes axe checks: panel, Reject, Edit together, History (${scheme})`, async ({
      page,
    }, info) => {
      test.slow(); // five full-page axe runs
      await page.emulateMedia({ colorScheme: scheme });
      await openFirst(page);
      // Pointing at a card fades the others on the map (M7 review); check the resting state.
      const axe = async () => {
        await page.mouse.move(1, 1);
        return new AxeBuilder({ page }).exclude('.maplibregl-canvas').analyze();
      };
      expect((await axe()).violations).toEqual([]);
      await panel(page)
        .getByRole('group', { name: 'Your flag' })
        .getByRole('button', { name: /^Reject/ })
        .click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect((await axe()).violations).toEqual([]);
      await page.keyboard.press('Escape');
      if (!isPhone(info.project.name)) {
        await cards(page)
          .nth(2)
          .click({ modifiers: ['ControlOrMeta'] });
        expect((await axe()).violations).toEqual([]);
        await page.getByRole('button', { name: 'Edit together…' }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        expect((await axe()).violations).toEqual([]);
        await page.keyboard.press('Escape');
      }
      await page.goto('/#/history');
      await expect(page.getByRole('article', { name: 'History' })).toBeVisible();
      expect((await axe()).violations).toEqual([]);
      await page.goto('/#/settings/labels');
      await expect(page.getByRole('heading', { name: 'Labels and reasons' })).toBeVisible();
      expect((await axe()).violations).toEqual([]);
    });
  }

  test('has no horizontal scrolling with the selection bar and History', async ({ page }) => {
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
    await openFirst(page);
    expect(await overflow()).toBe(false);
    await page.goto('/#/history');
    await expect(page.getByRole('article', { name: 'History' })).toBeVisible();
    expect(await overflow()).toBe(false);
  });
});
