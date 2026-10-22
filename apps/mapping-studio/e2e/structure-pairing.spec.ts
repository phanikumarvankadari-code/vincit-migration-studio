import { expect, test, type Page } from '@playwright/test';
import { csv, goToStage, loadTargetText, openApp } from './helpers';

/** Source and target with nothing in common but their fields: the names of datasets and structures differ completely. */
const KNA1 = csv(
  'KNA1.csv',
  ['Customer Number,Name,City,Country', 'C100,Acme,Helsinki,FI', 'C200,Beta,Stockholm,SE'].join(
    '\n',
  ),
);
const VBAK = csv(
  'VBAK.csv',
  ['Order Number,Order Date,Customer Number', 'O1,1/1/26,C100', 'O2,2/1/26,C200'].join('\n'),
);
const TARGET = [
  'Structure,Field,Type,Length,Importance,Key',
  'Business Partner,Customer Number,Text,10,mandatory,X',
  'Business Partner,Name,Text,40,mandatory,',
  'Business Partner,City,Text,40,,',
  'Business Partner,Country,Text,3,,',
  'Sales Order,Order Number,Text,10,mandatory,X',
  'Sales Order,Order Date,Date,,mandatory,',
  'Sales Order,Customer Number,Text,10,mandatory,',
  'Sales Order,City,Text,40,,',
].join('\n');

/** Unrelated to every other dataset: no join, so it is outside the scope of any pair. */
const NOTES = csv('NOTES.csv', ['Remark,Author', 'call back,AB', 'send offer,CD'].join('\n'));

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};
const INSTALLED = [
  { name: 'bge-m3:latest', details: { family: 'bert', parameter_size: '566.70M' } },
  { name: 'gemma4:latest', details: { family: 'gemma4', parameter_size: '8.0B' } },
];

async function setUp(page: Page, extra: ReturnType<typeof csv>[] = []): Promise<void> {
  await openApp(page);
  await page.getByTestId('source-files-input').setInputFiles([KNA1, VBAK, ...extra]);
  await expect(page.getByTestId('dataset-KNA1')).toBeVisible();
  await expect(page.getByTestId('dataset-VBAK')).toBeVisible();
  await loadTargetText(page, TARGET);
  await goToStage(page, 'map');
  await page.getByRole('tab', { name: '1 · Structures' }).click();
  await expect(page.getByTestId('structure-mapper')).toBeVisible();
}

/** A model that answers the pairing question from the short ids in the prompt: target name to dataset name. */
async function mockPairs(
  page: Page,
  picks: Record<string, { driver: string | null; confidence: number; reason?: string }>,
) {
  const sent: { system: string; user: string }[] = [];
  await page.route('http://127.0.0.1:11434/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (req.url().endsWith('/api/tags'))
      return route.fulfill({
        status: 200,
        headers: CORS,
        contentType: 'application/json',
        body: JSON.stringify({ models: INSTALLED }),
      });
    const body = req.postDataJSON() as { messages: { content: string }[] };
    const [system, user] = body.messages.map((m) => m.content) as [string, string];
    sent.push({ system, user });
    const prompt = JSON.parse(user) as {
      targets: { id: string; name: string }[];
      datasets: { id: string; name: string }[];
    };
    const pairs = prompt.targets.map((t) => {
      const p = picks[t.name];
      return {
        target: t.id,
        driver: p?.driver ? (prompt.datasets.find((d) => d.name === p.driver)?.id ?? null) : null,
        helpers: [],
        confidence: p?.confidence ?? 0,
        reason: p?.reason ?? '',
      };
    });
    return route.fulfill({
      status: 200,
      headers: CORS,
      contentType: 'application/json',
      body: JSON.stringify({ message: { content: JSON.stringify({ pairs }) } }),
    });
  });
  return { sent };
}

