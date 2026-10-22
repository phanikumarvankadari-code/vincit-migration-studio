import { expect, test } from '@playwright/test';
import { addProfitCenterSources, goToStage, loadTarget, openApp } from './helpers';

/**
 * Against a real Ollama on this computer, on the real Profit Center files. Slow (a model has to answer), so it only
 * runs when asked: `MMS_REAL_OLLAMA=1 npm run e2e -- ai-real-ollama`.
 */
test.describe('Real Ollama (opt in)', () => {
  test.skip(
    process.env['MMS_REAL_OLLAMA'] !== '1',
    'set MMS_REAL_OLLAMA=1 to run against a real Ollama',
  );
  test.setTimeout(600_000);

  test('one click on AI suggest finds the local model and returns suggestions from it', async ({
    page,
  }) => {
    const reachable = await fetch('http://127.0.0.1:11434/api/tags').then(
      (r) => r.ok,
      () => false,
    );
    test.skip(!reachable, 'Ollama is not running on 127.0.0.1:11434');

    await openApp(page);
    await addProfitCenterSources(page, true);
    await loadTarget(page);
    await goToStage(page, 'map');
    await page.getByRole('tab', { name: 'Visual Mapper' }).click();
    const started = Date.now();
    await page.getByTestId('ai-suggest').click();

    // no settings were needed: the app picked a local chat model by itself
    await expect(page.getByTestId('graph-message')).toContainText(
      /\d+ suggestions? \(\d+ with AI, /,
      { timeout: 540_000 },
    );
    console.log(`AI suggest took ${Math.round((Date.now() - started) / 1000)} s`);
    await expect(page.getByRole('dialog', { name: 'AI settings' })).toHaveCount(0);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mms:ai') ?? '{}'));
    expect(stored.provider).toBe('ollama');
    expect(stored.model).not.toMatch(/bge|embed|cloud/i);
    const message = await page.getByTestId('graph-message').innerText();
    expect(message).toContain(stored.model);
    const withAi = Number(/\((\d+) with AI/.exec(message)![1]);
    expect(withAi).toBeGreaterThan(0);

    // an AI suggestion carries its origin and a confidence, and can be accepted
    const aiRow = page
      .locator('[data-testid^="suggestion-"]', { has: page.getByText(/^(AI|Rules and AI)$/) })
      .first();
    await expect(aiRow).toBeVisible();
    await expect(aiRow).toContainText(/\d+% (High|Medium|Low)/);
    await aiRow.getByRole('button', { name: 'Accept' }).click();
    await expect(page.getByTestId('graph-message')).toHaveText('1 mapping created.');
  });

  test('Ask AI for a value suggests a usable date for a start date', async ({ page }) => {
    const reachable = await fetch('http://127.0.0.1:11434/api/tags').then(
      (r) => r.ok,
      () => false,
    );
    test.skip(!reachable, 'Ollama is not running on 127.0.0.1:11434');

    await openApp(page);
    await addProfitCenterSources(page, true);
    await loadTarget(page);
    await goToStage(page, 'map');
    await page.getByTestId('row-Profit Center-Valid From').click();
    await page.getByLabel('Mapping type').selectOption('constant');
    await page.getByLabel('Constant datatype').selectOption('date');
    await page.getByTestId('ask-ai-value').click();
    const ai = page.getByTestId('value-ai');
    await expect(ai).toBeVisible({ timeout: 240_000 });
    console.log(`AI value: ${await ai.innerText()}`);
    await expect(ai).toContainText(/\d{4}-\d{2}-\d{2}/);
    await expect(ai.getByRole('button', { name: 'Use this value' })).toBeEnabled();
  });
});
