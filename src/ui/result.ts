// The finished copy: what changed, the re-check, and ways to save or share it.

import { formatBytes, plural } from '../lib/format';
import type { SaferCopy } from '../lib/inspect';
import { h, icon } from './dom';

export interface ResultActions {
  onCheckAgain(): void;
}

export function resultSection(copy: SaferCopy, actions: ResultActions): HTMLElement {
  const { verification } = copy;
  const title = h(
    'h2',
    { class: 'result-title', id: 'result-title', tabindex: '-1' },
    icon(verification.clean ? 'check' : 'serious'),
    verification.clean ? 'Your safer copy is ready' : 'Something is still in the copy',
  );

  const notes: string[] = [];
  if (copy.lossless) notes.push('Only the hidden details were taken out. The picture itself is exactly the same, with no loss in quality.');
  else if (copy.coverCount) {
    notes.push(
      `Saved as a new picture with ${plural(copy.coverCount, 'solid cover')}. Solid covers can't be undone, unlike blur or pixelation, which sometimes can.`,
    );
  } else notes.push(`Saved as a new ${copy.type === 'image/png' ? 'PNG' : 'JPEG'} picture. The quality may change slightly.`);
  if (copy.scale < 1) notes.push("This device couldn't handle the full size, so the copy is a little smaller than the original.");

  const share = shareButton(copy);
  return h(
    'section',
    { class: `result${verification.clean ? '' : ' is-problem'}`, 'aria-labelledby': 'result-title' },
    title,
    h(
      'div',
      { class: 'result-grid' },
      h('img', { class: 'result-preview', src: copy.url, alt: 'Your safer copy' }),
      h(
        'div',
        { class: 'result-body' },
        h('h3', { text: 'We checked the copy again' }),
        h(
          'ul',
          { class: 'checks' },
          verification.checks.map((check) =>
            h(
              'li',
              { class: check.ok ? 'ok' : 'not-ok' },
              icon(check.ok ? 'check' : 'cross'),
              h('span', { class: 'visually-hidden', text: check.ok ? 'Passed: ' : 'Failed: ' }),
              check.label,
            ),
          ),
        ),
        !verification.clean &&
          h('p', { class: 'warning', text: "Don't share this copy yet. Try saving the photo in another format, like JPEG, and check it again." }),
        !copy.looksRight &&
          h('p', {
            class: 'warning',
            text: 'Your browser seems to have changed the picture while saving it. Some privacy settings do this. Look at the copy before you share it.',
          }),
        notes.map((note) => h('p', { class: 'result-note', text: note })),
        h(
          'div',
          { class: 'result-actions' },
          h('a', { class: 'button primary', href: copy.url, download: copy.name }, icon('download'), 'Save safer copy'),
          share,
          h('button', { class: 'button secondary', type: 'button', on: { click: actions.onCheckAgain } }, icon('eye'), 'Check the copy again'),
        ),
        h('p', { class: 'result-file', text: `${copy.name} · ${formatBytes(copy.blob.size)}` }),
        h('p', {
          class: 'keep-original',
          text: "Your original file hasn't changed. If you might need it later, for example as evidence, keep it somewhere private.",
        }),
      ),
    ),
    tips(),
  );
}

function shareButton(copy: SaferCopy): HTMLButtonElement | null {
  const file = new File([copy.blob], copy.name, { type: copy.type });
  if (!navigator.canShare?.({ files: [file] })) return null;
  const button = h('button', { class: 'button secondary', type: 'button' }, icon('share'), 'Share');
  button.addEventListener('click', () => {
    navigator.share({ files: [file] }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      button.replaceWith(h('p', { class: 'result-note', text: "Sharing didn't work here. Save the copy, then share it from your files." }));
    });
  });
  return button;
}

function tips(): HTMLElement {
  return h(
    'details',
    { class: 'tips' },
    h('summary', { text: 'Stop it at the source next time' }),
    h(
      'ul',
      null,
      h('li', null, h('strong', { text: 'iPhone: ' }), 'when you share a photo, tap Options at the top and turn off Location. To stop saving locations at all, go to Settings › Privacy & Security › Location Services › Camera and choose Never.'),
      h('li', null, h('strong', { text: 'Android: ' }), 'in your camera app’s settings, turn off location tags (often called “Save location” or “Location tags”). Some gallery apps also offer to remove location data when you share.'),
      h('li', null, h('strong', { text: 'Screenshots: ' }), 'on some phones and apps, cropping or marking up a picture can leave the old version inside the file. Check edited screenshots here, and look out for open tabs, notifications, and names at the edges.'),
      h('li', null, h('strong', { text: 'Where it matters most: ' }), 'many social apps remove hidden details when you post, but email, cloud links, files sent as documents, and some websites keep them.'),
    ),
  );
}
