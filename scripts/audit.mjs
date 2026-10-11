#!/usr/bin/env node
// Audit data/projects.json against Bandcamp discovery/sales practices.
// Writes AUDIT.md. Pure function `auditData` is exported for tests.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const DAY = 86_400_000;
const isPlaceholder = (v) => !v || (typeof v === 'string' && v.startsWith('PLACEHOLDER'));

export function auditProject(p, all, today = new Date()) {
  const issues = []; // { level: 'high'|'medium'|'low', area, msg, fix }
  const add = (level, area, msg, fix) => issues.push({ level, area, msg, fix });

  if (p.placeholder) {
    add('high', 'Data', 'Project still holds placeholder data.', 'Run `npm run fetch` (needs bandcamp.com network access) or paste real details into data/projects.json.');
  }

  // Profile
  if (isPlaceholder(p.bio)) add('high', 'Profile', 'No bio.', 'Write 2–4 sentences: sound, influences, where you are based, what is new.');
  else if (p.bio.length < 150) add('medium', 'Profile', `Bio is short (${p.bio.length} chars).`, 'Aim for 150–600 characters; mention genre words people search for.');
  else if (p.bio.length > 1500) add('low', 'Profile', `Bio is long (${p.bio.length} chars).`, 'Bandcamp truncates the bio behind "more"; front-load the first 200 characters.');
  if (!p.location) add('medium', 'Profile', 'No location set.', 'Set a location in Bandcamp profile; location tags power local discovery pages.');
  if (!p.image) add('medium', 'Profile', 'No artist/label photo.', 'Upload a square-ish photo or logo (it shows on mobile above the bio).');

  const external = (p.links || []).filter((l) => !/bandcamp\.com/.test(l.url));
  if (!external.length) add('medium', 'Profile', 'No links beyond Bandcamp.', 'Add links (Instagram, SoundCloud, site, mailing list) under "Links" in profile settings.');

  const siblings = all.filter((o) => o.id !== p.id);
  const crossLinked = siblings.filter((o) => (p.links || []).some((l) => l.url.includes(new URL(o.bandcampUrl).host)));
  if (siblings.length && crossLinked.length < siblings.length) {
    const missing = siblings.filter((o) => !crossLinked.includes(o)).map((o) => o.name).join(', ');
    add('low', 'Cross-promotion', `Does not link to: ${missing}.`, 'Add the other projects to Links, and recommend each other’s releases ("If you like X, you may also like").');
  }

  // Catalogue
  const releases = p.releases || [];
  if (!releases.length && !p.placeholder) add('high', 'Catalogue', 'No releases found.', 'Publish at least one release, or check the Bandcamp URL.');

  const dated = releases.filter((r) => r.date).sort((a, b) => b.date.localeCompare(a.date));
  if (dated.length) {
    const days = Math.floor((today - new Date(dated[0].date)) / DAY);
    if (days > 365) add('medium', 'Catalogue', `Last release was ${days} days ago (${dated[0].date}).`, 'A single, remix or live track keeps the page active and triggers a fan email via Bandcamp followers.');
  }

  const tagSet = new Set(releases.flatMap((r) => r.tags || []));
  if (releases.length && tagSet.size < 5) add('medium', 'Discovery', `Only ${tagSet.size} distinct tag(s) across releases.`, 'Use 5–10 tags per release: 1–2 broad genres, 2–4 subgenres/moods, and your city.');

  const currencies = new Set(releases.map((r) => r.currency).filter(Boolean));
  if (currencies.size > 1) add('low', 'Pricing', `Mixed currencies: ${[...currencies].join(', ')}.`, 'Use one currency so prices compare cleanly on the discography.');

  for (const r of releases) {
    const where = `“${r.title || r.url}”`;
    if (!r.image) add('high', 'Release', `${where} has no artwork.`, 'Upload at least 1400×1400 artwork; releases without art rarely surface in discovery.');
    if (!r.date) add('low', 'Release', `${where} has no release date.`, 'Set the release date so it sorts correctly.');
    if (!(r.tags || []).length) add('high', 'Discovery', `${where} has no tags.`, 'Tags are how Bandcamp’s genre and location pages find you.');
    else if (r.tags.length < 5) add('low', 'Discovery', `${where} has ${r.tags.length} tag(s).`, 'Add a few more specific tags (subgenre, mood, city).');
    if (!r.about) add('low', 'Release', `${where} has no description.`, 'A short “about” paragraph adds searchable text and context for buyers.');
    if (!r.credits) add('low', 'Release', `${where} has no credits.`, 'Credit performers, mixing/mastering and artwork; collaborators share pages that credit them.');
    if (r.type === 'album' && r.price === 0 && !r.nameYourPrice) add('low', 'Pricing', `${where} is free.`, 'Consider name-your-price with $0 minimum — fans can still pay, and you collect emails on free downloads.');
    if (r.type === 'album' && (r.tracks || []).length >= 4 && r.price != null && r.price > 0 && r.price < 3) add('low', 'Pricing', `${where} is priced at ${r.price} for ${r.tracks.length} tracks.`, 'Bandcamp fans routinely pay over minimum; enable “let fans pay more” and test a higher minimum.');
    const generic = (r.tracks || []).filter((t) => /^(untitled|track\s*\d+|audio\s*\d*)$/i.test(t.title.trim()));
    if (generic.length) add('medium', 'Release', `${where} has ${generic.length} generic track title(s).`, 'Name every track; titles are indexed by search.');
  }

  const physical = releases.some((r) => (r.formats || []).some((f) => !/Digital/i.test(f)));
  if (releases.length && !physical) add('low', 'Merch', 'No physical formats or merch.', 'Even a small cassette/CD/sticker run lifts revenue; merch shows on every release page.');

  if (!p.contact) add('low', 'Press kit', 'No booking/press contact.', 'Add a contact email to data/projects.json so the press kit is usable.');

  return issues;
}

