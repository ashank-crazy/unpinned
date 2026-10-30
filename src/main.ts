import '@fontsource/atkinson-hyperlegible/latin-400.css';
import '@fontsource/atkinson-hyperlegible/latin-700.css';
import './styles.css';

import { loadPhoto, PhotoError, releasePhoto, type Photo } from './lib/inspect';
import { announce } from './ui/dom';
import { Workspace } from './ui/workspace';

const start = document.getElementById('start')!;
const info = document.getElementById('info')!;
const workspaceRoot = document.getElementById('workspace')!;
const alertBox = document.getElementById('alert')!;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const chooseButton = document.getElementById('choose-button') as HTMLButtonElement;
const dropOverlay = document.getElementById('drop-overlay')!;

let current: { photo: Photo; workspace: Workspace } | null = null;
let opening = false;

function showAlert(message: string | null): void {
  alertBox.textContent = message ?? '';
  alertBox.hidden = !message;
}

function setBusy(busy: boolean): void {
  document.body.classList.toggle('is-busy', busy);
  for (const element of document.querySelectorAll<HTMLButtonElement>('.sample')) element.disabled = busy;
  chooseButton.disabled = busy;
}

async function openFile(file: Blob, name: string): Promise<void> {
  if (opening) return;
  opening = true;
  setBusy(true);
  showAlert(null);
  announce('Opening the photo…');
  try {
    const photo = await loadPhoto(file, name);
    closeWorkspace();
    const workspace = new Workspace(photo, {
      onBack: () => (history.state?.view === 'photo' ? history.back() : showStart()),
      onOpen: (blob, copyName) => void openFile(blob, copyName),
    });
    current = { photo, workspace };
    workspaceRoot.replaceChildren(workspace.element);
    start.hidden = true;
    info.hidden = true;
    workspaceRoot.hidden = false;
    if (history.state?.view !== 'photo') history.pushState({ view: 'photo' }, '');
    window.scrollTo({ top: 0 });
    workspace.focus();
  } catch (error) {
    if (!(error instanceof PhotoError)) console.error(error);
    showAlert(error instanceof PhotoError ? error.message : "Something went wrong opening this file. Try another photo or screenshot.");
    alertBox.scrollIntoView({ block: 'nearest' });
  } finally {
    opening = false;
    setBusy(false);
  }
}

function closeWorkspace(): void {
  if (!current) return;
  current.workspace.destroy();
  releasePhoto(current.photo);
  current = null;
  workspaceRoot.replaceChildren();
}

function showStart(): void {
  closeWorkspace();
  workspaceRoot.hidden = true;
  start.hidden = false;
  info.hidden = false;
  showAlert(null);
  window.scrollTo({ top: 0 });
  chooseButton.focus();
}

// The browser's back button closes the photo instead of leaving the page.
window.addEventListener('popstate', () => {
  if (current && history.state?.view !== 'photo') showStart();
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (file) void openFile(file, file.name);
});

chooseButton.addEventListener('click', () => fileInput.click());

for (const button of document.querySelectorAll<HTMLButtonElement>('.sample')) {
  button.addEventListener('click', async () => {
    const sample = button.dataset.sample!;
    try {
      const response = await fetch(new URL(`samples/${sample}`, document.baseURI));
      if (!response.ok) throw new Error(String(response.status));
      await openFile(await response.blob(), sample);
    } catch {
      showAlert("The example couldn't be loaded. Check your connection and try again.");
    }
  });
}

window.addEventListener('paste', (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.closest('input, textarea, [contenteditable]')) return;
  const file = [...(event.clipboardData?.files ?? [])].find((item) => item.type.startsWith('image/'));
  if (!file) return;
  event.preventDefault();
  void openFile(file, file.name && file.name !== 'image.png' ? file.name : 'pasted-picture.png');
});

let dragDepth = 0;
const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
window.addEventListener('dragenter', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth++;
  dropOverlay.hidden = false;
});
window.addEventListener('dragover', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  event.dataTransfer!.dropEffect = 'copy';
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropOverlay.hidden = true;
});
window.addEventListener('drop', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  dropOverlay.hidden = true;
  const file = event.dataTransfer?.files[0];
  if (file) void openFile(file, file.name);
});

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Offline use is a bonus; the app works without it.
    });
  });
}

// A photo shared to the installed app from another app (Android) arrives
// through the service worker, which leaves it in a cache for this page.
async function openShared(): Promise<void> {
  if (!new URLSearchParams(location.search).has('shared')) return;
  history.replaceState(history.state, '', location.pathname);
  if (!('caches' in window)) return;
  const key = new URL('shared-photo', document.baseURI).href;
  const cache = await caches.open('unpinned-share');
  const response = await cache.match(key);
  await cache.delete(key);
  if (!response) {
    showAlert("The shared photo didn't come through. Try choosing it here instead.");
    return;
  }
  const name = decodeURIComponent(response.headers.get('X-File-Name') ?? 'shared-photo');
  await openFile(await response.blob(), name);
}

void openShared();