test.describe('Structure pairing (SPEC-037)', () => {
  test('AC-5 the Structures step lists datasets and structures, and says which structures have no source yet', async ({
    page,
  }) => {
    await setUp(page);
    await expect(page.getByTestId('ds-card-KNA1')).toContainText('4 fields · 2 rows');
    await expect(page.getByTestId('ds-card-VBAK')).toContainText('3 fields');
    await expect(page.getByTestId('unused-KNA1')).toBeVisible();
    await expect(page.getByTestId('unpaired-Business Partner')).toHaveText('No source yet');
    await expect(page.getByTestId('unpaired-Sales Order')).toBeVisible();
    await expect(page.getByTestId('unpaired-banner')).toContainText(
      '2 of 2 target structures have no source dataset yet',
    );
  });

  test('AC-5 suggest pairs by the fields although no name matches; each shows confidence, origin and coverage; accept pairs it', async ({
    page,
  }) => {
    await setUp(page);
    await page.getByRole('button', { name: 'Suggest pairs', exact: true }).click();
    const bp = page.getByTestId('pair-suggestion-Business Partner');
    await expect(bp).toContainText('KNA1 → Business Partner');
    await expect(page.getByTestId('pair-confidence-Business Partner')).toContainText('High');
    await expect(page.getByTestId('pair-origin-Business Partner')).toHaveText('Rules');
    await expect(page.getByTestId('pair-reasons-Business Partner')).toContainText(
      'KNA1 has a matching field for 4 of 4 target fields',
    );
    await expect(page.getByTestId('pair-reasons-Business Partner')).toContainText(
      '2 of 2 required fields',
    );
    await expect(page.getByTestId('pair-suggestion-Sales Order')).toContainText(
      'VBAK → Sales Order',
    );
    // drawn as dashed lines with the confidence on them, nothing is paired yet
    await expect(page.getByTestId('pair-suggest-Business Partner')).toHaveAttribute(
      'stroke',
      '#1E8A52',
    );
    await expect(page.getByTestId('pair-score-Business Partner')).toContainText('Rules');
    await expect(page.getByTestId('paired-Business Partner')).toHaveCount(0);
    await bp.getByRole('button', { name: 'Accept' }).click();
    await expect(page.getByTestId('paired-Business Partner')).toHaveText('Paired');
    await expect(page.getByTestId('pair-coverage-Business Partner')).toContainText(
      'Rows come from KNA1: 4 of 4 fields have a matching source field, 2 of 2 required',
    );
    await expect(page.getByTestId('pair-line-Business Partner')).toHaveCount(1);
    await expect(page.getByTestId('ds-card-KNA1')).toContainText('Drives Business Partner');
    await expect(page.getByTestId('unused-KNA1')).toHaveCount(0);
    await expect(page.getByTestId('unpaired-banner')).toContainText(
      '1 of 2 target structure has no source',
    );
    await expect(page.getByTestId('pair-suggestion-Business Partner')).toHaveCount(0);
    await expect(page.getByTestId('undo-bar')).toContainText(
      'Source dataset set for Business Partner',
    );
  });

  test('Accept all High pairs every strong suggestion without a conflict; Undo takes it back', async ({
    page,
  }) => {
    await setUp(page);
    await page.getByRole('button', { name: 'Suggest pairs', exact: true }).click();
    await page.getByRole('button', { name: /Accept all High/ }).click();
    // Sales Order has a field (City) that VBAK lacks: Medium, so it is left for a click
    await expect(page.getByTestId('pair-message')).toHaveText('1 structure paired.');
    await expect(page.getByTestId('paired-Business Partner')).toBeVisible();
    await expect(page.getByTestId('pair-confidence-Sales Order')).toContainText('Medium');
    await page.getByTestId('undo-bar').getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId('unpaired-Business Partner')).toBeVisible();
    await expect(page.getByTestId('unpaired-Sales Order')).toBeVisible();
  });

  test('a pair can be set by hand, changed and removed, each with Undo', async ({ page }) => {
    await setUp(page);
    await page.getByTestId('driver-select-Sales Order').selectOption({ label: 'KNA1' });
    await expect(page.getByTestId('paired-Sales Order')).toBeVisible();
    await expect(page.getByTestId('pair-coverage-Sales Order')).toContainText(
      'Rows come from KNA1',
    );
    await page.getByTestId('driver-select-Sales Order').selectOption({ label: 'VBAK' });
    await expect(page.getByTestId('pair-coverage-Sales Order')).toContainText(
      'Rows come from VBAK',
    );
    await page.getByTestId('remove-pair-Sales Order').click();
    await expect(page.getByTestId('unpaired-Sales Order')).toBeVisible();
    await expect(page.getByTestId('undo-bar')).toContainText(
      'Source dataset removed from Sales Order',
    );
    await page.getByTestId('undo-bar').getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId('paired-Sales Order')).toBeVisible();
    await expect(page.getByTestId('pair-coverage-Sales Order')).toContainText(
      'Rows come from VBAK',
    );
  });

  test('a dataset joined to the driver is shown with its join; a suggested join can be confirmed there', async ({
    page,
  }) => {
    await setUp(page);
    await page.getByTestId('driver-select-Sales Order').selectOption({ label: 'VBAK' });
    const helpers = page.getByTestId('helpers-Sales Order');
    await expect(helpers).toContainText('KNA1 · join suggested');
    await helpers.getByRole('button', { name: /Confirm join/ }).click();
    await expect(helpers).toContainText('KNA1 · join confirmed');
    await expect(page.getByTestId('helper-line-Sales Order-KNA1')).toHaveCount(1);
    await expect(page.getByTestId('ds-card-KNA1')).toContainText('Helps Sales Order');
  });

  test('AC-6 AI suggest pairs: the model sees names and fields only; a disagreement is a conflict and is not accepted in bulk', async ({
    page,
  }) => {
    const mock = await mockPairs(page, {
      'Business Partner': { driver: 'KNA1', confidence: 90, reason: 'customer master' },
      'Sales Order': { driver: 'KNA1', confidence: 97, reason: 'has the customer number' },
    });
    await setUp(page);
    await page.getByTestId('ai-suggest-pairs').click();
    await expect(page.getByTestId('pair-message')).toContainText('with AI, gemma4:latest');
    expect(mock.sent).toHaveLength(1);
    expect(mock.sent[0]!.system).toContain('You see no data values');
    for (const v of ['C100', 'C200', 'Helsinki', 'O1', '1/1/26'])
      expect(mock.sent[0]!.user).not.toContain(v);
    expect(mock.sent[0]!.user).toContain('Customer Number');
    // agreement on Business Partner: raised and marked as both
    await expect(page.getByTestId('pair-origin-Business Partner')).toHaveText('Rules and AI');
    // disagreement on Sales Order: the AI is more sure, the rules' VBAK is kept as the other candidate
    await expect(page.getByTestId('pair-origin-Sales Order')).toHaveText('AI');
    await expect(page.getByTestId('pair-conflict-Sales Order')).toBeVisible();
    await expect(page.getByTestId('pair-suggestion-Sales Order')).toContainText(
      'KNA1 → Sales Order',
    );
    await expect(page.getByTestId('pair-reasons-Sales Order')).toContainText('also: VBAK');
    await expect(page.getByTestId('pair-suggest-alt-Sales Order')).toHaveCount(1);
    await page.getByRole('button', { name: /Accept all High/ }).click();
    await expect(page.getByTestId('pair-message')).toHaveText('1 structure paired.');
    await expect(page.getByTestId('paired-Business Partner')).toBeVisible();
    await expect(page.getByTestId('unpaired-Sales Order')).toBeVisible(); // the conflict is left for a decision
  });

  test('AI suggest pairs when Ollama is not running says what to do and keeps the rule-based pairs', async ({
    page,
  }) => {
    await page.route('http://127.0.0.1:11434/**', (route) => route.abort());
    await setUp(page);
    await page.getByTestId('ai-suggest-pairs').click();
    await expect(page.getByTestId('pair-message')).toContainText('Cannot reach Ollama');
    await expect(page.getByRole('dialog', { name: 'AI settings' })).toBeVisible();
  });
});

