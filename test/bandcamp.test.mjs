import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseArtistPage, parseReleasePage, parsePublisherFromRelease, isoDurationToSeconds,
  mergeProject, newReleases, decodeEntities,
} from '../scripts/lib/bandcamp.mjs';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');

test('parses artist /music page', () => {
  const a = parseArtistPage(fx('artist-music.html'), 'https://example.bandcamp.com/');
  assert.equal(a.name, 'Example Artist');
  assert.equal(a.location, 'Atlanta, Georgia');
  assert.equal(a.bio, 'Dusty loops & late-night synths.\nBased in ATL.');
  assert.equal(a.image, 'https://f4.bcbits.com/img/0000001_21.jpg');
  assert.deepEqual(a.links.map((l) => l.label), ['Instagram', 'gfed0909']);
  assert.deepEqual(a.releaseUrls, [
    'https://example.bandcamp.com/album/first-light',
    'https://example.bandcamp.com/track/single-one',
    'https://example.bandcamp.com/album/late-items',
  ]);
});

test('parses album page structured data', () => {
  const r = parseReleasePage(fx('album.html'), 'https://example.bandcamp.com/album/first-light');
  assert.equal(r.title, 'First Light');
  assert.equal(r.type, 'album');
  assert.equal(r.date, '2025-02-14');
  assert.equal(r.price, 7);
  assert.equal(r.currency, 'USD');
  assert.equal(r.nameYourPrice, false);
  assert.deepEqual(r.tags, ['electronic', 'ambient', 'Atlanta']);
  assert.deepEqual(r.formats, ['Digital', 'Cassette']);
  assert.deepEqual(r.tracks.map((t) => [t.title, t.seconds]), [['Dawn', 200], ['Track 2', 245]]);
  const pub = parsePublisherFromRelease(fx('album.html'));
  assert.equal(pub.location, 'Atlanta, Georgia');
  assert.equal(pub.links[0].url, 'https://instagram.com/example');
});

test('falls back to og tags and data-tralbum', () => {
  const html = `<meta property="og:title" content="Lone, by X"><meta property="og:image" content="https://i/x.jpg">
    <div data-tralbum="{&quot;current&quot;:{&quot;minimum_price&quot;:0,&quot;release_date&quot;:&quot;01 Mar 2024 00:00:00 GMT&quot;},&quot;trackinfo&quot;:[{&quot;title&quot;:&quot;Lone&quot;,&quot;duration&quot;:61.4,&quot;track_num&quot;:1}]}"></div>`;
  const r = parseReleasePage(html, 'https://x.bandcamp.com/track/lone');
  assert.equal(r.title, 'Lone');
  assert.equal(r.type, 'track');
  assert.equal(r.image, 'https://i/x.jpg');
  assert.equal(r.date, '2024-03-01');
  assert.equal(r.nameYourPrice, true);
  assert.deepEqual(r.tracks, [{ position: 1, title: 'Lone', seconds: 61, url: null }]);
});

test('helpers', () => {
  assert.equal(isoDurationToSeconds('P00H01M02S'), 62);
  assert.equal(isoDurationToSeconds('garbage'), null);
  assert.equal(decodeEntities('a &amp; b &#39;c&#x27;'), "a & b 'c'");
});

test('mergeProject keeps hand edits and drops placeholders', () => {
  const existing = {
    id: 'x', name: 'x', placeholder: true, tagline: 'PLACEHOLDER – t', bio: 'PLACEHOLDER – b',
    contact: 'me@example.com', links: [{ label: 'Bandcamp', url: 'https://x.bandcamp.com/' }], tags: [],
    releases: [{ url: 'https://x/manual', title: 'Live tape', manual: true, date: '2020-01-01' }],
  };
  const m = mergeProject(existing, {
    name: 'X', bio: 'Real bio', location: 'ATL', image: '', links: [{ label: 'IG', url: 'https://ig' }],
    releases: [{ url: 'https://x/a', title: 'A', date: '2025-01-01', tags: ['ambient'] }],
  });
  assert.equal(m.placeholder, false);
  assert.equal(m.bio, 'Real bio');
  assert.equal(m.tagline, '');
  assert.equal(m.contact, 'me@example.com');
  assert.deepEqual(m.links.map((l) => l.label), ['Bandcamp', 'IG']);
  assert.deepEqual(m.releases.map((r) => r.title), ['A', 'Live tape']);
  assert.deepEqual(m.tags, ['ambient']);

  const again = mergeProject({ ...m, bio: 'Edited by hand' }, { bio: 'Scraped bio', releases: [] });
  assert.equal(again.bio, 'Edited by hand');
});

test('newReleases reports only unseen urls', () => {
  const before = { projects: [{ id: 'a', name: 'A', releases: [{ url: 'u1' }] }] };
  const after = { projects: [{ id: 'a', name: 'A', releases: [{ url: 'u1' }, { url: 'u2', title: 'New' }] }] };
  assert.deepEqual(newReleases(before, after).map((r) => r.url), ['u2']);
});
