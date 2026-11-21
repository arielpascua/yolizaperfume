import { expect, test } from '@playwright/test';

test('the catalogue shows no price anywhere; the order page is one click away from every page', async ({ page }) => {
  const pages = ['/', '/collection', '/fragrance/narra-oud', '/enquiry', '/trade', '/about', '/legal/terms'];
  for (const p of pages) {
    await page.goto(p);
    const html = await page.content();
    expect(html, p).not.toContain('₱');
    const hrefs = await page.$$eval('a', (as) => as.map((a) => a.getAttribute('href') ?? ''));
    expect(hrefs, p).toContain('/checkout');
    // there is exactly one checkout address: never /checkout/<something>
    expect(hrefs.filter((h) => h.startsWith('/checkout/')), p).toEqual([]);
  }
});

test('browse, filter and open a fragrance', async ({ page }) => {
  await page.goto('/collection');
  await page.getByRole('link', { name: 'Citrus', exact: true }).first().click();
  await expect(page).toHaveURL(/family=citrus/);
  await expect(page.getByRole('status')).toContainText('2 of 15');
  await page.getByRole('link', { name: /Dalandan Sol/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dalandan Sol' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The notes' })).toBeVisible();
});

test('a trade enquiry can be sent from a fragrance page', async ({ page }) => {
  await page.goto('/fragrance/sampaguita-nocturne');
  await page.getByRole('link', { name: /Ask about samples/ }).click();
  await expect(page.getByText('Sampaguita Nocturne').first()).toBeVisible();
  await page.getByLabel('Company *').fill('Casa Bella');
  await page.getByLabel('Contact name *').fill('Ana Reyes');
  await page.getByLabel('Email *').fill('ana@casabella.example');
  await page.getByLabel('Type of business *').selectOption('boutique');
  await page.getByRole('button', { name: 'Send trade enquiry' }).click();
  await expect(page.getByText(/YZE-[0-9A-F]{10}/)).toBeVisible();
});

test('/checkout is open to anyone, shows trade prices, and nothing else is a checkout address', async ({ page }) => {
  const res = await page.goto('/checkout');
  expect(res?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: /Order by the case/ })).toBeVisible();
  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', /noindex/);
  await expect(page.getByLabel('Sampaguita Nocturne, 50 ml, cases')).toBeVisible();
  await expect(page.getByText('₱880').first()).toBeVisible(); // prices are here, and only here
  for (const p of ['/checkout/anything', '/checkout/v1.e30.AAAA']) {
    expect((await page.goto(p))?.status(), p).toBe(404);
  }
});

test('anyone can place an order on /checkout', async ({ page }) => {
  await page.goto('/checkout');

  await page.getByLabel('Sampaguita Nocturne, 50 ml, cases').fill('3');
  const docket = page.getByRole('complementary', { name: 'Order summary' });
  await expect(docket).toContainText('36'); // bottles
  await expect(docket).toContainText('₱31,680');

  await page.getByLabel('Company *').fill('Casa Bella');
  await page.getByLabel('Contact name *').fill('Ana Reyes');
  await page.getByLabel('Email *').fill('ana@casabella.example');
  await page.getByLabel('Phone *').fill('+63 917 000 0000');
  await page.getByLabel('Street address *').fill('1 Rizal St');
  await page.getByLabel('City or municipality *').fill('Cebu City');
  await page.getByLabel('Postal code *').fill('6000');
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page.getByText(/YZ-[0-9A-F]{10}/)).toBeVisible();
  await expect(page.getByText(/Nothing has been charged/)).toBeVisible();
});

test('an order under the minimum is refused with a clear message', async ({ page }) => {
  await page.goto('/checkout');
  await page.getByLabel('Sampaguita Nocturne, 10 ml travel, cases').fill('1');
  await page.getByLabel('Company *').fill('Casa Bella');
  await page.getByLabel('Contact name *').fill('Ana Reyes');
  await page.getByLabel('Email *').fill('ana@casabella.example');
  await page.getByLabel('Phone *').fill('+63 917 000 0000');
  await page.getByLabel('Street address *').fill('1 Rizal St');
  await page.getByLabel('City or municipality *').fill('Cebu City');
  await page.getByLabel('Postal code *').fill('6000');
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page.getByText(/The minimum order is/)).toBeVisible();
});