const ORDER = { high: 0, medium: 1, low: 2 };
const ICON = { high: '🔴', medium: '🟠', low: '🟡' };

export function auditData(data, today = new Date()) {
  const projects = data.projects || [];
  return projects.map((p) => {
    const issues = auditProject(p, projects, today).sort((a, b) => ORDER[a.level] - ORDER[b.level]);
    const penalty = issues.reduce((s, i) => s + ({ high: 15, medium: 7, low: 2 })[i.level], 0);
    return { project: p, issues, score: Math.max(0, 100 - penalty) };
  });
}

export function renderMarkdown(results, data) {
  const lines = ['# Bandcamp audit', ''];
  lines.push(`Generated ${new Date().toISOString().slice(0, 10)} from data/projects.json` +
    (data.updatedAt ? ` (last Bandcamp sync ${data.updatedAt.slice(0, 10)}).` : ' (never synced with Bandcamp — results reflect placeholder data).'));
  lines.push('', '| Project | Score | 🔴 | 🟠 | 🟡 |', '|---|---:|---:|---:|---:|');
  for (const r of results) {
    const c = (lvl) => r.issues.filter((i) => i.level === lvl).length;
    lines.push(`| [${r.project.name}](${r.project.bandcampUrl}) | ${r.score} | ${c('high')} | ${c('medium')} | ${c('low')} |`);
  }
  for (const r of results) {
    lines.push('', `## ${r.project.name} — ${r.score}/100`, '');
    if (!r.issues.length) { lines.push('No issues found. ✅'); continue; }
    for (const i of r.issues) lines.push(`- ${ICON[i.level]} **${i.area}:** ${i.msg} ${i.fix}`);
  }
  lines.push('');
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const data = JSON.parse(await readFile(new URL('../data/projects.json', import.meta.url), 'utf8'));
  const results = auditData(data);
  await writeFile(new URL('../AUDIT.md', import.meta.url), renderMarkdown(results, data));
  for (const r of results) console.log(`${r.project.name.padEnd(20)} ${String(r.score).padStart(3)}/100  ${r.issues.length} issue(s)`);
  console.log('Wrote AUDIT.md');
}
