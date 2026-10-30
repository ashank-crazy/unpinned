// A tiny element builder. Text always goes in through textContent, never
// innerHTML: metadata and text read from pictures are untrusted input.

type Child = Node | string | number | null | undefined | false | Child[];
type Handler = (event: Event) => void;

export interface Props {
  class?: string;
  text?: string;
  on?: Record<string, Handler>;
  [attribute: string]: string | number | boolean | undefined | Record<string, Handler>;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === false) continue;
      if (key === 'class') element.className = String(value);
      else if (key === 'text') element.textContent = String(value);
      else if (key === 'on') for (const [name, handler] of Object.entries(value as Record<string, Handler>)) element.addEventListener(name, handler);
      else element.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(element, children);
  return element;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(element: Element): void {
  while (element.firstChild) element.firstChild.remove();
}

const SVG = 'http://www.w3.org/2000/svg';

// 24px line icons, drawn for this project.
const ICONS: Record<string, string[]> = {
  serious: ['M12 3.5 2.8 19.5h18.4Z', 'M12 9.5v4.5', 'M12 17h.01'],
  notice: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 11v5', 'M12 7.5h.01'],
  minor: ['M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  cross: ['M6 6l12 12', 'M18 6 6 18'],
  lock: ['M6 11h12v9H6Z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
  download: ['M12 4v12', 'M7 11l5 5 5-5', 'M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4'],
  share: ['M12 15V3', 'M8 7l4-4 4 4', 'M5 11v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8'],
  cover: ['M4 5h16v14H4Z', 'M8 10h8v4H8Z'],
  draw: ['M4 20h4L19 9l-4-4L4 16Z', 'M13.5 6.5l4 4'],
  back: ['M15 5l-7 7 7 7'],
  file: ['M7 3h7l5 5v13H7Z', 'M14 3v5h5'],
  eye: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z', 'M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z'],
};

export function icon(name: keyof typeof ICONS, className = 'icon'): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of ICONS[name]) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

/** Announces a message to screen readers through the page's polite live region. */
export function announce(message: string): void {
  const region = document.getElementById('announcer');
  if (!region) return;
  region.textContent = '';
  window.setTimeout(() => (region.textContent = message), 50);
}
