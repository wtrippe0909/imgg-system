import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderHome, renderKit, renderAudit, esc } from '../scripts/build.mjs';
import { auditData } from '../scripts/audit.mjs';
import { slackPayload, airtableRecords, notionPage } from '../scripts/notify.mjs';

const data = JSON.parse(readFileSync(new URL('./fixtures/placeholder-projects.json', import.meta.url), 'utf8'));
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

test('label + artist: discography shows each release once, audit counts it once', () => {
  const rel = { url: 'https://artist.bandcamp.com/album/a', title: 'Only Once', type: 'album', date: '2026-01-01', image: 'i', price: 0, nameYourPrice: true, tags: ['a', 'b', 'c', 'd', 'e'], about: 'x', credits: 'y', formats: ['Digital', 'Cassette'], tracks: [] };
  const base = { bio: 'b'.repeat(200), location: 'L', image: 'i', contact: 'c@d.e', tags: [], placeholder: false };
  const d = {
    updatedAt: '2026-10-01T00:00:00Z',
    projects: [
      { ...base, id: 'label', name: 'Label', bandcampUrl: 'https://label.bandcamp.com/', links: [{ label: 'IG', url: 'https://ig' }], releases: [rel] },
      { ...base, id: 'artist', name: 'Artist', bandcampUrl: 'https://artist.bandcamp.com/', links: [{ label: 'IG', url: 'https://ig' }, { label: 'L', url: 'https://label.bandcamp.com/' }], releases: [rel] },
    ],
  };
  const home = renderHome(d, '');
  assert.equal(home.split('>Only Once<').length - 1, 1);
  assert.match(home, /Label · 1 from roster/);
  assert.match(renderKit(d.projects[0], d, ''), /by Artist/);
  const [labelAudit, artistAudit] = auditData(d, new Date('2026-10-11'));
  assert.ok(!labelAudit.issues.some((i) => /Only Once/.test(i.msg)));
  assert.ok(!labelAudit.issues.some((i) => i.area === 'Cross-promotion'));
  assert.ok(artistAudit.issues.length === 0, JSON.stringify(artistAudit.issues));
});

test('all-free catalogue gets a pricing note', () => {
  const r = (n) => ({ url: `https://a.bandcamp.com/album/${n}`, title: n, type: 'album', date: '2026-09-01', image: 'i', price: 0, nameYourPrice: true, tags: ['a', 'b', 'c', 'd', 'e'], about: 'x', credits: 'y', formats: ['Digital', 'Vinyl'], tracks: [] });
  const d = { projects: [{ ...synced.projects[0], releases: [r('x'), r('y'), r('z')] }] };
  const [res] = auditData(d, new Date('2026-10-11'));
  assert.ok(res.issues.some((i) => /All 3 releases are name-your-price/.test(i.msg)));
});

test('label filter chip includes roster releases', () => {
  const rel = { url: 'https://artist.bandcamp.com/album/a', title: 'R', date: '2026-01-01', tracks: [] };
  const d = { projects: [
    { id: 'label', name: 'Label', bandcampUrl: 'https://label.bandcamp.com/', links: [], releases: [rel] },
    { id: 'artist', name: 'Artist', bandcampUrl: 'https://artist.bandcamp.com/', links: [], releases: [rel] },
  ] };
  assert.match(renderHome(d, ''), /data-projects="artist label"/);
});

test('upcoming project: coming soon on site, launch note instead of missing-release error', async () => {
  const { mergeProject } = await import('../scripts/lib/bandcamp.mjs');
  const up = { id: 'u', name: 'Upcoming', bandcampUrl: 'https://u.bandcamp.com/', status: 'upcoming', placeholder: false, bio: '', links: [], releases: [] };
  const d = { projects: [up] };
  assert.match(renderHome(d, ''), /Coming soon/);
  const kit = renderKit(up, d, '');
  assert.match(kit, /First release coming soon/);
  assert.doesNotMatch(kit, /<h2>Bio<\/h2>/);
  const [res] = auditData(d);
  assert.ok(!res.issues.some((i) => i.area === 'Catalogue'));
  assert.ok(res.issues.some((i) => i.area === 'Launch'));
  // First release clears the upcoming state.
  const after = mergeProject(up, { name: 'Upcoming', releases: [{ url: 'https://u.bandcamp.com/track/x', title: 'X' }] });
  assert.equal(after.status, undefined);
  // An empty sync keeps it upcoming.
  assert.equal(mergeProject(up, { releases: [] }).status, 'upcoming');
});
