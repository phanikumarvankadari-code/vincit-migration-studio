import { expect, test, type Page } from '@playwright/test';
import {
  addSmallSources,
  goToStage,
  loadTargetText,
  openApp,
  openEditor,
  setUpSmallMapping,
  status,
} from './helpers';

const src = (page: Page, n: number) => page.getByTestId(`src-f-CEPC-${n}`); // 1 Profit Center, 2 Valid To, 3 Valid From, 4 Country
const tgt = (page: Page, n: number) => page.getByTestId(`tgt-tf-Profit-Center-${n}`); // 1 Profit Center, 2 Valid From, 3 Region, 4 Language
const T = (n: number) => `tf-Profit-Center-${n}`;

async function openVisual(page: Page) {
  await page.getByRole('tab', { name: 'Visual Mapper' }).click();
  await expect(page.getByTestId('mapper')).toBeVisible();
}

const OLLAMA_SETTINGS = {
  provider: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  model: 'llama3.1:8b',
  apiKey: '',
};

async function seedAi(page: Page, settings: object): Promise<void> {
  await page.addInitScript(
    (s) => window.localStorage.setItem('mms:ai', JSON.stringify(s)),
    settings,
  );
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};

/** What an Ollama on a real machine lists: an embedding model, local chat models and a cloud model. */
const INSTALLED = [
  { name: 'bge-m3:latest', details: { family: 'bert', parameter_size: '566.70M' } },
  { name: 'gemma4:latest', details: { family: 'gemma4', parameter_size: '8.0B' } },
  {
    name: 'qwen3-coder:480b-cloud',
    remote_host: 'https://ollama.com:443',
    details: { family: 'qwen3moe', parameter_size: '480B' },
  },
  { name: 'qwen3-coder:latest', details: { family: 'qwen3moe', parameter_size: '30.5B' } },
];

type Pick = { source: string | null; confidence: number; reason?: string };

/** Builds the model's answer from the short ids in the prompt: target name to "Dataset.Field" (or null). */
function mappingAnswer(
  prompt: {
    targets: { id: string; name: string }[];
    sources: { id: string; dataset: string; name: string }[];
  },
  picks: Record<string, Pick>,
) {
  const sid = (full: string) =>
    prompt.sources.find((s) => `${s.dataset}.${s.name}` === full)?.id ?? null;
  return {
    mappings: prompt.targets.map((t) => {
      const p = picks[t.name] ?? { source: null, confidence: 0 };
      return {
        target: t.id,
        source: p.source ? sid(p.source) : null,
        confidence: p.confidence,
        reason: p.reason ?? '',
      };
    }),
  };
}

/** A model on this computer, answered by the test. `sent` collects every request so the data sent can be checked. */
async function mockOllama(
  page: Page,
  options: {
    picks?: Record<string, Pick>;
    value?: { value: string; confidence: number; reason: string };
    /** Wait this long before answering a question. */
    delayMs?: number;
    models?: object[];
  } = {},
): Promise<{ sent: { system: string; user: string; model: string; think: unknown }[] }> {
  const sent: { system: string; user: string; model: string; think: unknown }[] = [];
  await page.route('http://127.0.0.1:11434/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (req.url().endsWith('/api/tags'))
      return route.fulfill({
        status: 200,
        headers: CORS,
        contentType: 'application/json',
        body: JSON.stringify({ models: options.models ?? INSTALLED }),
      });
    const body = req.postDataJSON() as {
      model: string;
      think?: unknown;
      messages: { role: string; content: string }[];
    };
    const [system, user] = body.messages.map((m) => m.content) as [string, string];
    sent.push({ system, user, model: body.model, think: body.think });
    if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
    const answer = system.includes('ONE fixed value')
      ? (options.value ?? { value: '', confidence: 0, reason: '' })
      : mappingAnswer(JSON.parse(user), options.picks ?? {});
    return route.fulfill({
      status: 200,
      headers: CORS,
      contentType: 'application/json',
      body: JSON.stringify({ message: { content: JSON.stringify(answer) } }),
    });
  });
  return { sent };
}

const PICKS: Record<string, Pick> = {
  'Profit Center': { source: 'CEPC.Profit Center', confidence: 90, reason: 'same key field' },
  'Valid From': { source: 'CEPC.Valid To', confidence: 70, reason: 'a validity date' },
  Region: { source: 'CEPC.Country', confidence: 78, reason: 'country decides the region' },
  Language: { source: null, confidence: 0 },
};

