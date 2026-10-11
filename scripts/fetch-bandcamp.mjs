#!/usr/bin/env node
// Scrape each project's public Bandcamp page into data/projects.json.
//   npm run fetch                 all projects
//   npm run fetch -- gfed0909     one project by id
// Writes .new-releases.json listing releases not seen before (used by notify).

import { readFile, writeFile } from 'node:fs/promises';
import {
  parseArtistPage, parseReleasePage, parsePublisherFromRelease, mergeProject, newReleases,
} from './lib/bandcamp.mjs';

const DATA = new URL('../data/projects.json', import.meta.url);
const NEW_FILE = new URL('../.new-releases.json', import.meta.url);
const DELAY_MS = Number(process.env.BANDCAMP_DELAY_MS ?? 1500);
const UA = 'imgg-system/1.0 (personal discography sync)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, attempt = 1) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
    if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} for ${url}`), { fatal: true });
    return { html: await res.text(), finalUrl: res.url };
  } catch (err) {
    if (err.fatal || attempt >= 4) throw err;
    await sleep(2 ** attempt * 1000);
    return get(url, attempt + 1);
  }
}

async function scrapeProject(project) {
  const base = project.bandcampUrl.replace(/\/?$/, '/');
  // /music lists everything; with a single release Bandcamp redirects to it.
  const { html, finalUrl } = await get(`${base}music`);
  const artist = parseArtistPage(html, base);
  let releaseUrls = artist.releaseUrls;
  if (!releaseUrls.length && /\/(album|track)\//.test(finalUrl)) releaseUrls = [finalUrl];

  // The bio/photo block sits on the root page when /music had none.
  if (!artist.bio && !/\/(album|track)\//.test(finalUrl)) {
    await sleep(DELAY_MS);
    const root = parseArtistPage((await get(base)).html, base);
    for (const k of ['name', 'location', 'bio', 'image']) artist[k] ||= root[k];
    if (!artist.links.length) artist.links = root.links;
  }

  const releases = [];
  for (const url of releaseUrls) {
    await sleep(DELAY_MS);
    const page = await get(url);
    releases.push(parseReleasePage(page.html, url));
    const pub = parsePublisherFromRelease(page.html);
    if (pub) {
      for (const k of ['name', 'location', 'bio', 'image']) artist[k] ||= pub[k];
      if (!artist.links.length) artist.links = pub.links;
    }
    console.log(`  · ${releases.at(-1).title || url}`);
  }
  if (!releases.length && !artist.name) {
    const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]?.trim();
    const markers = ['band-name-location', 'music-grid', 'data-tralbum', 'application/ld+json']
      .map((m) => `${m}:${html.includes(m) ? 'yes' : 'no'}`).join(' ');
    console.warn(`  ! nothing recognised. landed on ${finalUrl} | title: ${JSON.stringify(title)} | ${html.length} bytes | ${markers}`);
  }
  return { ...artist, releases };
}

async function main() {
  const only = process.argv[2];
  const before = JSON.parse(await readFile(DATA, 'utf8'));
  const after = structuredClone(before);
  let failures = 0;
  let synced = 0;

  for (const [i, project] of after.projects.entries()) {
    if (only && project.id !== only) continue;
    console.log(`→ ${project.name} (${project.bandcampUrl})`);
    try {
      after.projects[i] = mergeProject(project, await scrapeProject(project));
      synced++;
      console.log(`  ${after.projects[i].releases.length} release(s)`);
    } catch (err) {
      failures++;
      console.error(`  ✗ ${err.message}`);
      if (err.cause?.code === 'ENOTFOUND' || /CONNECT|403/.test(String(err.cause ?? err))) {
        console.error('  bandcamp.com may be blocked by your network policy.');
      }
    }
  }

  // A project's first sync would flag its whole back catalogue as "new".
  const firstSync = new Set(before.projects.filter((p) => p.placeholder).map((p) => p.id));
  const fresh = newReleases(before, after).filter((r) => !firstSync.has(r.projectId));

  await writeFile(NEW_FILE, JSON.stringify(fresh, null, 2) + '\n');
  if (synced) {
    after.updatedAt = new Date().toISOString();
    await writeFile(DATA, JSON.stringify(after, null, 2) + '\n');
    console.log(`\n${fresh.length} new release(s). Data written to data/projects.json`);
  } else {
    console.log('\nNothing synced; data/projects.json left unchanged.');
  }
  if (failures) process.exitCode = 1;
}

main();