test.describe('Fields step in the scope of the pair (SPEC-037)', () => {
  async function paired(
    page: Page,
    structure = 'Sales Order',
    extra: ReturnType<typeof csv>[] = [],
  ): Promise<void> {
    await setUp(page, extra);
    await page.getByRole('button', { name: 'Suggest pairs', exact: true }).click();
    await page.getByRole('button', { name: /Accept all High/ }).click();
    await page
      .getByTestId('pair-suggestion-Sales Order')
      .getByRole('button', { name: 'Accept' })
      .click();
    await expect(page.getByTestId('unpaired-banner')).toHaveCount(0);
    await page.getByRole('tab', { name: '2 · Fields' }).click();
    await page.getByRole('tab', { name: 'Visual Mapper' }).click();
    await expect(page.getByTestId('mapper')).toBeVisible();
    await page.getByLabel('Structure', { exact: true }).selectOption({ label: structure });
  }

  test('the pair is shown first; datasets of another structure are closed and marked', async ({
    page,
  }) => {
    await paired(page, 'Business Partner', [NOTES]);
    await expect(page.getByTestId('scope-tag-KNA1')).toHaveText('Driver');
    await expect(page.getByTestId('scope-tag-NOTES')).toHaveText('Other structure');
    const groups = await page
      .locator('[data-testid^="dataset-group-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(groups).toEqual(['dataset-group-KNA1', 'dataset-group-VBAK', 'dataset-group-NOTES']);
    await expect(page.getByTestId('dataset-group-KNA1')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('dataset-group-NOTES')).toHaveAttribute('aria-expanded', 'false');
    await page.getByTestId('dataset-group-NOTES').click();
    await expect(page.getByTestId('dataset-group-NOTES')).toHaveAttribute('aria-expanded', 'true');
  });

  test('a joined dataset is in the scope of the pair and is tagged Joined', async ({ page }) => {
    await paired(page);
    await expect(page.getByTestId('scope-tag-VBAK')).toHaveText('Driver');
    await expect(page.getByTestId('scope-tag-KNA1')).toHaveText('Joined');
    await page.getByRole('button', { name: 'Suggest mappings' }).click();
    // Sales Order has a City field and only the joined KNA1 has a City column
    const city = page.locator('[data-testid^="suggestion-"]', { hasText: 'KNA1.City' });
    await expect(city).toHaveCount(1);
    await expect(city).not.toContainText('another structure');
    await expect(
      page.locator('[data-testid^="suggestion-"]', { hasText: 'VBAK.Order Number' }),
    ).toHaveCount(1);
    await expect(page.getByLabel('Also look in other structures')).toBeVisible();
  });

  test('AI field suggestions are asked about the pair only: only datasets in scope, not the others', async ({
    page,
  }) => {
    const sent: string[] = [];
    await page.route('http://127.0.0.1:11434/**', async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      if (req.url().endsWith('/api/tags'))
        return route.fulfill({
          status: 200,
          headers: CORS,
          contentType: 'application/json',
          body: JSON.stringify({ models: INSTALLED }),
        });
      const body = req.postDataJSON() as { messages: { content: string }[] };
      sent.push(body.messages[1]!.content);
      return route.fulfill({
        status: 200,
        headers: CORS,
        contentType: 'application/json',
        body: JSON.stringify({ message: { content: '{"mappings":[]}' } }),
      });
    });
    await paired(page, 'Business Partner', [NOTES]);
    await page.getByTestId('ai-suggest').click();
    await expect(page.getByTestId('graph-message')).toContainText('suggestion');
    expect(sent).toHaveLength(1);
    const user = JSON.parse(sent[0]!) as { sources: { dataset: string }[] };
    expect([...new Set(user.sources.map((s) => s.dataset))].sort()).toEqual(['KNA1', 'VBAK']);
  });

  test('without a pair the Fields step offers to pair first, and the button leads there', async ({
    page,
  }) => {
    await openApp(page);
    await page.getByTestId('source-files-input').setInputFiles([KNA1, VBAK]);
    await loadTargetText(page, TARGET);
    await goToStage(page, 'map');
    await expect(page.getByTestId('pair-hint')).toContainText(
      '2 of 2 target structures have no source dataset yet',
    );
    await page.getByRole('button', { name: 'Pair structures' }).click();
    await expect(page.getByTestId('structure-mapper')).toBeVisible();
  });
});