test.describe('AI suggestions, confidence and conflicts (SPEC-036)', () => {
  test('AC-5 AI suggest shows each suggestion with its confidence band and where it came from', async ({
    page,
  }) => {
    await seedAi(page, OLLAMA_SETTINGS);
    await mockOllama(page, { picks: PICKS });
    await setUpSmallMapping(page);
    await openVisual(page);
    await page.getByTestId('ai-suggest').click();
    // rules and AI agree on the key: raised, High, both
    await expect(page.getByTestId(`confidence-${T(1)}`)).toHaveText('95% High');
    await expect(page.getByTestId(`origin-${T(1)}`)).toHaveText('Rules and AI');
    // only the AI sees Country for Region: Medium, AI
    await expect(page.getByTestId(`confidence-${T(3)}`)).toHaveText('78% Medium');
    await expect(page.getByTestId(`origin-${T(3)}`)).toHaveText('AI');
    await expect(page.getByTestId(`suggestion-${T(3)}`)).toContainText(
      'country decides the region',
    );
    // the model found nothing for Language, and the rules have nothing either
    await expect(page.getByTestId(`suggestion-${T(4)}`)).toHaveCount(0);
    await expect(page.getByTestId('graph-message')).toContainText('with AI');
    // the dashed line carries the band colour (High is green) and its percentage
    await expect(page.getByTestId(`suggest-${T(1)}`)).toHaveAttribute('stroke', '#1E8A52');
    await expect(page.getByTestId(`score-${T(1)}`)).toContainText('95% · Rules+AI');
  });

  test('only field metadata is sent to the model: no row values', async ({ page }) => {
    await seedAi(page, OLLAMA_SETTINGS);
    const { sent } = await mockOllama(page, { picks: PICKS });
    await setUpSmallMapping(page);
    await openVisual(page);
    await page.getByTestId('ai-suggest').click();
    await expect(page.getByTestId(`confidence-${T(1)}`)).toBeVisible();
    expect(sent).toHaveLength(1);
    const text = `${sent[0]!.system} ${sent[0]!.user}`;
    for (const value of ['P100', 'P200', 'P300', 'FI01', 'FI02', '12/31/99', '13/45/26'])
      expect(text).not.toContain(value);
    expect(sent[0]!.user).toContain('Valid From');
    expect(sent[0]!.system).toContain('You see no data values');
  });

  test('a disagreement between the rules and the AI is a conflict, shown in the mapper and in the table', async ({
    page,
  }) => {
    await seedAi(page, OLLAMA_SETTINGS);
    await mockOllama(page, { picks: PICKS });
    await setUpSmallMapping(page);
    await openVisual(page);
    await page.getByTestId('ai-suggest').click();
    // Valid From: the AI prefers Valid To (70%), the rules prefer Valid From (60%)
    await expect(page.getByTestId(`sg-conflict-${T(2)}`)).toBeVisible();
    await expect(page.getByTestId(`suggestion-${T(2)}`)).toContainText('CEPC.Valid To');
    await expect(page.getByTestId(`suggest-alt-${T(2)}`)).toHaveCount(1); // the other candidate, drawn lighter
    await expect(page.getByTestId('conflict-suggestionDisagree')).toContainText(
      'Suggestions disagree for Valid From',
    );
    await expect(page.getByTestId(`tgt-conflict-${T(2)}`)).toBeVisible();
    // the same conflict in the Mapping Table
    await page.getByRole('tab', { name: 'Mapping Table' }).click();
    await expect(page.getByTestId('conflicts-Profit Center-Valid From')).toContainText(
      'Suggestions disagree',
    );
    await expect(page.getByTestId('suggestion-cell-Profit Center-Valid From')).toContainText(
      'CEPC.Valid To',
    );
    await page.getByLabel('Filter by conflicts').selectOption('has');
    await expect(page.getByTestId('table-count')).toHaveText('1 of 6 fields');
    await expect(page.getByTestId('row-Profit Center-Valid From')).toBeVisible();
  });

  test('Accept all applies only High suggestions without a conflict; each one can also be accepted or rejected', async ({
    page,
  }) => {
    await seedAi(page, OLLAMA_SETTINGS);
    await mockOllama(page, { picks: PICKS });
    await setUpSmallMapping(page);
    await openVisual(page);
    await page.getByTestId('ai-suggest').click();
    await page.getByRole('button', { name: /Accept all High/ }).click();
    await expect(page.getByTestId('graph-message')).toHaveText('1 mapping created.');
    await expect(page.getByTestId(`link-${T(1)}`)).toHaveCount(1);
    await expect(page.getByTestId(`suggestion-${T(2)}`)).toBeVisible(); // conflict: left for a decision
    await expect(page.getByTestId(`suggestion-${T(3)}`)).toBeVisible(); // Medium: left for a decision
    await page
      .getByTestId(`suggestion-${T(3)}`)
      .getByRole('button', { name: 'Accept' })
      .click();
    await expect(page.getByTestId(`link-${T(3)}`)).toHaveCount(1);
    await page
      .getByTestId(`suggestion-${T(2)}`)
      .getByRole('button', { name: 'Reject' })
      .click();
    await expect(page.getByTestId(`suggestion-${T(2)}`)).toHaveCount(0);
    await expect(tgt(page, 2)).toContainText('Unmapped');
  });

  test('table: accept and reject a suggestion in the row', async ({ page }) => {
    await seedAi(page, OLLAMA_SETTINGS);
    await mockOllama(page, { picks: PICKS });
    await setUpSmallMapping(page);
    await openVisual(page);
    await page.getByTestId('ai-suggest').click();
    await expect(page.getByTestId(`confidence-${T(3)}`)).toBeVisible();
    await page.getByRole('tab', { name: 'Mapping Table' }).click();
    await page.getByRole('button', { name: 'Accept suggestion for Region' }).click();
    await expect(status(page, 'Profit Center', 'Region')).toHaveText('Mapped');
    await expect(page.getByTestId('row-Profit Center-Region')).toContainText('CEPC.Country');
    await page.getByRole('button', { name: 'Reject suggestion for Valid From' }).click();
    await expect(page.getByTestId('suggestion-cell-Profit Center-Valid From')).toHaveText('');
  });

  test('AC-7 when the model cannot be reached the message says what to do, and the rule-based suggestions still work', async ({
    page,
  }) => {
    await seedAi(page, OLLAMA_SETTINGS);
    await page.route('http://127.0.0.1:11434/**', (route) => route.abort());
    await setUpSmallMapping(page);
    await openVisual(page);
    await page.getByTestId('ai-suggest').click();
    await expect(page.getByTestId('graph-message')).toContainText(
      'Cannot reach Ollama at http://127.0.0.1:11434',
    );
    await expect(page.getByTestId('graph-message')).toContainText(
      'rule-based suggestions are still available',
    );
    await expect(page.getByTestId(`suggestion-${T(1)}`)).toContainText('Rules');
    await page
      .getByTestId(`suggestion-${T(1)}`)
      .getByRole('button', { name: 'Accept' })
      .click();
    await expect(page.getByTestId('graph-message')).toHaveText('1 mapping created.');
  });

  test('one click is enough: with no settings the app finds Ollama, picks a local chat model, saves it and shows suggestions', async ({
    page,
  }) => {
    const mock = await mockOllama(page, { picks: PICKS });
    await setUpSmallMapping(page);
    await openVisual(page);
    await page.getByTestId('ai-suggest').click();
    await expect(page.getByTestId(`confidence-${T(1)}`)).toHaveText('95% High');
    // not the embedding model, not the cloud model, not the coder model
    await expect(page.getByTestId('graph-message')).toContainText('gemma4:latest');
    expect(mock.sent[0]!.model).toBe('gemma4:latest');
    expect(mock.sent[0]!.think).toBe(false);
    await expect(page.getByRole('dialog', { name: 'AI settings' })).toHaveCount(0);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mms:ai') ?? '{}'));
    expect(stored).toMatchObject({ provider: 'ollama', model: 'gemma4:latest' });
    // the next click goes straight to the model
    await page.getByTestId('ai-suggest').click();
    await expect(page.getByTestId('graph-message')).toContainText('gemma4:latest');
    expect(mock.sent).toHaveLength(2);
  });

  test('the settings list only chat models and mark cloud ones; Test connection picks a sensible default', async ({
    page,
  }) => {
    await mockOllama(page, { picks: PICKS });
    await setUpSmallMapping(page);
    await openVisual(page);
    await page.getByRole('button', { name: 'AI settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'AI settings' });
    await expect(dialog.getByTestId('ai-privacy')).toContainText('No row values are sent');
    await expect(dialog.getByTestId('ai-privacy')).toContainText('-cloud');
    await dialog.getByRole('button', { name: 'Test connection' }).click();
    await expect(dialog.getByTestId('ai-status')).toContainText('Connected. 3 models available.');
    const options = await dialog.getByLabel('Model').locator('option').allTextContents();
    expect(options).toEqual([
      'gemma4:latest',
      'qwen3-coder:480b-cloud (cloud: runs on Ollama’s servers)',
      'qwen3-coder:latest',
    ]);
    await expect(dialog.getByLabel('Model')).toHaveValue('gemma4:latest');
    await dialog.getByRole('button', { name: 'Save' }).click();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mms:ai') ?? '{}'));
    expect(stored.model).toBe('gemma4:latest');
  });

  test('with no settings and Ollama not running, the click says what to do and opens the AI settings', async ({
    page,
  }) => {
    await page.route('http://127.0.0.1:11434/**', (route) => route.abort());
    await setUpSmallMapping(page);
    await openVisual(page);
    await page.getByTestId('ai-suggest').click();
    await expect(page.getByTestId('graph-message')).toContainText('Cannot reach Ollama');
    await expect(page.getByTestId('graph-message')).toContainText('ollama serve');
    await expect(page.getByRole('dialog', { name: 'AI settings' })).toBeVisible();
  });

  test('with only an embedding model installed, the click says there is no chat model', async ({
    page,
  }) => {
    await mockOllama(page, { models: [INSTALLED[0]!, INSTALLED[2]!] });
    await setUpSmallMapping(page);
    await openVisual(page);
    await page.getByTestId('ai-suggest').click();
    await expect(page.getByTestId('graph-message')).toContainText(
      'no chat model that runs on this computer',
    );
    await expect(page.getByRole('dialog', { name: 'AI settings' })).toBeVisible();
  });

  test('a slow model can be stopped; the rule-based suggestions stay', async ({ page }) => {
    await seedAi(page, OLLAMA_SETTINGS);
    await mockOllama(page, { picks: PICKS, delayMs: 20_000 });
    await setUpSmallMapping(page);
    await openVisual(page);
    await page.getByTestId('ai-suggest').click();
    await expect(page.getByTestId('ai-busy')).toContainText('Asking llama3.1:8b');
    await expect(page.getByTestId('ai-suggest')).toBeDisabled();
    await page.getByTestId('ai-stop').click();
    await expect(page.getByTestId('graph-message')).toContainText('Stopped.');
    await expect(page.getByTestId('ai-busy')).toHaveCount(0);
    await expect(page.getByTestId(`suggestion-${T(1)}`)).toContainText('Rules');
    await expect(page.getByTestId('ai-suggest')).toBeEnabled();
  });

  test('an API key (Anthropic) can be used instead: it is sent as a header, kept in this browser and never with row values', async ({
    page,
  }) => {
    const seen: { key: string | undefined; browserAccess: string | undefined; body: string }[] = [];
    await page.route('https://api.anthropic.com/**', async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      if (req.url().includes('/v1/models'))
        return route.fulfill({
          status: 200,
          headers: CORS,
          contentType: 'application/json',
          body: JSON.stringify({ data: [{ id: 'claude-sonnet-5-5' }] }),
        });
      const h = req.headers();
      const body = req.postDataJSON() as { messages: { content: string }[] };
      seen.push({
        key: h['x-api-key'],
        browserAccess: h['anthropic-dangerous-direct-browser-access'],
        body: req.postData() ?? '',
      });
      const answer = mappingAnswer(JSON.parse(body.messages[0]!.content), PICKS);
      return route.fulfill({
        status: 200,
        headers: CORS,
        contentType: 'application/json',
        body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(answer) }] }),
      });
    });
    await setUpSmallMapping(page);
    await openVisual(page);
    await page.getByRole('button', { name: 'AI settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'AI settings' });
    await dialog.getByLabel('AI provider').selectOption('anthropic');
    await expect(dialog.getByTestId('ai-privacy')).toContainText('Anthropic’s API');
    await expect(dialog.getByLabel('API key')).toHaveAttribute('type', 'password');
    await dialog.getByLabel('API key').fill('sk-test-123');
    await dialog.getByRole('button', { name: 'Test connection' }).click();
    await expect(dialog.getByTestId('ai-status')).toContainText('Connected');
    await dialog.getByRole('button', { name: 'Save' }).click();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mms:ai') ?? '{}'));
    expect(stored).toMatchObject({
      provider: 'anthropic',
      apiKey: 'sk-test-123',
      model: 'claude-sonnet-5-5',
    });
    await page.getByTestId('ai-suggest').click();
    await expect(page.getByTestId(`confidence-${T(1)}`)).toHaveText('95% High');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.key).toBe('sk-test-123');
    expect(seen[0]!.browserAccess).toBe('true');
    for (const value of ['P100', 'FI01', '13/45/26']) expect(seen[0]!.body).not.toContain(value);
  });

  test('a wrong API key is reported as refused', async ({ page }) => {
    await seedAi(page, {
      provider: 'anthropic',
      baseUrl: '',
      model: 'claude-sonnet-5-5',
      apiKey: 'bad',
    });
    await page.route('https://api.anthropic.com/**', (route) =>
      route.request().method() === 'OPTIONS'
        ? route.fulfill({ status: 204, headers: CORS })
        : route.fulfill({
            status: 401,
            headers: CORS,
            contentType: 'application/json',
            body: '{}',
          }),
    );
    await setUpSmallMapping(page);
    await openVisual(page);
    await page.getByTestId('ai-suggest').click();
    await expect(page.getByTestId('graph-message')).toContainText('The API key was refused.');
  });
});

