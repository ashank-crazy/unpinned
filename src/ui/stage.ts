// The picture, with numbered boxes over what was found and covers people can
// draw themselves. Boxes are stored in picture pixels and shown in percent,
// so they stay in place at any screen size.

import type { Photo } from '../lib/inspect';
import type { Box, Severity } from '../lib/types';
import { announce, clear, h, icon } from './dom';

export interface Mark {
  id: string;
  number: number;
  severity: Severity;
  boxes: Box[];
  covered: boolean;
}

interface Cover {
  id: number;
  box: Box;
  element: HTMLElement;
}

export interface StageEvents {
  /** A numbered box was clicked or tapped. */
  onMarkClick(id: string): void;
  /** Covers were added, moved, resized, or removed. */
  onCoversChange(): void;
}

export class Stage {
  readonly element: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly markLayer: HTMLElement;
  private readonly coverLayer: HTMLElement;
  private readonly drawButton: HTMLButtonElement;
  private readonly addButton: HTMLButtonElement;
  private readonly helpId = 'cover-help';
  private covers: Cover[] = [];
  private nextId = 1;
  private drawing = false;

  constructor(
    private readonly photo: Photo,
    private readonly events: StageEvents,
  ) {
    this.markLayer = h('div', { class: 'mark-layer', 'aria-hidden': 'true' });
    this.coverLayer = h('div', { class: 'cover-layer' });
    this.overlay = h('div', { class: 'overlay' }, this.markLayer, this.coverLayer);
    this.drawButton = h('button', { class: 'button secondary', type: 'button', 'aria-pressed': 'false' }, icon('draw'), 'Draw a cover');
    this.addButton = h('button', { class: 'button secondary', type: 'button' }, icon('cover'), 'Add a cover');
    this.drawButton.addEventListener('click', () => this.setDrawing(!this.drawing));
    this.addButton.addEventListener('click', () => this.addCover(this.centeredBox(), true));

    if (!photo.previewUrl) {
      this.element = h(
        'div',
        { class: 'stage stage-empty' },
        h('div', { class: 'stage-placeholder' }, icon('file', 'icon large'), h('p', { text: photo.decodeProblem ?? "This browser can't show the picture." })),
      );
      return;
    }

    const frame = h(
      'div',
      { class: 'frame' },
      h('img', { src: photo.previewUrl, alt: 'Your photo. Numbered boxes mark what was found; dark boxes will be covered in your copy.' }),
      this.overlay,
    );
    frame.style.setProperty('--ratio', String(photo.width / photo.height));
    frame.style.aspectRatio = `${photo.width} / ${photo.height}`;
    this.overlay.addEventListener('pointerdown', (event) => this.startDrawing(event));

    this.element = h(
      'div',
      { class: 'stage' },
      h('figure', { class: 'stage-figure' }, frame),
      h(
        'div',
        { class: 'cover-tools' },
        h('div', { class: 'cover-buttons' }, this.drawButton, this.addButton),
        h('p', {
          class: 'cover-help',
          id: this.helpId,
          text: 'Cover anything else, like a face or a house number: turn on drawing and drag across it. Drag a cover to move it. With a keyboard, arrow keys move a cover, Shift and arrow keys resize it, and Delete removes it.',
        }),
      ),
    );
  }

  setMarks(marks: Mark[]): void {
    clear(this.markLayer);
    for (const mark of marks) {
      mark.boxes.forEach((box, index) => {
        const element = h('div', { class: `mark sev-${mark.severity}${mark.covered ? ' is-covered' : ''}`, 'data-id': mark.id });
        // Alternate corners so numbers on neighboring lines don't sit on top of each other.
        if (index === 0) element.append(h('span', { class: `mark-number${mark.number % 2 ? '' : ' is-right'}`, text: String(mark.number) }));
        element.addEventListener('click', () => this.events.onMarkClick(mark.id));
        place(element, box, this.photo);
        this.markLayer.append(element);
      });
    }
  }

  highlight(id: string | null): void {
    for (const element of this.markLayer.querySelectorAll<HTMLElement>('.mark')) {
      element.classList.toggle('is-active', element.dataset.id === id);
    }
  }

  coverBoxes(): Box[] {
    return this.covers.map((cover) => cover.box);
  }

  get coverCount(): number {
    return this.covers.length;
  }

  private setDrawing(on: boolean): void {
    this.drawing = on;
    this.drawButton.setAttribute('aria-pressed', String(on));
    this.overlay.classList.toggle('is-drawing', on);
    announce(on ? 'Drawing is on. Drag on the picture to cover something.' : 'Drawing is off.');
  }

  private toPicture(event: PointerEvent): { x: number; y: number } {
    const rect = this.overlay.getBoundingClientRect();
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    return {
      x: clamp((event.clientX - rect.left) / rect.width) * this.photo.width,
      y: clamp((event.clientY - rect.top) / rect.height) * this.photo.height,
    };
  }

  private get minSize(): number {
    return Math.max(this.photo.width, this.photo.height) * 0.012;
  }

