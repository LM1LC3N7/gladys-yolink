// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULTS, LANGUAGES } from '../src/config.js';
import { ACTIONS, REFRESH_INTERVAL } from '../src/constants.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) {
      yield* texts(entry, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.match(manifest.gladys_version, /^>=\d+\.\d+\.\d+$/);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-yolink:${manifest.version}`);
  assert.equal(manifest.version, JSON.parse(read('package.json')).version);
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    const docs = read(`docs/${lang}.md`);
    assert.ok(docs.length >= 300, `docs/${lang}.md is too short for the store`);
    assert.match(docs, /not\s+affiliated\s+with\s+YoSmart|sans\s+lien\s+avec\s+YoSmart/i);
  }
});

test('no mojibake (UTF-8 read as Latin-1) in the manifest and the docs', () => {
  // "Ã©" for "é", "Â " for a no-break space, "â€" for a dash…
  const mojibake = /[ÂÃ][\u0080-¿€]|â€/;
  for (const path of [
    'gladys-assistant-integration.json',
    'docs/en.md',
    'docs/fr.md',
    'README.md',
    'CHANGELOG.md',
    'TODO.md',
    'CLAUDE.md',
    'THIRD_PARTY_NOTICES.md',
  ]) {
    const text = read(path);
    assert.ok(!text.startsWith('﻿'), `${path} starts with a BOM`);
    const match = mojibake.exec(text);
    assert.equal(match, null, `${path}: mojibake "${match?.[0]}" at ${match?.index}`);
  }
});

test('every text is in English and French', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
});

test('the configuration matches the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.ok(fields[key], `${key} is not in the config_schema`);
    assert.deepEqual(fields[key].default, value, key);
  }
  assert.deepEqual(
    fields.language.options.map((o) => o.value),
    LANGUAGES,
  );
  assert.equal(fields.uaid.type, 'string');
  assert.equal(
    fields.secret_key.type,
    'secret',
    'the secret key is never sent back to the browser',
  );
  assert.equal(fields.uaid.required && fields.secret_key.required, true);
  assert.deepEqual(
    [fields.refresh_interval.min, fields.refresh_interval.max],
    [REFRESH_INTERVAL.min, REFRESH_INTERVAL.max],
  );
  for (const key of [
    'allow_unlock',
    'allow_garage_open',
    'allow_valve_open',
    'allow_valve_close',
  ]) {
    assert.equal(fields[key].type, 'boolean');
    assert.equal(fields[key].default, false, `${key} is off by default`);
  }
  for (const key of ['allow_siren_stop', 'live_events']) {
    assert.equal(fields[key].type, 'boolean');
    assert.equal(fields[key].default, true, `${key} is on by default (Louis, 2026-10-17)`);
  }
  // Live events stay on, but the option says what travels in clear, between
  // what and what, and how to turn it off.
  const live = fields.live_events.description;
  assert.match(live.en, /in clear/);
  assert.match(live.fr, /en clair/);
  for (const lang of ['en', 'fr']) {
    assert.match(live[lang], /2 h/);
    assert.match(live[lang], /mqtt\.api\.yosmart\.com/);
    assert.match(live[lang], /api-eu\.yosmart\.com/);
    assert.match(live[lang], /8003/);
  }
  assert.match(live.en, /access token/);
  assert.match(live.fr, /jeton d'accès/);
  assert.match(live.en, /Untick and save/);
  assert.match(live.fr, /Décochez et enregistrez/);
  for (const [path, heading] of [
    ['docs/en.md', /### Live events: what travels in clear/],
    ['docs/fr.md', /### Événements en direct : ce qui circule en clair/],
  ]) {
    const docs = read(path);
    assert.match(docs, heading, path);
    assert.match(docs, /mqtt\.api\.yosmart\.com:8003/, path);
  }
  assert.match(read('README.md'), /Live events are unencrypted/);
  const intro = fields.intro;
  assert.equal(intro.type, 'section');
  for (const lang of ['en', 'fr']) {
    assert.ok(intro.description[lang].length <= 1000, `intro.${lang} over 1000 characters`);
    assert.match(intro.description[lang], /YoLink/);
  }
  assert.ok(intro.links.length <= 5 && intro.links.every((l) => l.url.startsWith('https://')));
  for (const field of manifest.config_schema.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', field.key);
  }
});

test('LICENSE (Apache-2.0, standard appendix) and the notices, in the image', () => {
  const license = read('LICENSE');
  assert.match(license, /Apache License\s+Version 2\.0, January 2004/);
  assert.match(license, /Copyright \[yyyy\] \[name of copyright owner\]/);
  assert.match(read('THIRD_PARTY_NOTICES.md'), /yolink-api[\s\S]*MIT/);
  assert.match(read('Dockerfile'), /^COPY LICENSE THIRD_PARTY_NOTICES\.md \.\/$/m);
  for (const path of ['LICENSE', 'README.md', 'package.json', 'THIRD_PARTY_NOTICES.md']) {
    assert.doesNotMatch(read(path), /milcent/i, `${path} names a person`);
  }
});

test('the keys of the manifest are the keys of the code', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), `ACTIONS.${name} has no handler`);
  }
  assert.ok(handlers.includes('onSetValue'), 'the commands go through onSetValue');
  for (const action of manifest.actions) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120);
  }
});