test.describe('Confidence on mappings in place (SPEC-036)', () => {
  test('the line and the target capsule take the colour of the match; clicking the capsule opens the mapping to resolve', async ({
    page,
  }) => {
    await setUpSmallMapping(page);
    await openVisual(page);
    await src(page, 1).dragTo(tgt(page, 1)); // same name: Medium
    await src(page, 4).dragTo(tgt(page, 3)); // Country into Region: no resemblance, Low
    await expect(page.getByTestId(`capsule-${T(1)}`)).toHaveText('Mapped · 60% Medium');
    await expect(page.getByTestId(`capsule-${T(1)}`)).toHaveAttribute('data-band', 'medium');
    await expect(page.getByTestId(`link-${T(1)}`)).toHaveAttribute('stroke', '#B36B00');
    await expect(page.getByTestId(`capsule-${T(3)}`)).toHaveText('Mapped · 0% Low');
    await expect(page.getByTestId(`link-${T(3)}`)).toHaveAttribute('stroke', '#6B7080');
    await page.getByTestId(`capsule-${T(3)}`).click();
    await expect(page.getByTestId('panel-confidence')).toContainText(
      'the names do not resemble each other',
    );
    await expect(page.getByTestId('panel-confidence')).toContainText(
      'Check that this is the right source field',
    );
    await expect(page.getByRole('button', { name: 'Edit mapping' })).toBeVisible();
  });
});