  private startDrawing(event: PointerEvent): void {
    if (!this.drawing || event.button !== 0 || (event.target as Element).closest('.cover')) return;
    event.preventDefault();
    const start = this.toPicture(event);
    const preview = h('div', { class: 'cover is-new', 'aria-hidden': 'true' });
    this.coverLayer.append(preview);
    this.overlay.setPointerCapture(event.pointerId);
    const boxTo = (end: { x: number; y: number }): Box => ({
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      w: Math.abs(end.x - start.x),
      h: Math.abs(end.y - start.y),
    });
    const move = (moveEvent: PointerEvent) => place(preview, boxTo(this.toPicture(moveEvent)), this.photo);
    const finish = (endEvent: PointerEvent) => {
      this.overlay.removeEventListener('pointermove', move);
      this.overlay.removeEventListener('pointerup', finish);
      this.overlay.removeEventListener('pointercancel', finish);
      preview.remove();
      const box = boxTo(this.toPicture(endEvent));
      if (endEvent.type === 'pointerup' && box.w >= this.minSize && box.h >= this.minSize) this.addCover(box, false);
    };
    this.overlay.addEventListener('pointermove', move);
    this.overlay.addEventListener('pointerup', finish);
    this.overlay.addEventListener('pointercancel', finish);
  }

  private centeredBox(): Box {
    const w = this.photo.width * 0.3;
    const h = this.photo.height * 0.12;
    const offset = (this.covers.length % 5) * this.photo.width * 0.03;
    return { x: (this.photo.width - w) / 2 + offset, y: (this.photo.height - h) / 2 + offset, w, h };
  }

  private clampBox(box: Box): Box {
    const w = Math.min(this.photo.width, Math.max(this.minSize, box.w));
    const h = Math.min(this.photo.height, Math.max(this.minSize, box.h));
    return {
      x: Math.min(this.photo.width - w, Math.max(0, box.x)),
      y: Math.min(this.photo.height - h, Math.max(0, box.y)),
      w,
      h,
    };
  }

  private addCover(box: Box, focus: boolean): void {
    const id = this.nextId++;
    const remove = h('button', { class: 'cover-remove', type: 'button', 'aria-label': `Remove cover ${id}` }, icon('cross'));
    const handle = h('span', { class: 'cover-handle', 'aria-hidden': 'true' });
    const element = h(
      'div',
      {
        class: 'cover',
        tabindex: '0',
        role: 'group',
        'aria-roledescription': 'cover',
        'aria-label': `Cover ${id}`,
        'aria-describedby': this.helpId,
      },
      remove,
      handle,
    );
    const cover: Cover = { id, box: this.clampBox(box), element };
    place(element, cover.box, this.photo);
    remove.addEventListener('click', () => this.removeCover(cover));
    element.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target === remove || remove.contains(event.target as Node)) return;
      this.dragCover(cover, event, event.target === handle ? 'resize' : 'move');
    });
    element.addEventListener('keydown', (event) => this.keyCover(cover, event));
    this.covers.push(cover);
    this.coverLayer.append(element);
    this.events.onCoversChange();
    if (focus) {
      element.focus();
      announce(`Cover ${id} added in the middle of the picture. Use the arrow keys to move it, and Shift and the arrow keys to resize it.`);
    } else {
      announce(`Cover ${id} added.`);
    }
  }

  private removeCover(cover: Cover): void {
    const hadFocus = cover.element.contains(document.activeElement);
    cover.element.remove();
    this.covers = this.covers.filter((other) => other !== cover);
    this.events.onCoversChange();
    if (hadFocus) this.addButton.focus();
    announce(`Cover ${cover.id} removed.`);
  }

  private dragCover(cover: Cover, event: PointerEvent, mode: 'move' | 'resize'): void {
    event.preventDefault();
    event.stopPropagation();
    cover.element.focus({ preventScroll: true });
    cover.element.setPointerCapture(event.pointerId);
    const origin = this.toPicture(event);
    const start = { ...cover.box };
    const move = (moveEvent: PointerEvent) => {
      const point = this.toPicture(moveEvent);
      const dx = point.x - origin.x;
      const dy = point.y - origin.y;
      cover.box = this.clampBox(mode === 'move' ? { ...start, x: start.x + dx, y: start.y + dy } : { ...start, w: start.w + dx, h: start.h + dy });
      place(cover.element, cover.box, this.photo);
    };
    const finish = () => {
      cover.element.removeEventListener('pointermove', move);
      cover.element.removeEventListener('pointerup', finish);
      cover.element.removeEventListener('pointercancel', finish);
      this.events.onCoversChange();
    };
    cover.element.addEventListener('pointermove', move);
    cover.element.addEventListener('pointerup', finish);
    cover.element.addEventListener('pointercancel', finish);
  }

  private keyCover(cover: Cover, event: KeyboardEvent): void {
    if (event.target !== cover.element) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.removeCover(cover);
      return;
    }
    const step = Math.max(this.photo.width, this.photo.height) * (event.altKey ? 0.002 : 0.01);
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const delta = moves[event.key];
    if (!delta) return;
    event.preventDefault();
    const { x, y, w, h } = cover.box;
    cover.box = this.clampBox(event.shiftKey ? { x, y, w: w + delta[0], h: h + delta[1] } : { x: x + delta[0], y: y + delta[1], w, h });
    place(cover.element, cover.box, this.photo);
    this.events.onCoversChange();
  }
}

function place(element: HTMLElement, box: Box, photo: Photo): void {
  element.style.left = `${(box.x / photo.width) * 100}%`;
  element.style.top = `${(box.y / photo.height) * 100}%`;
  element.style.width = `${(box.w / photo.width) * 100}%`;
  element.style.height = `${(box.h / photo.height) * 100}%`;
}
