import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
test('dashboard, inventory, history, notes, filters and settings', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Garage overview' })).toBeVisible();
  await expect(page.locator('.listing-card')).toHaveCount(6);
  await expect(page.getByText('SAMPLE WORKSPACE')).toBeVisible();
  mkdirSync('docs/images', { recursive: true });
  await page.screenshot({ path: 'docs/images/overview.png', fullPage: true });
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: /^Inventory/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Inventory', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search inventory' }).fill('BMW');
  await expect(page.locator('.listing-card')).toHaveCount(6);
  await expect(page.locator('.listing-title').first()).toContainText('BMW');
  await page.getByRole('button', { name: 'Table view' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(6);
  await page.getByRole('button', { name: 'Card view' }).click();
  await page
    .locator('.listing-card')
    .filter({ has: page.locator('.save-button:not(.saved)') })
    .first()
    .locator('.listing-title')
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.price-chart')).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Your notes' })
    .fill('Browser test: confirm engine mounts.');
  await page.getByRole('checkbox', { name: 'Save this part' }).check();
  await page.getByRole('button', { name: 'Save notes' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('link', { name: 'Saved parts' }).click();
  await expect(page.locator('.listing-card')).toHaveCount(4);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Pause all scheduled scans' }).check();
  await page.getByRole('spinbutton', { name: 'Retention (days)' }).fill('120');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Retention (days)' })).toHaveValue('120');
  await page.screenshot({ path: 'docs/images/settings.png', fullPage: true });
  await page.getByRole('link', { name: 'Activity', exact: true }).click();
  await expect(page.locator('tbody tr').first()).toContainText('success');
  expect(errors).toEqual([]);
});
test('monitor creation, inventory import, editing and deletion', async ({ page }) => {
  await page.goto('/#monitors');
  await page.getByRole('button', { name: 'Add monitor', exact: true }).click();
  await page.getByRole('textbox', { name: 'Monitor name' }).fill('Test Miata');
  await page.getByRole('textbox', { name: 'Vehicle model' }).fill('Mazda Miata');
  await page.getByRole('textbox', { name: 'Part name', exact: true }).fill('Hood');
  await page.getByRole('textbox', { name: 'ZIP code' }).fill('01545');
  await page.getByRole('button', { name: 'Create monitor' }).click();
  const monitor = page.locator('.monitor-card').filter({ hasText: 'Test Miata' });
  await expect(monitor).toBeVisible();
  await monitor.getByRole('button', { name: 'Import inventory' }).click();
  await page.getByLabel('Inventory file').setInputFiles({
    name: 'inventory.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify([
        {
          stock: 'TEST1',
          year: 2001,
          model: 'Mazda Miata',
          part: 'Hood',
          dealer: 'Fixture Recycler',
          price: 250,
        },
      ]),
    ),
  });
  await page.getByRole('button', { name: 'Import inventory', exact: true }).last().click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await monitor.getByRole('button', { name: 'Edit search' }).click();
  await page.getByRole('spinbutton', { name: 'Maximum price ($)' }).fill('200');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(monitor).toContainText('$200');
  await monitor.getByRole('button', { name: 'Delete Test Miata' }).click();
  await page.getByRole('button', { name: 'Delete monitor', exact: true }).click();
  await expect(monitor).toHaveCount(0);
  await page.screenshot({ path: 'docs/images/monitors.png', fullPage: true });
});
test('mobile navigation and monitor form fit without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Garage overview' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/images/mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('link', { name: 'Monitors', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your monitors' })).toBeVisible();
  await page.getByRole('button', { name: 'Add monitor' }).click();
  expect(await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});
