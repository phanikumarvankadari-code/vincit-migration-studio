import { serializeProject, type Project, type SourceRows } from '@mms/mapping-core';
import { buildCatalog, catalogToMarkdown, type KitOptions } from './catalog.js';
import { buildExamples, buildPrompt, kitReadme } from './prompt.js';

export interface KitFile {
  name: string;
  /** UTF-8 text. */
  content: string;
}

/**
 * The files to give to a chat AI for a first mapping. Deterministic and offline: nothing is sent anywhere. Row
 * data is read only for statistics and for the codes of code-like columns.
 */
export function buildKit(
  project: Project,
  data: Readonly<Record<string, SourceRows>>,
  options: KitOptions = {},
): KitFile[] {
  const catalog = buildCatalog(project, data, options);
  return [
    { name: 'PROMPT.md', content: buildPrompt(catalog) },
    { name: 'README.md', content: kitReadme(catalog) },
    { name: 'catalog.md', content: catalogToMarkdown(catalog) },
    { name: 'catalog.json', content: `${JSON.stringify(catalog, null, 2)}\n` },
    { name: 'examples.json', content: `${JSON.stringify(buildExamples(catalog), null, 2)}\n` },
    { name: 'mapping.mms.json', content: serializeProject(project) },
  ];
}
