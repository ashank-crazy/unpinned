// Cards that explain each finding in plain words.

import type { Finding, Severity } from '../lib/types';
import { h, icon } from './dom';

export const SEVERITY_TEXT: Record<Severity, string> = { high: 'Serious', medium: 'Worth knowing', low: 'Minor' };
const SEVERITY_ICON = { high: 'serious', medium: 'notice', low: 'minor' } as const;

export function severityChip(severity: Severity): HTMLElement {
  return h('span', { class: `chip chip-${severity}` }, icon(SEVERITY_ICON[severity]), SEVERITY_TEXT[severity]);
}

function factList(finding: Finding, label: string): HTMLElement | null {
  if (!finding.facts.length) return null;
  return h(
    'details',
    { class: 'facts' },
    h('summary', { text: label }),
    h(
      'dl',
      null,
      finding.facts.map((fact) => h('div', { class: 'fact' }, h('dt', { text: fact.label }), h('dd', { text: fact.value }))),
    ),
  );
}

export interface PreviewComparison {
  previewUrl: string;
  photoUrl: string;
}

export function hiddenCard(finding: Finding, comparison: PreviewComparison | null): HTMLLIElement {
  return h(
    'li',
    { class: `finding sev-${finding.severity}` },
    h('div', { class: 'finding-head' }, severityChip(finding.severity), h('h4', { class: 'finding-title', text: finding.title })),
    h('p', { class: 'finding-summary', text: finding.summary }),
    comparison &&
      h(
        'div',
        { class: 'compare' },
        h(
          'figure',
          null,
          h('img', { src: comparison.previewUrl, alt: 'The hidden preview stored inside the file' }),
          h('figcaption', { text: 'Hidden preview in the file' }),
        ),
        h(
          'figure',
          null,
          h('img', { src: comparison.photoUrl, alt: 'Your photo as people will see it' }),
          h('figcaption', { text: 'Your photo' }),
        ),
      ),
    h('p', { class: 'finding-why' }, h('strong', { text: 'Why it matters: ' }), finding.why),
    factList(finding, 'Show what the file says'),
    h('p', { class: 'finding-fix' }, icon('check'), 'Left out of your safer copy'),
  );
}

export interface VisibleCardOptions {
  number: number;
  covered: boolean;
  onToggle(covered: boolean): void;
  onFocus(active: boolean): void;
}

export function visibleCard(finding: Finding, options: VisibleCardOptions): HTMLLIElement {
  const checkboxId = `cover-${finding.id}`;
  const checkbox = h('input', { type: 'checkbox', id: checkboxId, checked: options.covered });
  checkbox.addEventListener('change', () => options.onToggle(checkbox.checked));
  const card = h(
    'li',
    { class: `finding sev-${finding.severity}`, 'data-id': finding.id },
    h(
      'div',
      { class: 'finding-head' },
      h('span', { class: 'marker', 'aria-hidden': 'true', text: String(options.number) }),
      severityChip(finding.severity),
      h('h4', { class: 'finding-title' }, h('span', { class: 'visually-hidden', text: `Item ${options.number}: ` }), finding.title),
    ),
    h('p', { class: 'finding-summary', text: finding.summary }),
    finding.unsure && h('p', { class: 'finding-unsure', text: "The text reader wasn't sure it read this right. Check the marked spot." }),
    h('p', { class: 'finding-why' }, h('strong', { text: 'Why it matters: ' }), finding.why),
    finding.kind.startsWith('barcode') ? factList(finding, 'Show what the code says') : null,
    h('label', { class: 'cover-toggle', for: checkboxId }, checkbox, h('span', { text: 'Cover it in my copy' })),
  );
  for (const [type, active] of [['mouseenter', true], ['mouseleave', false], ['focusin', true], ['focusout', false]] as const) {
    card.addEventListener(type, () => options.onFocus(active));
  }
  return card;
}
