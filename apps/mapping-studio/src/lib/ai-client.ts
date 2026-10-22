import {
  buildAiPrompts,
  buildValuePrompt,
  mergeSuggestions,
  parseAiResponse,
  parseValueResponse,
  ruleValueSuggestion,
  type AiMapping,
  type MappingSuggestion,
  type ValueSuggestion,
} from '@mms/mapping-suggest';
import type { Project } from '@mms/mapping-core';

/**
 * The AI behind the suggestions. Two providers: a model running on this computer (Ollama) or Anthropic's API with
 * the user's own key. Only field metadata is ever sent, never row values. Settings, including a key, are kept in
 * this browser only.
 */
export type AiProvider = 'ollama' | 'anthropic';

export interface AiSettings {
  provider: AiProvider;
  /** Ollama server address. */
  baseUrl: string;
  model: string;
  /** Anthropic API key. */
  apiKey: string;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  model: '',
  apiKey: '',
};
const KEY = 'mms:ai';
const ANTHROPIC = 'https://api.anthropic.com';

export function loadAiSettings(): AiSettings {
  try {
    const raw = window.localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as Partial<AiSettings>) : {};
    return {
      provider: v.provider === 'anthropic' ? 'anthropic' : 'ollama',
      baseUrl: typeof v.baseUrl === 'string' && v.baseUrl ? v.baseUrl : DEFAULT_AI_SETTINGS.baseUrl,
      model: typeof v.model === 'string' ? v.model : '',
      apiKey: typeof v.apiKey === 'string' ? v.apiKey : '',
    };
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
}

export function saveAiSettings(s: AiSettings): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* a per-viewer convenience */
  }
}

/** Is there enough in the settings to ask a question? */
export const aiReady = (s: AiSettings): boolean =>
  s.model !== '' && (s.provider === 'ollama' || s.apiKey !== '');

export class AiError extends Error {}

const ollamaBase = (s: AiSettings): string => s.baseUrl.trim().replace(/\/+$/, '');
const unreachable = (s: AiSettings): AiError =>
  s.provider === 'ollama'
    ? new AiError(
        `Cannot reach Ollama at ${ollamaBase(s)}. Start it (ollama serve) and check the address in AI settings.`,
      )
    : new AiError('Cannot reach the Anthropic API. Check the network connection.');

const anthropicHeaders = (s: AiSettings): Record<string, string> => ({
  'x-api-key': s.apiKey,
  'anthropic-version': '2023-06-01',
  'anthropic-dangerous-direct-browser-access': 'true',
  'content-type': 'application/json',
});

function httpProblem(s: AiSettings, status: number): AiError {
  if (status === 401 || status === 403) return new AiError('The API key was refused.');
  if (status === 404)
    return new AiError(
      s.provider === 'ollama'
        ? `The model "${s.model}" is not installed. Run: ollama pull ${s.model}`
        : `The model "${s.model}" was not found.`,
    );
  if (status === 429)
    return new AiError('The AI service is busy or the rate limit was reached. Try again shortly.');
  return new AiError(`The AI service answered with an error (${status}).`);
}

/** The names of the models the provider offers. */
export async function listModels(s: AiSettings, signal?: AbortSignal): Promise<string[]> {
  if (s.provider === 'anthropic' && s.apiKey === '') throw new AiError('Enter the API key first.');
  let res: Response;
  try {
    res =
      s.provider === 'ollama'
        ? await fetch(`${ollamaBase(s)}/api/tags`, signal ? { signal } : {})
        : await fetch(`${ANTHROPIC}/v1/models?limit=100`, {
            headers: anthropicHeaders(s),
            ...(signal ? { signal } : {}),
          });
  } catch {
    throw unreachable(s);
  }
  if (!res.ok) throw httpProblem(s, res.status);
  if (s.provider === 'ollama') {
    const data = (await res.json()) as { models?: { name?: unknown }[] };
    return (data.models ?? []).map((m) => String(m.name)).filter((n) => n !== 'undefined');
  }
  const data = (await res.json()) as { data?: { id?: unknown }[] };
  return (data.data ?? []).map((m) => String(m.id)).filter((n) => n !== 'undefined');
}

