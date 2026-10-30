// One photo being checked: the picture on one side, the report on the other,
// and the button that makes the safer copy.

import { formatBytes, plural } from '../lib/format';
import { previewUrl } from '../lib/image';
import { findHidden, findVisible, FORMAT_NAMES, makeSaferCopy, PhotoError, type Photo, type SaferCopy } from '../lib/inspect';
import type { Box, Finding, Severity } from '../lib/types';
import { announce, append, clear, h, icon } from './dom';
import { hiddenCard, SEVERITY_TEXT, visibleCard } from './findings';
import { resultSection } from './result';
import { Stage } from './stage';

export interface WorkspaceEvents {
  onBack(): void;
  onOpen(file: Blob, name: string): void;
}

interface Scan {
  progress: number;
  done: boolean;
  textRead: boolean;
  codesRead: boolean;
}

const LOSSLESS_FORMATS = new Set(['jpeg', 'png', 'webp']);

export class Workspace {
  readonly element: HTMLElement;
  private readonly stage: Stage;
  private readonly title: HTMLHeadingElement;
  private readonly verdict = h('div', { class: 'verdict verdict-pending' });
  private readonly hiddenSlot = h('div', { class: 'group-body' });
  private readonly visibleSlot = h('div', { class: 'group-body' });
  private readonly action = h('div', { class: 'action-panel' });
  private readonly resultSlot = h('div', { class: 'result-slot' });
  private hidden: Finding[] | null = null;
  private visible: Finding[] = [];
  private covered = new Set<string>();
  private scan: Scan = { progress: 0, done: false, textRead: true, codesRead: true };
  private copy: SaferCopy | null = null;
  private making = false;
  private copyError: string | null = null;
  private readonly urls: string[] = [];
  private closed = false;

  constructor(
    private readonly photo: Photo,
    private readonly events: WorkspaceEvents,
  ) {
    this.stage = new Stage(photo, {
      onMarkClick: (id) => this.toggleCover(id, !this.covered.has(id)),
      onCoversChange: () => this.coversChanged(),
    });
    this.title = h('h2', { class: 'report-title', id: 'report-title', tabindex: '-1', text: 'What this photo gives away' });
    if (!photo.bitmap) this.scan = { progress: 1, done: true, textRead: false, codesRead: false };

    const details = [FORMAT_NAMES[photo.format], formatBytes(photo.bytes.length), photo.width ? `${photo.width} × ${photo.height}` : '']
      .filter(Boolean)
      .join(' · ');
    this.element = h(
      'div',
      { class: 'workspace-inner' },
      h(
        'div',
        { class: 'workspace-bar' },
        h('button', { class: 'button ghost', type: 'button', on: { click: () => this.events.onBack() } }, icon('back'), 'Check another photo'),
        h('p', { class: 'file-meta' }, h('span', { class: 'file-name', text: photo.name }), h('span', { text: details })),
      ),
      h(
        'div',
        { class: 'workspace-grid' },
        h('div', { class: 'summary-area' }, this.title, this.verdict),
        h('div', { class: 'stage-column' }, this.stage.element),
        h(
          'div',
          { class: 'report-column' },
          h(
            'section',
            { class: 'group', 'aria-labelledby': 'hidden-title' },
            h('h3', { id: 'hidden-title', text: 'Hidden in the file' }),
            this.hiddenSlot,
          ),
          h(
            'section',
            { class: 'group', 'aria-labelledby': 'visible-title' },
            h('h3', { id: 'visible-title', text: 'Visible in the picture' }),
            this.visibleSlot,
          ),
          this.action,
          this.resultSlot,
        ),
      ),
    );
    this.renderVerdict();
    this.hiddenSlot.append(h('p', { class: 'muted', text: 'Reading the file…' }));
    this.renderVisible();
    this.renderAction();
    void this.analyze();
  }

  focus(): void {
    this.title.focus();
  }

  destroy(): void {
    this.closed = true;
    for (const url of this.urls) URL.revokeObjectURL(url);
    if (this.copy) URL.revokeObjectURL(this.copy.url);
  }

