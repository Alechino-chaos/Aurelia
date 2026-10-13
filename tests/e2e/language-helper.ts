import { expect, type Page } from '@playwright/test';

/** Existing regression profiles establish their Chinese baseline through the real first-choice UI. */
export async function establishChinese(page: Page) {
  await page.locator('[data-workspace-ready="true"], .language-welcome input[type="radio"]').first().waitFor();
  const choice = page.getByRole('radio', { name: '简体中文', exact: true });
  if (await choice.isVisible()) {
    await choice.check(); await page.getByRole('button', { name: '确认并继续 / Confirm and continue' }).click();
  }
  await expect(page.locator('[data-workspace-ready="true"]')).toBeVisible();
}
export async function openAiSettings(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: 'AI 服务', exact: true }).click();
}