test.describe('Hard-coded values (SPEC-036)', () => {
  const TARGET = [
    'Structure,Field,Type,Length,Importance,Key',
    'Profit Center,Profit Center,Text,10,mandatory,X',
    'Profit Center,Valid From,Date,,mandatory,',
    'Profit Center,Valid To,Date,,mandatory,',
    'Profit Center,Language,Text,,,',
  ].join('\n');
  const VT = 'tf-Profit-Center-3';

  async function setUp(page: Page): Promise<void> {
    await openApp(page);
    await addSmallSources(page);
    await loadTargetText(page, TARGET);
    await goToStage(page, 'map');
    await openVisual(page);
  }

  test('a field nothing can fill can be hard-coded; for an end date the rules suggest the open end', async ({
    page,
  }) => {
    await setUp(page);
    await page.getByTestId(`tgt-${VT}`).click();
    await page.getByTestId('hard-code').click();
    await expect(page.getByTestId('mapping-editor')).toBeVisible();
    await expect(page.getByLabel('Mapping type')).toHaveValue('constant');
    await expect(page.getByLabel('Constant datatype')).toHaveValue('date');
    const rule = page.getByTestId('value-rule');
    await expect(rule).toContainText('9999-12-31');
    await expect(rule).toContainText('80% High');
    await expect(rule).toContainText('Rules');
    await rule.getByRole('button', { name: 'Use this value' }).click();
    await expect(page.getByLabel('Constant value')).toHaveValue('9999-12-31');
    await page.getByRole('button', { name: 'Save mapping' }).click();
    await expect(page.getByTestId(`capsule-${VT}`)).toHaveText('Mapped · Manual');
    await expect(page.getByTestId(`fn-${VT}`)).toContainText('Constant');
    await page.getByRole('tab', { name: 'Mapping Table' }).click();
    await expect(page.getByTestId('row-Profit Center-Valid To')).toContainText('9999-12-31');
  });

  test('the AI can suggest a date from the context; a value that is not a valid date cannot be used', async ({
    page,
  }) => {
    await seedAi(page, OLLAMA_SETTINGS);
    const mock = await mockOllama(page, {
      value: {
        value: '2026-01-01',
        confidence: 72,
        reason: 'start of the fiscal year in the migration',
      },
    });
    await setUp(page);
    await page.getByRole('tab', { name: 'Mapping Table' }).click();
    await page.getByRole('button', { name: 'Hard-code Profit Center Valid From' }).click();
    await expect(page.getByTestId('value-rule')).toHaveCount(0); // no rule for a start date
    await page.getByTestId('ask-ai-value').click();
    const ai = page.getByTestId('value-ai');
    await expect(ai).toContainText('2026-01-01');
    await expect(ai).toContainText('72% Medium');
    await expect(ai).toContainText('AI');
    await expect(ai).toContainText('start of the fiscal year');
    expect(mock.sent).toHaveLength(1);
    const user = JSON.parse(mock.sent[0]!.user) as {
      field: { name: string; type: string };
      siblings: { name: string }[];
      today: string;
    };
    expect(user.field).toMatchObject({ name: 'Valid From', type: 'date' });
    expect(user.siblings.map((x) => x.name)).toEqual(['Profit Center', 'Valid To', 'Language']);
    expect(user.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(mock.sent[0]!.user).not.toMatch(/P100|FI01/);
    await ai.getByRole('button', { name: 'Use this value' }).click();
    await expect(page.getByLabel('Constant value')).toHaveValue('2026-01-01');
    await page.getByRole('button', { name: 'Save mapping' }).click();
    await expect(page.getByTestId('row-Profit Center-Valid From')).toContainText('2026-01-01');
  });

  test('an AI answer that is not a date is shown but cannot be used', async ({ page }) => {
    await seedAi(page, OLLAMA_SETTINGS);
    await mockOllama(page, {
      value: { value: '31.12.2026', confidence: 60, reason: 'end of year' },
    });
    await setUp(page);
    await page.getByRole('tab', { name: 'Mapping Table' }).click();
    await openEditor(page, 'Profit Center', 'Valid From');
    await page.getByLabel('Mapping type').selectOption('constant');
    await page.getByLabel('Constant datatype').selectOption('date');
    await page.getByTestId('ask-ai-value').click();
    const ai = page.getByTestId('value-ai');
    await expect(ai).toContainText('not a valid date');
    await expect(ai.getByRole('button', { name: 'Use this value' })).toBeDisabled();
  });

  test('with no AI settings and Ollama not running, Ask AI for a value says so and opens the settings', async ({
    page,
  }) => {
    await page.route('http://127.0.0.1:11434/**', (route) => route.abort());
    await setUp(page);
    await page.getByRole('tab', { name: 'Mapping Table' }).click();
    await openEditor(page, 'Profit Center', 'Valid From');
    await page.getByLabel('Mapping type').selectOption('constant');
    await page.getByTestId('ask-ai-value').click();
    await expect(page.getByRole('dialog', { name: 'AI settings' })).toBeVisible();
  });
});

test.describe('Deleting mappings, with undo (SPEC-036)', () => {
  test('AC-6 table: remove one mapping from its row, then undo', async ({ page }) => {
    await setUpSmallMapping(page);
    await openVisual(page);
    await src(page, 1).dragTo(tgt(page, 1));
    await src(page, 4).dragTo(tgt(page, 4));
    await page.getByRole('tab', { name: 'Mapping Table' }).click();
    await page.getByRole('button', { name: 'Delete Profit Center Language' }).click();
    await expect(status(page, 'Profit Center', 'Language')).toHaveText('Unmapped');
    await expect(status(page, 'Profit Center', 'Profit Center')).toHaveText('Mapped');
    await expect(page.getByTestId('undo-bar')).toContainText('Mapping removed: Language');
    await page.getByTestId('undo-bar').getByRole('button', { name: 'Undo' }).click();
    await expect(status(page, 'Profit Center', 'Language')).toHaveText('Mapped');
    await expect(page.getByTestId('undo-bar')).toHaveCount(0);
  });

  test('AC-6 table: delete several selected mappings after a confirmation, then undo', async ({
    page,
  }) => {
    await setUpSmallMapping(page);
    await openVisual(page);
    await src(page, 1).dragTo(tgt(page, 1));
    await src(page, 4).dragTo(tgt(page, 3));
    await src(page, 4).dragTo(tgt(page, 4));
    await page.getByRole('tab', { name: 'Mapping Table' }).click();
    await expect(page.getByTestId('delete-selected')).toBeDisabled();
    await page.getByRole('checkbox', { name: 'Select Region' }).check();
    await page.getByRole('checkbox', { name: 'Select Language' }).check();
    await expect(page.getByTestId('delete-selected')).toHaveText('Delete selected (2)');
    await page.getByTestId('delete-selected').click();
    await expect(page.getByRole('dialog', { name: 'Delete mappings' })).toContainText(
      'You can undo this right after',
    );
    await page
      .getByRole('dialog', { name: 'Delete mappings' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(status(page, 'Profit Center', 'Region')).toHaveText('Unmapped');
    await expect(status(page, 'Profit Center', 'Language')).toHaveText('Unmapped');
    await expect(status(page, 'Profit Center', 'Profit Center')).toHaveText('Mapped');
    await expect(page.getByTestId('undo-bar')).toContainText('2 mappings removed');
    await page.getByTestId('undo-bar').getByRole('button', { name: 'Undo' }).click();
    await expect(status(page, 'Profit Center', 'Region')).toHaveText('Mapped');
    await expect(status(page, 'Profit Center', 'Language')).toHaveText('Mapped');
  });

  test('AC-6 table: select all selects every mapped row', async ({ page }) => {
    await setUpSmallMapping(page);
    await openVisual(page);
    await src(page, 1).dragTo(tgt(page, 1));
    await src(page, 4).dragTo(tgt(page, 3));
    await page.getByRole('tab', { name: 'Mapping Table' }).click();
    await page.getByRole('checkbox', { name: 'Select all mapped fields' }).check();
    await expect(page.getByTestId('delete-selected')).toHaveText('Delete selected (2)');
  });

  test('AC-6 mapper: Remove mapping and the Delete key both remove a mapping and offer undo', async ({
    page,
  }) => {
    await setUpSmallMapping(page);
    await openVisual(page);
    await src(page, 4).dragTo(tgt(page, 3));
    await tgt(page, 3).click();
    await page.getByRole('button', { name: 'Remove mapping', exact: true }).click();
    await expect(page.getByTestId(`link-${T(3)}`)).toHaveCount(0);
    await expect(page.getByTestId('undo-bar')).toBeVisible();
    await page.getByTestId('undo-bar').getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId(`link-${T(3)}`)).toHaveCount(1);
    await tgt(page, 3).click();
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('graph-message')).toHaveText('Mapping removed.');
    await expect(page.getByTestId(`link-${T(3)}`)).toHaveCount(0);
    await page.getByTestId('undo-bar').getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId(`link-${T(3)}`)).toHaveCount(1);
  });
});