  private async analyze(): Promise<void> {
    try {
      const hidden = await findHidden(this.photo);
      const thumbnail = hidden.find((finding) => finding.preview && finding.severity === 'high');
      const url = thumbnail?.preview ? await previewUrl(thumbnail.preview, this.photo.meta.orientation) : null;
      if (url) this.urls.push(url);
      if (this.closed) return;
      this.hidden = hidden;
      this.renderHidden(url);
    } catch (error) {
      console.error(error);
      if (this.closed) return;
      this.hidden = [];
      clear(this.hiddenSlot);
      this.hiddenSlot.append(h('p', { class: 'warning', text: "Unpinned couldn't read the details in this file. The safer copy still leaves them out." }));
    }
    this.renderVerdict();
    this.renderAction();
    this.announceSummary();

    if (!this.photo.bitmap) return;
    let lastShown = 0;
    const result = await findVisible(this.photo, (fraction) => {
      if (this.closed) return;
      this.scan.progress = fraction;
      if (fraction - lastShown >= 0.02 || fraction === 1) {
        lastShown = fraction;
        this.renderScanProgress();
      }
    });
    if (this.closed) return;
    this.visible = result.findings;
    this.scan = { progress: 1, done: true, textRead: result.textRead, codesRead: result.codesRead };
    for (const finding of this.visible) if (finding.severity !== 'low') this.covered.add(finding.id);
    this.renderVisible();
    this.renderMarks();
    this.renderVerdict();
    this.renderAction();
    this.announceSummary();
  }

  private announceSummary(): void {
    const all = [...(this.hidden ?? []), ...this.visible];
    const serious = all.filter((finding) => finding.severity === 'high').length;
    const prefix = this.scan.done ? 'Check finished.' : 'File checked. Still reading the picture.';
    announce(`${prefix} ${serious ? `${plural(serious, 'serious finding')}.` : 'No serious findings.'} ${plural(all.length, 'finding')} in all.`);
  }

  private renderVerdict(): void {
    const all = [...(this.hidden ?? []), ...this.visible];
    const count = (severity: Severity) => all.filter((finding) => finding.severity === severity);
    const high = count('high');
    const medium = count('medium');
    let tone: string;
    let title: string;
    let text: string;
    if (this.hidden === null) {
      tone = 'pending';
      title = 'Checking your photo…';
      text = 'This happens on your device. Nothing is uploaded.';
    } else if (high.length) {
      tone = 'high';
      title = "Don't share this one as it is";
      text = `It gives away ${listOf(high)}. The safer copy fixes this.`;
    } else if (medium.length) {
      tone = 'medium';
      title = 'Worth a look before you share';
      text = `It gives away ${listOf(medium)}. The safer copy can fix this.`;
    } else if (all.length) {
      tone = 'low';
      title = 'Nothing serious found';
      text = 'Only minor details, which the safer copy leaves out.';
    } else if (!this.scan.done) {
      tone = 'pending';
      title = 'Nothing hidden in the file';
      text = 'Still reading the text in the picture…';
    } else {
      tone = 'ok';
      title = 'Nothing found';
      text =
        this.scan.textRead && this.scan.codesRead
          ? 'Nothing is hidden in the file, and no personal details were found in the picture. Look it over yourself before you share it.'
          : "Nothing is hidden in the file, but the picture itself couldn't be checked for text and codes. Look it over yourself before you share it.";
    }
    if (tone !== 'pending' && !this.scan.done) text += ' Still reading the text in the picture…';

    clear(this.verdict);
    this.verdict.className = `verdict verdict-${tone}`;
    const iconName = tone === 'high' ? 'serious' : tone === 'medium' ? 'notice' : tone === 'pending' ? 'eye' : 'check';
    append(this.verdict, [
      icon(iconName, 'icon verdict-icon'),
      h(
        'div',
        null,
        h('p', { class: 'verdict-title', text: title }),
        h('p', { class: 'verdict-text', text }),
        all.length > 0 &&
          h(
            'ul',
            { class: 'verdict-counts', 'aria-label': 'Findings by level' },
            (['high', 'medium', 'low'] as const)
              .filter((severity) => count(severity).length)
              .map((severity) => h('li', { class: `count count-${severity}`, text: `${count(severity).length} ${SEVERITY_TEXT[severity].toLowerCase()}` })),
          ),
      ),
    ]);
  }

