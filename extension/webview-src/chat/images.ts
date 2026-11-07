import { t } from '../shared/catalog.svelte';

const IMAGE_MAX = 4 * 1024 * 1024; // LAN Hub refuses anything larger
const REENCODE_OVER = 1.5 * 1024 * 1024;
const MAX_SIDE = 1920;

export interface Attachment {
  mime: string;
  b64: string;
  w: number;
  h: number;
  src: string;
  size: number;
}

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// Large photos and screenshots are scaled down before sending; small images and GIFs go as they are.
export async function prepareImage(file: File): Promise<Attachment> {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error(t('chat.image.type'));
  const bmp = await createImageBitmap(file);
  let { width: w, height: h } = bmp;
  let blob: Blob | null = file;
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  if (file.type !== 'image/gif' && (scale < 1 || file.size > REENCODE_OVER)) {
    w = Math.round(w * scale);
    h = Math.round(h * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
    const toBlob = (type: string, q?: number) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, q));
    blob = file.type === 'image/png' ? await toBlob('image/png') : null;
    if (!blob || blob.size > REENCODE_OVER) blob = await toBlob('image/jpeg', 0.85);
  }
  bmp.close();
  if (!blob) throw new Error(t('chat.image.unreadable'));
  if (blob.size > IMAGE_MAX) throw new Error(t('chat.image.tooLarge'));
  const src = await readDataUrl(blob);
  return { mime: blob.type || file.type, b64: src.slice(src.indexOf(',') + 1), w, h, src, size: blob.size };
}
