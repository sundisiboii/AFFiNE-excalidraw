import { test } from '@affine-test/kit/playwright';
import { openHomePage, setCoreUrl } from '@affine-test/kit/utils/load-page';
import {
  clickNewPageButton,
  waitForEditorLoad,
} from '@affine-test/kit/utils/page-logic';
import { expect, type Page } from '@playwright/test';

test.beforeEach(async ({ baseURL, page }) => {
  setCoreUrl(baseURL!);
  await page.addLocatorHandler(
    page.getByTestId('local-demo-tips'),
    async () => {
      await page.getByTestId('local-demo-tips-close-button').click();
    }
  );
});

async function savedElements(page: Page, id: string) {
  return page.evaluate(docId => {
    const testWindow = window as typeof window & {
      currentWorkspace?: {
        docCollection: {
          getDoc(id: string): {
            spaceDoc: { getMap<T>(name: string): Map<string, T> };
          } | null;
        };
      };
    };
    const doc = testWindow.currentWorkspace?.docCollection.getDoc(docId);
    return [
      ...(doc?.spaceDoc
        .getMap<string>('affine:excalidraw:v1:elements')
        .values() ?? []),
    ]
      .map(value => JSON.parse(value))
      .filter(element => !element.isDeleted);
  }, id);
}

test('Excalidraw saves, reopens and keeps drawings isolated when navigating', async ({
  page,
}) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  await clickNewPageButton(page, 'Drawing one');
  await page.getByTestId('switch-edgeless-mode-button').click();
  const editor = page.locator('[data-affine-excalidraw]');
  await expect(editor.locator('.excalidraw')).toBeVisible();
  const id = (await editor.getAttribute('data-testid'))!.slice(
    'excalidraw-'.length
  );
  const boardUrl = page.url();
  await editor.locator('.excalidraw').click({ position: { x: 400, y: 300 } });
  await page.keyboard.press('r');
  const box = (await editor.boundingBox())!;
  await page.mouse.move(box.x + 400, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 550, box.y + 400, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await savedElements(page, id)).length).toBe(1);
  await page.keyboard.press('v');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+c');
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('excalidraw/clipboard');
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(async () => (await savedElements(page, id)).length).toBe(2);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await savedElements(page, id)).length).toBe(1);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(async () => (await savedElements(page, id)).length).toBe(2);
  await page.keyboard.press('ControlOrMeta+z');
  // Switching immediately exercises the unmount flush, before the debounce.
  await page.getByTestId('switch-page-mode-button').click();
  await waitForEditorLoad(page);
  await expect.poll(async () => (await savedElements(page, id)).length).toBe(1);
  await clickNewPageButton(page, 'Drawing two');
  await page.getByTestId('switch-edgeless-mode-button').click();
  await expect(editor.locator('.excalidraw')).toBeVisible();
  const secondId = (await editor.getAttribute('data-testid'))!.slice(
    'excalidraw-'.length
  );
  expect(secondId).not.toBe(id);
  expect(await savedElements(page, secondId)).toHaveLength(0);
  await page.goto(boardUrl);
  await expect(editor.locator('.excalidraw')).toBeVisible();
  await expect.poll(async () => (await savedElements(page, id)).length).toBe(1);
  await page.reload();
  await expect(editor.locator('.excalidraw')).toBeVisible();
  await expect.poll(async () => (await savedElements(page, id)).length).toBe(1);
});

test('existing document content stays accessible through the legacy whiteboard', async ({
  page,
}) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  await clickNewPageButton(page, 'Preserved document');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('Original note content');
  await page.getByTestId('switch-edgeless-mode-button').click();
  await expect(page.locator('affine-edgeless-root')).toBeVisible();
  await page.getByRole('button', { name: 'Open Excalidraw canvas' }).click();
  await expect(
    page.locator('[data-affine-excalidraw] .excalidraw')
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Open original Edgeless content' })
    .click();
  await expect(page.locator('affine-edgeless-root')).toBeVisible();
  await page.getByTestId('switch-page-mode-button').click();
  await expect(
    page
      .locator('affine-paragraph')
      .filter({ hasText: 'Original note content' })
  ).toBeVisible();
});