/** Asks the model one question and returns its text answer. */
export async function askAi(
  s: AiSettings,
  prompt: { system: string; user: string },
  signal?: AbortSignal,
): Promise<string> {
  if (!s.model) throw new AiError('Choose a model in AI settings first.');
  if (s.provider === 'anthropic' && !s.apiKey)
    throw new AiError('Enter the API key in AI settings first.');
  let res: Response;
  try {
    res =
      s.provider === 'ollama'
        ? await fetch(`${ollamaBase(s)}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            ...(signal ? { signal } : {}),
            body: JSON.stringify({
              model: s.model,
              stream: false,
              format: 'json',
              options: { temperature: 0, num_ctx: 8192 },
              messages: [
                { role: 'system', content: prompt.system },
                { role: 'user', content: prompt.user },
              ],
            }),
          })
        : await fetch(`${ANTHROPIC}/v1/messages`, {
            method: 'POST',
            headers: anthropicHeaders(s),
            ...(signal ? { signal } : {}),
            body: JSON.stringify({
              model: s.model,
              max_tokens: 2048,
              temperature: 0,
              system: prompt.system,
              messages: [{ role: 'user', content: prompt.user }],
            }),
          });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new AiError('Stopped.');
    throw unreachable(s);
  }
  if (!res.ok) throw httpProblem(s, res.status);
  if (s.provider === 'ollama') {
    const data = (await res.json()) as { message?: { content?: unknown } };
    const text = data.message?.content;
    if (typeof text !== 'string') throw new AiError('The model gave an answer without text.');
    return text;
  }
  const data = (await res.json()) as { content?: { type?: string; text?: unknown }[] };
  const text = data.content?.find((c) => c.type === 'text')?.text;
  if (typeof text !== 'string') throw new AiError('The model gave an answer without text.');
  return text;
}

/**
 * Rule-based suggestions plus the model's, merged. Only field metadata is sent. A batch the model cannot answer is
 * reported and skipped; the rule-based suggestions are always kept.
 */
export async function aiSuggest(args: {
  project: Project;
  structureId: string;
  rules: readonly MappingSuggestion[];
  settings: AiSettings;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}): Promise<{ suggestions: MappingSuggestion[]; problems: string[] }> {
  const prompts = buildAiPrompts(args.project, {
    structureId: args.structureId,
    hints: args.rules,
  });
  const items: AiMapping[] = [];
  const problems: string[] = [];
  let done = 0;
  args.onProgress?.(0, prompts.length);
  for (const prompt of prompts) {
    const text = await askAi(args.settings, prompt, args.signal);
    const parsed = parseAiResponse(text, prompt);
    items.push(...parsed.items);
    problems.push(...parsed.problems);
    args.onProgress?.(++done, prompts.length);
  }
  return { suggestions: mergeSuggestions(args.rules, items, args.project), problems };
}

/** A fixed value for a field that has no source: the rule first, the model's answer when asked. */
export function ruleValueFor(
  project: Project,
  structureId: string,
  fieldId: string,
): ValueSuggestion | undefined {
  const field = project.targetDefinition?.structures
    .find((s) => s.id === structureId)
    ?.fields.find((f) => f.id === fieldId);
  return field ? ruleValueSuggestion(field) : undefined;
}

export async function aiSuggestValue(args: {
  project: Project;
  structureId: string;
  fieldId: string;
  settings: AiSettings;
  today: string;
  signal?: AbortSignal;
}): Promise<ValueSuggestion> {
  const prompt = buildValuePrompt(args.project, args.structureId, args.fieldId, args.today);
  if (!prompt) throw new AiError('That field is no longer in the target.');
  const parsed = parseValueResponse(await askAi(args.settings, prompt, args.signal));
  if (!parsed.ok) throw new AiError(parsed.problem);
  return parsed.suggestion;
}