  private renderHidden(previewImage: string | null): void {
    clear(this.hiddenSlot);
    const hidden = this.hidden ?? [];
    if (!hidden.length) {
      this.hiddenSlot.append(
        h('p', { class: 'all-clear' }, icon('check'), 'Nothing hidden. The file has no location, dates, device details, or hidden extras.'),
      );
      return;
    }
    this.hiddenSlot.append(
      h('p', { class: 'group-note', text: 'These travel with the file but aren’t visible in the picture. Your safer copy leaves them all out.' }),
      h(
        'ul',
        { class: 'findings' },
        hidden.map((finding) =>
          hiddenCard(finding, previewImage && finding.preview && this.photo.previewUrl ? { previewUrl: previewImage, photoUrl: this.photo.previewUrl } : null),
        ),
      ),
    );
  }

  private renderScanProgress(): void {
    const bar = this.visibleSlot.querySelector('progress');
    if (bar) bar.value = this.scan.progress;
    else this.renderVisible();
  }

  private renderVisible(): void {
    clear(this.visibleSlot);
    if (!this.photo.bitmap) {
      this.visibleSlot.append(h('p', { class: 'muted', text: "This browser can't show the picture, so the text in it wasn't checked. Look it over yourself." }));
      return;
    }
    if (!this.scan.done) {
      this.visibleSlot.append(
        h(
          'div',
          { class: 'scan' },
          h('label', { for: 'scan-progress', text: 'Reading text, QR codes, and barcodes in the picture…' }),
          h('progress', { id: 'scan-progress', max: '1', value: String(this.scan.progress) }),
          h('p', { class: 'muted small', text: 'This runs on your device. The first time can take a little longer while the text reader loads.' }),
        ),
      );
      return;
    }

    const problems: string[] = [];
    if (!this.scan.textRead) problems.push("Unpinned couldn't read the text in this picture on this device.");
    if (!this.scan.codesRead) problems.push("Unpinned couldn't check this picture for QR codes and barcodes on this device.");
    for (const problem of problems) this.visibleSlot.append(h('p', { class: 'warning', text: `${problem} Look it over yourself.` }));

    if (this.visible.length) {
      this.visibleSlot.append(
        h('p', { class: 'group-note', text: 'The numbers match the boxes on your photo. Ticked items get a solid cover in your copy.' }),
        h(
          'ul',
          { class: 'findings' },
          this.visible.map((finding, index) =>
            visibleCard(finding, {
              number: index + 1,
              covered: this.covered.has(finding.id),
              onToggle: (covered) => this.toggleCover(finding.id, covered),
              onFocus: (active) => this.stage.highlight(active ? finding.id : null),
            }),
          ),
        ),
      );
    } else if (!problems.length) {
      this.visibleSlot.append(h('p', { class: 'all-clear' }, icon('check'), 'No addresses, numbers, names, or codes found in the picture.'));
    }

    this.visibleSlot.append(
      h(
        'div',
        { class: 'look-for' },
        h('p', { class: 'look-for-title', text: 'Also look for things Unpinned can’t spot:' }),
        h(
          'ul',
          null,
          ['Faces and tattoos', 'House numbers and street signs', 'License plates', 'Landmarks and views from windows', 'Reflections in mirrors and glasses', 'Screens, mail, and documents'].map(
            (item) => h('li', { text: item }),
          ),
        ),
        h('p', { class: 'muted small', text: 'Use “Draw a cover” on the picture to hide anything else.' }),
      ),
    );
  }

