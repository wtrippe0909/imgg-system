import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderHome, renderKit, renderAudit, esc } from '../scripts/build.mjs';
import { auditData } from '../scripts/audit.mjs';
import { slackPayload, airtableRecords, notionPage } from '../scripts/notify.mjs';

const data = JSON.parse(readFileSync(new URL('../data/projects.json', import.meta.url), 'utf8'));
const synced = {
  updatedAt: '2026-10-01T00:00:00Z',
  projects: [{
    id: 'a', name: 'A <b>', bandcampUrl: 'https://a.bandcamp.com/', placeholder: false, tagline: 'hi',
    bio: 'x'.repeat(200), location: 'ATL', image: 'https://i/a.jpg', contact: 'a@b.c', tags: ['t1', 't2', 't3', 't4', 't5'],
    links: [{ label: 'IG', url: 'https://ig' }],
    releases: [{ url: 'https://a.bandcamp.com/album/r', title: 'R', type: 'album', date: '2026-09-01', image: 'https://i/r.jpg',
      price: 7, currency: 'USD', tags: ['t1', 't2', 't3', 't4', 't5'], about: 'about', credits: 'c', formats: ['Digital', 'Vinyl'],
      tracks: [{ title: 'One', seconds: 61 }, { title: 'Two', seconds: 120 }] }],
  }],
};

test('placeholder data renders with a notice and no releases', () => {
  const html = renderHome(data, '');
  assert.match(html, /Placeholder content/);
  assert.match(html, /No releases loaded yet/);
  for (const p of data.projects) assert.match(renderKit(p, data, ''), new RegExp(p.name));
});

test('synced data renders releases and escapes html', () => {
  const home = renderHome(synced, '');
  assert.doesNotMatch(home, /Placeholder content/);
  assert.match(home, /A &lt;b&gt;/);
  const kit = renderKit(synced.projects[0], synced, '');
  assert.match(kit, /1:01/);
  assert.match(kit, /Vinyl/);
  assert.match(kit, /mailto:a@b.c/);
  assert.equal(esc(`"<'&>`), '&quot;&lt;&#39;&amp;&gt;');
});

test('audit flags placeholders and passes a complete project', () => {
  const ph = auditData(data);
  assert.ok(ph.every((r) => r.issues.some((i) => i.level === 'high')));
  const [ok] = auditData(synced, new Date('2026-10-11'));
  assert.equal(ok.issues.length, 0, JSON.stringify(ok.issues));
  assert.equal(ok.score, 100);
  assert.match(renderAudit(synced, ''), /100/);
});

test('notification payloads', () => {
  const rel = [{ project: 'A', title: 'R', url: 'https://r', date: '2026-01-01', tracks: [{}], tags: ['x'], type: 'album', price: 5 }];
  assert.match(slackPayload(rel).blocks[0].text.text, /<https:\/\/r\|R>/);
  assert.equal(airtableRecords(rel)[0].fields.Tracks, 1);
  assert.equal(notionPage(rel[0], 'db').properties.URL.url, 'https://r');
});
