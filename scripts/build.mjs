#!/usr/bin/env node
// Render the static site from data/projects.json into dist/.
//   dist/index.html            hub: roster + combined discography
//   dist/<id>/index.html       press kit per project
//   dist/audit.html            audit report
// --inline embeds the stylesheet in every page (single-file pages for sharing).

import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { auditData } from './audit.mjs';
import { ownerOf, ownReleases } from './lib/bandcamp.mjs';

const root = new URL('../', import.meta.url);
const INLINE = process.argv.includes('--inline');
const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet">';

export const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const isPlaceholder = (v) => !v || String(v).startsWith('PLACEHOLDER');
const initials = (name) => name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '♪';
const fmtTime = (s) => (s == null ? '' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
const year = (d) => (d ? d.slice(0, 4) : '');

function art(src, name) {
  return `<div class="art">${src ? `<img src="${esc(src)}" alt="" loading="lazy">` : esc(initials(name))}</div>`;
}

function priceLabel(r) {
  if (r.nameYourPrice) return r.price ? `name your price (min ${r.price}${r.currency ? ' ' + r.currency : ''})` : 'name your price';
  if (r.price == null) return '';
  return r.price === 0 ? 'free' : `${r.price}${r.currency ? ' ' + r.currency : ''}`;
}

function layout({ title, description, body, depth = 0, css, current, data }) {
  const up = '../'.repeat(depth);
  const nav = [
    ['index.html', 'Home', 'home'],
    ...data.projects.map((p) => [`${p.id}/index.html`, p.name, p.id]),
    ['audit.html', 'Audit', 'audit'],
  ].map(([href, label, key]) => `<a href="${up}${href}"${current === key ? ' aria-current="page"' : ''}>${esc(label)}</a>`).join('');
  const style = INLINE ? `<style>${css}</style>` : `<link rel="stylesheet" href="${up}styles.css">`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${FONTS}
${style}
</head>
<body>
<header class="topbar"><div class="wrap"><a class="brand" href="${up}index.html">IMGG System</a><nav class="nav">${nav}</nav></div></header>
<main class="wrap">
${body}
</main>
<footer class="wrap">Data ${data.updatedAt ? `synced from Bandcamp ${esc(data.updatedAt.slice(0, 10))}` : 'not yet synced from Bandcamp'} · <a href="https://github.com/wtrippe0909/imgg-system">source</a></footer>
</body>
</html>
`;
}

function placeholderNotice(projects) {
  const ph = projects.filter((p) => p.placeholder);
  if (!ph.length) return '';
  return `<div class="notice"><strong>Placeholder content.</strong> ${esc(ph.map((p) => p.name).join(', '))} ${ph.length === 1 ? 'has' : 'have'} not been synced from Bandcamp yet. Run <code>npm run fetch</code> with bandcamp.com reachable, or edit <code>data/projects.json</code>.</div>`;
}

export function renderHome(data, css) {
  // A label page lists its artists' releases too; show each release once,
  // under the project whose Bandcamp domain hosts it.
  const byUrl = new Map();
  for (const p of data.projects) {
    for (const r of p.releases || []) {
      if (!byUrl.has(r.url)) byUrl.set(r.url, { ...r, project: ownerOf(r, data.projects, p), listedBy: new Set() });
      byUrl.get(r.url).listedBy.add(p.id);
    }
  }
  const all = [...byUrl.values()].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const roster = data.projects.map((p) => {
    const own = ownReleases(p, data.projects).length;
    const listed = (p.releases || []).length - own;
    const counts = [
      listed && !own ? 'Label' : '',
      own ? `${own} release${own === 1 ? '' : 's'}` : '',
      listed ? `${listed} from roster` : '',
      !own && !listed ? (p.status === 'upcoming' ? 'Coming soon' : 'No releases yet') : '',
    ].filter(Boolean);
    return `
  <article class="card">
    ${art(p.image, p.name)}
    <div class="body">
      <h3>${esc(p.name)}</h3>
      ${!isPlaceholder(p.tagline) ? `<p class="muted">${esc(p.tagline)}</p>` : ''}
      <p class="muted">${[p.location, ...counts].filter(Boolean).map(esc).join(' · ')}</p>
      <div class="actions"><a class="btn primary" href="${esc(p.id)}/index.html">Press kit</a><a class="btn" href="${esc(p.bandcampUrl)}">Bandcamp</a></div>
    </div>
  </article>`;
  }).join('');

  const chips = [`<button class="chip" aria-pressed="true" data-filter="all">All</button>`,
    ...data.projects.map((p) => `<button class="chip" aria-pressed="false" data-filter="${esc(p.id)}">${esc(p.name)}</button>`)].join('');

  const releases = all.length
    ? `<div class="grid" id="discography">${all.map((r) => `
      <article class="card" data-projects="${esc([...new Set([r.project.id, ...r.listedBy])].join(' '))}">
        <a href="${esc(r.url)}">${art(r.image, r.title || r.project.name)}</a>
        <div class="body">
          <h3><a href="${esc(r.url)}">${esc(r.title)}</a></h3>
          <p class="muted">${esc(r.project.name)}${r.date ? ` · ${esc(year(r.date))}` : ''}${r.tracks?.length ? ` · ${r.tracks.length} track${r.tracks.length === 1 ? '' : 's'}` : ''}</p>
          ${priceLabel(r) ? `<p class="muted">${esc(priceLabel(r))}</p>` : ''}
        </div>
      </article>`).join('')}</div>`
    : '<div class="empty">No releases loaded yet. They will appear here after the first Bandcamp sync.</div>';

  const body = `
<section class="hero">
  <h1>IMGG System</h1>
  <p>${data.projects.length} projects on Bandcamp. ${data.projects.map((p) => esc(p.name)).join(', ')}.</p>
</section>
${placeholderNotice(data.projects)}
<h2>Projects</h2>
<div class="grid">${roster}</div>
<h2>Discography</h2>
<div class="chips no-print" role="group" aria-label="Filter by project">${chips}</div>
${releases}
<script>
document.querySelectorAll('.chip').forEach(function (chip) {
  chip.addEventListener('click', function () {
    var f = chip.dataset.filter;
    document.querySelectorAll('.chip').forEach(function (c) { c.setAttribute('aria-pressed', String(c === chip)); });
    document.querySelectorAll('#discography [data-projects]').forEach(function (el) {
      el.hidden = f !== 'all' && el.dataset.projects.split(' ').indexOf(f) === -1;
    });
  });
});
</script>`;
  return layout({ title: 'IMGG System', description: `Hub for ${data.projects.map((p) => p.name).join(', ')}.`, body, css, current: 'home', data });
}

export function renderKit(p, data, css) {
  const releases = p.releases || [];
  const tags = [...new Set([...(p.genres || []), ...(p.tags || [])])];
  const facts = [
    ['Location', p.location],
    ['Releases', releases.length ? String(releases.length) : ''],
    ['Latest', releases[0] ? `${releases[0].title}${releases[0].date ? ` (${year(releases[0].date)})` : ''}` : ''],
    ['Contact', p.contact],
  ].filter(([, v]) => v);

  const body = `
${p.placeholder ? placeholderNotice([p]) : ''}
<section class="kit-head">
  ${art(p.image, p.name)}
  <div>
    <p class="muted">Press kit</p>
    <h1>${esc(p.name)}</h1>
    ${!isPlaceholder(p.tagline) ? `<p>${esc(p.tagline)}</p>` : ''}
    <div class="actions no-print" style="display:flex;gap:8px;flex-wrap:wrap">
      <a class="btn primary" href="${esc(p.bandcampUrl)}">Listen on Bandcamp</a>
      <button class="btn" onclick="window.print()">Print / save PDF</button>
    </div>
  </div>
</section>
${facts.length ? `<ul class="facts">${facts.map(([k, v]) => `<li><b>${esc(k)}</b>${k === 'Contact' && v.includes('@') ? `<a href="mailto:${esc(v)}">${esc(v)}</a>` : esc(v)}</li>`).join('')}</ul>` : ''}
${isPlaceholder(p.bio) && p.status === 'upcoming' ? '' : `<h2>Bio</h2><p class="bio">${isPlaceholder(p.bio) ? '<span class="muted">Bio not added yet.</span>' : esc(p.bio)}</p>`}
${tags.length ? `<h2>Sound</h2><p>${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</p>` : ''}
<h2>Links</h2>
<ul>${(p.links || []).map((l) => `<li><a href="${esc(l.url)}">${esc(l.label)}</a></li>`).join('')}</ul>
<h2>Discography</h2>
${releases.length ? releases.map((r) => `
<article class="release">
  <a href="${esc(r.url)}">${art(r.image, r.title || p.name)}</a>
  <div>
    <h3><a href="${esc(r.url)}">${esc(r.title)}</a></h3>
    ${ownerOf(r, data.projects, p) !== p ? `<p class="muted">by ${esc(ownerOf(r, data.projects, p).name)}</p>` : ''}
    <p class="muted">${[r.type === 'track' ? 'Single' : 'Album/EP', r.date, priceLabel(r), (r.formats || []).filter((f) => !/Digital/i.test(f)).join(', ')].filter(Boolean).map(esc).join(' · ')}</p>
    ${r.about ? `<p class="bio">${esc(r.about.length > 400 ? r.about.slice(0, 400) + '…' : r.about)}</p>` : ''}
    ${(r.tags || []).length ? `<p>${r.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</p>` : ''}
    ${(r.tracks || []).length > 1 ? `<ol class="tracks">${r.tracks.map((t) => `<li>${esc(t.title)}<span>${fmtTime(t.seconds)}</span></li>`).join('')}</ol>` : ''}
  </div>
</article>`).join('') : `<div class="empty">${p.status === 'upcoming' ? 'First release coming soon.' : 'No releases loaded yet.'}</div>`}`;
  return layout({ title: `${p.name} press kit`, description: `Press kit for ${p.name}.`, body, depth: 1, css, current: p.id, data });
}

export function renderAudit(data, css) {
  const results = auditData(data);
  const count = (r, l) => r.issues.filter((i) => i.level === l).length;
  const body = `
<section class="hero"><h1>Bandcamp audit</h1>
<p>Checks each project’s data against Bandcamp discovery and sales practices. ${data.updatedAt ? `Based on the sync from ${esc(data.updatedAt.slice(0, 10))}.` : 'Not synced from Bandcamp yet, so this mostly flags missing data.'}</p></section>
<div class="table-scroll"><table>
<thead><tr><th>Project</th><th class="num">Score</th><th class="num">High</th><th class="num">Medium</th><th class="num">Low</th></tr></thead>
<tbody>${results.map((r) => `<tr><td><a href="#${esc(r.project.id)}">${esc(r.project.name)}</a></td><td class="num">${r.score}</td><td class="num">${count(r, 'high')}</td><td class="num">${count(r, 'medium')}</td><td class="num">${count(r, 'low')}</td></tr>`).join('')}</tbody>
</table></div>
${results.map((r) => `
<h2 id="${esc(r.project.id)}">${esc(r.project.name)} <span class="muted">${r.score}/100</span></h2>
${r.issues.length ? `<ul class="issues">${r.issues.map((i) => `<li class="${i.level}"><span class="area">${esc(i.area)}:</span> ${esc(i.msg)}<span class="fix">${esc(i.fix)}</span></li>`).join('')}</ul>` : '<p>No issues found.</p>'}`).join('')}`;
  return layout({ title: 'Bandcamp audit', description: 'Audit of the IMGG System Bandcamp pages.', body, css, current: 'audit', data });
}

async function main() {
  const data = JSON.parse(await readFile(new URL('data/projects.json', root), 'utf8'));
  const css = await readFile(new URL('site/styles.css', root), 'utf8');
  const dist = new URL('dist/', root);
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  await writeFile(new URL('index.html', dist), renderHome(data, css));
  await writeFile(new URL('audit.html', dist), renderAudit(data, css));
  for (const p of data.projects) {
    await mkdir(new URL(`${p.id}/`, dist), { recursive: true });
    await writeFile(new URL(`${p.id}/index.html`, dist), renderKit(p, data, css));
  }
  if (!INLINE) await writeFile(new URL('styles.css', dist), css);
  await writeFile(new URL('data.json', dist), JSON.stringify(data, null, 2));
  await writeFile(new URL('.nojekyll', dist), '');
  console.log(`Built ${data.projects.length + 2} pages into dist/${INLINE ? ' (inline CSS)' : ''}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