  private renderMarks(): void {
    this.stage.setMarks(
      this.visible
        .map((finding, index) => ({ id: finding.id, number: index + 1, severity: finding.severity, boxes: finding.boxes ?? [], covered: this.covered.has(finding.id) }))
        .filter((mark) => mark.boxes.length),
    );
  }

  private toggleCover(id: string, covered: boolean): void {
    if (covered) this.covered.add(id);
    else this.covered.delete(id);
    const checkbox = this.visibleSlot.querySelector<HTMLInputElement>(`#cover-${id}`);
    if (checkbox) checkbox.checked = covered;
    this.renderMarks();
    this.coversChanged();
    const finding = this.visible.find((item) => item.id === id);
    if (finding) announce(`${finding.title} will ${covered ? '' : 'not '}be covered.`);
  }

  private coveredBoxes(): Box[] {
    const boxes = this.visible.filter((finding) => this.covered.has(finding.id)).flatMap((finding) => finding.boxes ?? []);
    return [...boxes, ...this.stage.coverBoxes()];
  }

  private coversChanged(): void {
    if (this.copy) {
      URL.revokeObjectURL(this.copy.url);
      this.copy = null;
      clear(this.resultSlot);
    }
    this.renderAction();
  }

  private renderAction(): void {
    clear(this.action);
    const covers = this.coveredBoxes().length;
    const canCopy = this.photo.bitmap !== null || LOSSLESS_FORMATS.has(this.photo.format);
    const waiting = this.hidden === null || !this.scan.done;
    const plan = covers
      ? `Leaves out everything hidden in the file and covers ${plural(covers, 'spot')} with solid boxes.`
      : LOSSLESS_FORMATS.has(this.photo.format)
        ? 'Leaves out everything hidden in the file. The picture itself stays exactly the same.'
        : 'Leaves out everything hidden in the file.';

    const button = h(
      'button',
      { class: 'button primary large', type: 'button', disabled: !canCopy || waiting || this.making },
      icon('lock'),
      this.making ? 'Making your copy…' : this.copy ? 'Make the copy again' : 'Make a safer copy',
    );
    button.addEventListener('click', () => void this.makeCopy());

    append(this.action, [
      h('p', { class: 'action-plan' }, h('strong', { text: 'Safer copy: ' }), plan, ' Your original stays as it is.'),
      button,
      waiting && canCopy && h('p', { class: 'muted small', text: 'Ready once the check finishes.' }),
      !canCopy && h('p', { class: 'warning', text: this.photo.decodeProblem ?? "This browser can't make a copy of this picture." }),
      this.copyError && h('p', { class: 'warning', role: 'alert', text: this.copyError }),
    ]);
  }

  private async makeCopy(): Promise<void> {
    if (this.making) return;
    this.making = true;
    this.copyError = null;
    this.renderAction();
    try {
      const copy = await makeSaferCopy(this.photo, this.coveredBoxes());
      if (this.closed) {
        URL.revokeObjectURL(copy.url);
        return;
      }
      if (this.copy) URL.revokeObjectURL(this.copy.url);
      this.copy = copy;
      clear(this.resultSlot);
      this.resultSlot.append(resultSection(copy, { onCheckAgain: () => this.events.onOpen(copy.blob, copy.name) }));
      this.resultSlot.querySelector<HTMLElement>('#result-title')?.focus();
      announce(copy.verification.clean ? 'Your safer copy is ready. Every check passed.' : 'The copy is ready, but some checks failed.');
    } catch (error) {
      if (!(error instanceof PhotoError)) console.error(error);
      this.copyError = error instanceof PhotoError ? error.message : 'Something went wrong making the copy. Try again, or try a smaller photo.';
    } finally {
      this.making = false;
      if (!this.closed) this.renderAction();
    }
  }
}

/** "where you took it, a hidden preview, and an address" */
function listOf(findings: Finding[]): string {
  const names = [...new Set(findings.map((finding) => finding.title.charAt(0).toLowerCase() + finding.title.slice(1)))];
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
}