test.describe('Conflicts in mappings in place (SPEC-036)', () => {
  test('one source feeding two target fields is flagged in the mapper and the table', async ({
    page,
  }) => {
    await setUpSmallMapping(page);
    await openVisual(page);
    await src(page, 4).dragTo(tgt(page, 3));
    await src(page, 4).dragTo(tgt(page, 4));
    await expect(page.getByTestId('conflict-sourceReused')).toContainText(
      'CEPC.Country feeds 2 fields: Region, Language',
    );
    await expect(page.getByTestId(`conflict-marker-${T(3)}`)).toBeVisible();
    await expect(page.getByTestId(`conflict-marker-${T(4)}`)).toBeVisible();
    await expect(page.getByTestId(`tgt-conflict-${T(3)}`)).toContainText('1 conflict');
    await page.getByTestId(`conflict-marker-${T(3)}`).click();
    await expect(page.getByTestId('panel-conflict')).toContainText('CEPC.Country feeds 2 fields');
    await expect(page.getByTestId(`capsule-${T(3)}`)).toContainText('⚠');
    await page.getByRole('tab', { name: 'Mapping Table' }).click();
    await expect(page.getByTestId('conflicts-Profit Center-Region')).toContainText(
      'CEPC.Country feeds 2 fields',
    );
    await page.getByLabel('Filter by conflicts').selectOption('has');
    await expect(page.getByTestId('table-count')).toHaveText('2 of 6 fields');
  });
});
