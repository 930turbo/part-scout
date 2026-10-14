import { test, expect } from '@playwright/test';
test('garage name, uploaded car photos, bought parts, and theme choices persist', async ({
  page,
}) => {
  await page.goto('/#garage');
  await page.getByRole('button', { name: 'Edit garage' }).click();
  await page.getByRole('textbox', { name: 'Garage name' }).fill('Project garage');
  await page.getByRole('textbox', { name: 'Your name', exact: true }).fill('Test owner');
  await page.getByRole('textbox', { name: 'Default ZIP code' }).fill('01545');
  await page.getByRole('button', { name: 'Save garage' }).click();
  await expect(page.getByRole('heading', { name: 'Project garage' })).toBeVisible();
  await page.getByRole('button', { name: 'Add a car', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Car nickname' }).fill('Test RX7');
  await page.getByRole('spinbutton', { name: 'Year', exact: true }).fill('1987');
  await page.getByRole('textbox', { name: 'Make', exact: true }).fill('Mazda');
  await page.getByRole('textbox', { name: 'Model', exact: true }).fill('RX7');
  await page.getByRole('textbox', { name: 'Build notes' }).fill('Browser fixture only.');
  await page.getByLabel('Car photos', { exact: false }).setInputFiles('build/icon.png');
  await page.getByRole('button', { name: 'Add car', exact: true }).click();
  const car = page.locator('.car-card').filter({ hasText: 'Test RX7' });
  await expect(car).toBeVisible();
  await expect(car.locator('.car-photo>img')).toHaveCount(1);
  await car.getByRole('button', { name: 'Add wanted part' }).click();
  await page.getByRole('textbox', { name: 'Part', exact: true }).fill('Transmission');
  await page.getByLabel('Status', { exact: true }).selectOption('bought');
  await page.getByRole('spinbutton', { name: 'Amount paid ($)' }).fill('425');
  await page.getByRole('textbox', { name: 'Seller', exact: true }).fill('Fixture seller');
  await page.getByRole('button', { name: 'Save part' }).click();
  await expect(car).toContainText('$425 spent');
  await expect(car).toContainText('bought');
  await page.reload();
  await expect(car).toContainText('Fixture seller');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Color mode').selectOption('light');
  await page.getByLabel('Accent color').selectOption('violet');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'violet');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByLabel('Color mode').selectOption('dark');
  await page.getByLabel('Accent color').selectOption('mint');
  await page.getByRole('button', { name: 'Save settings' }).click();
});
test('48 presets, multi-photo galleries, seller link actions, and dated Excel exports', async ({
  page,
  request,
}) => {
  await page.goto('/#monitors');
  await page.getByRole('button', { name: 'Part presets' }).click();
  await expect(page.locator('.preset-grid button')).toHaveCount(48);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  const config = {
    name: 'Gallery fixture',
    model: 'Mazda RX7',
    part: 'Transmission',
    yearStart: 1986,
    yearEnd: 1988,
    zip: '01545',
    provider: 'import',
  };
  const response = await request.post('/api/monitors', { data: config });
  const monitor = await response.json();
  await page.route('https://photos.example/**', (route) =>
    route.fulfill({ contentType: 'image/png', path: 'build/icon.png' }),
  );
  await request.post(`/api/monitors/${monitor.id}/import`, {
    data: {
      listings: [
        {
          stock: 'GALLERY',
          year: 1987,
          model: 'Mazda RX7',
          part: 'Transmission',
          dealer: 'Gallery seller',
          price: 500,
          source: 'eBay',
          url: 'https://www.ebay.com/itm/123',
          images: ['https://photos.example/one.png', 'https://photos.example/two.png'],
          buyingOptions: ['FIXED_PRICE'],
        },
      ],
      complete: true,
    },
  });
  await page.goto('/#inventory');
  await page.getByRole('textbox', { name: 'Search inventory' }).fill('GALLERY');
  await expect(page.locator('.listing-card')).toHaveCount(1);
  await page.locator('.listing-title').click();
  await expect(page.locator('.gallery-count')).toContainText('1 / 2');
  await page.getByRole('button', { name: 'Next listing photo' }).click();
  await expect(page.locator('.gallery-count')).toContainText('2 / 2');
  await expect(page.locator('#gallery-photo')).toHaveAttribute(
    'src',
    'https://photos.example/two.png',
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Buy from seller', exact: true })
    .click();
  await expect(page.getByRole('link', { name: 'Open eBay listing' })).toHaveAttribute(
    'href',
    'https://www.ebay.com/itm/123',
  );
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.goto('/#monitors');
  const card = page.locator('.monitor-card').filter({ hasText: 'Gallery fixture' });
  await card.getByRole('button', { name: 'Excel export' }).click();
  await page.getByLabel('From', { exact: true }).fill('2020-01-01T00:00');
  await page.getByLabel('Until (exclusive)').fill('2030-01-01T00:00');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Excel' }).click();
  expect((await download).suggestedFilename()).toBe(`part-scout-monitor-${monitor.id}.xlsx`);
  await request.delete(`/api/monitors/${monitor.id}`);
});
test('activity receives new imports without a manual refresh', async ({ page, request }) => {
  await page.goto('/#activity');
  await expect(page.locator('tbody tr').first()).toBeVisible();
  const count = await page.locator('tbody tr').count();
  const monitors = await (await request.get('/api/monitors')).json();
  await request.post(`/api/monitors/${monitors[0].id}/import`, {
    data: { listings: [], complete: false },
  });
  await expect(page.locator('tbody tr')).toHaveCount(count + 1, { timeout: 15000 });
});
