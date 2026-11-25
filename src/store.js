// -----------------------------------------------------------------------------
// /data, the one writable volume: the shutoffs kept (src/shutoff.js), so that
// a shutoff not yet seen applied is sent again after a restart. No secret is
// written here.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// --- The shutoffs kept (src/shutoff.js) -----------------------------------------

const SHUTOFFS = 'yolink-shutoffs.json';
/** The shutoffs kept in /data, at most this many. */
export const MAX_SHUTOFFS = 16;
const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;

/** The list read back, repaired: `[{ id, name, at }]`, unknown fields and bad entries dropped. */
export function normalizeShutoffs(raw) {
  const list = [];
  const entries = raw?.version === 1 && Array.isArray(raw.shutoffs) ? raw.shutoffs : [];
  for (const s of entries.slice(0, MAX_SHUTOFFS)) {
    if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !ID.test(s.id)) {
      continue;
    }
    if (list.some((o) => o.id === s.id)) {
      continue;
    }
    const name = typeof s.name === 'string' ? s.name.replace(CONTROL, ' ').slice(0, 80) : '';
    const at = Number.isFinite(s.at) && s.at > 0 ? s.at : 0;
    list.push({ id: s.id, name, at });
  }
  return list;
}

/**
 * The shutoffs kept before a restart: `{ ok, list }`. A missing file is an
 * empty list; a file that cannot be read (`ok` false) is read again later,
 * never taken for empty; a file that is not JSON is dropped (logged by the
 * caller through `error`).
 */
export async function loadShutoffs(dir) {
  if (!dir) {
    return { ok: true, list: [] };
  }
  let text;
  try {
    text = await readFile(join(dir, SHUTOFFS), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { ok: true, list: [] };
    }
    return { ok: false, list: [], error: err };
  }
  try {
    return { ok: true, list: normalizeShutoffs(JSON.parse(text)) };
  } catch (err) {
    return { ok: true, list: [], error: err };
  }
}

/** Writes the shutoffs kept (temporary file then rename). */
export async function saveShutoffs(dir, list) {
  if (!dir) {
    return;
  }
  await mkdir(dir, { recursive: true });
  const target = join(dir, SHUTOFFS);
  const body = JSON.stringify({ version: 1, shutoffs: list.slice(0, MAX_SHUTOFFS) });
  await writeFile(`${target}.tmp`, body, 'utf8');
  await rename(`${target}.tmp`, target);
}
