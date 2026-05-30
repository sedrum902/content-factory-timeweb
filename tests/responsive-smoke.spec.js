import { test, expect } from '@playwright/test';

test.describe('Responsive smoke', () => {
  test('auth screen loads and has no horizontal scroll', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('#authScreen')).toBeVisible();
    await expect(page.locator('#emailInput')).toBeVisible();
    await expect(page.locator('#passwordInput')).toBeVisible();

    const noHorizontalOverflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return doc.scrollWidth <= window.innerWidth + 1;
    });

    expect(noHorizontalOverflow).toBe(true);
  });

  test('app shell can be rendered and nav opens without overflow', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => {
      const auth = document.getElementById('authScreen');
      const app = document.getElementById('app');
      const burger = document.getElementById('burgerBtn');
      if (auth) auth.style.display = 'none';
      if (app) app.style.display = 'block';
      if (burger) burger.click();
    });

    const nav = page.locator('#nav');
    await expect(nav).toBeVisible();

    const noHorizontalOverflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return doc.scrollWidth <= window.innerWidth + 1;
    });

    expect(noHorizontalOverflow).toBe(true);
  });
});
