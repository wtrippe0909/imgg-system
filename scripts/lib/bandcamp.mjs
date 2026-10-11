// Parsing helpers for public Bandcamp artist and release pages.
// Prefers the structured data Bandcamp embeds (ld+json, data-tralbum,
// data-client-items) over markup, which changes more often.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };

export function decodeEntities(str = '') {
  return str.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, code) => {
    const lower = code.toLowerCase();
    if (lower in ENTITIES) return ENTITIES[lower];
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return m;
  });
}

export function stripTags(html = '') {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function attr(html, name) {
  const m = html.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i')) ||
    html.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`, 'i'));
  return m ? decodeEntities(m[1]) : null;
}

function jsonAttr(html, name) {
  const raw = attr(html, name);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function ldJsonBlocks(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1]);
      out.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch { /* ignore malformed block */ }
  }
  return out;
}

function findLd(html, types) {
  return ldJsonBlocks(html).find((b) => {
    const t = [].concat(b['@type'] || []);
    return t.some((x) => types.includes(x));
  }) || null;
}

export function isoDurationToSeconds(d) {
  if (!d || typeof d !== 'string') return null;
  const m = d.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/);
  if (!m) return null;
  const [, days = 0, h = 0, mi = 0, s = 0] = m;
  return Math.round(+days * 86400 + +h * 3600 + +mi * 60 + +s);
}

export function toIsoDate(value) {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

function absolute(url, base) {
  try { return new URL(url, base).href; } catch { return null; }
}

function firstImage(img) {
  if (!img) return '';
  if (Array.isArray(img)) return firstImage(img[0]);
  if (typeof img === 'object') return img.url || img.contentUrl || '';
  return img;
}

function toList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}

/** Parse an artist/label root or /music page. */
export function parseArtistPage(html, baseUrl) {
  const result = { name: '', location: '', bio: '', image: '', links: [], releaseUrls: [] };

  const nameBlock = html.match(/<p[^>]+id=["']band-name-location["'][^>]*>([\s\S]*?)<\/p>/i);
  if (nameBlock) {
    const title = nameBlock[1].match(/class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)</i);
    const loc = nameBlock[1].match(/class=["'][^"']*\blocation\b[^"']*["'][^>]*>([\s\S]*?)</i);
    if (title) result.name = stripTags(title[1]);
    if (loc) result.location = stripTags(loc[1]);
  }

  const bio = html.match(/<p[^>]+id=["']bio-text["'][^>]*>([\s\S]*?)<\/p>/i);
  if (bio) {
    result.bio = stripTags(bio[1].replace(/<span[^>]*peekaboo-link[\s\S]*?<\/span>/gi, ''));
  }

  const photo = html.match(/<img[^>]*class=["'][^"']*band-photo[^"']*["'][^>]*>/i);
  if (photo) result.image = attr(photo[0], 'src') || '';

  const linksBlock = html.match(/<ol[^>]+id=["']band-links["'][^>]*>([\s\S]*?)<\/ol>/i);
  if (linksBlock) {
    const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(linksBlock[1]))) {
      const url = absolute(decodeEntities(m[1]), baseUrl);
      if (url) result.links.push({ label: stripTags(m[2]) || url, url });
    }
  }

  const urls = new Set();
  const gridItem = /<li[^>]*class=["'][^"']*music-grid-item[^"']*["'][^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["']/gi;
  let g;
  while ((g = gridItem.exec(html))) {
    const u = absolute(decodeEntities(g[1]), baseUrl);
    if (u) urls.add(u.split('?')[0]);
  }
  // Large discographies lazy-load extra items from this JSON attribute.
  const grid = html.match(/<ol[^>]+id=["']music-grid["'][^>]*>/i);
  const clientItems = grid ? jsonAttr(grid[0], 'data-client-items') : null;
  for (const item of clientItems || []) {
    const u = item.page_url && absolute(item.page_url, baseUrl);
    if (u) urls.add(u.split('?')[0]);
  }
  result.releaseUrls = [...urls];
  return result;
}

/** Parse a single /album/ or /track/ page into a release record. */
export function parseReleasePage(html, url) {
  const ld = findLd(html, ['MusicAlbum', 'MusicRecording']);
  const tralbum = jsonAttr(html, 'data-tralbum');
  const kind = /\/track\//.test(url) ? 'track' : 'album';

  const release = {
    title: '',
    type: kind,
    url,
    date: null,
    image: '',
    price: null,
    currency: null,
    nameYourPrice: false,
    tags: [],
    about: '',
    credits: '',
    formats: [],
    tracks: [],
  };

  if (ld) {
    release.title = ld.name || '';
    release.date = toIsoDate(ld.datePublished);
    release.image = firstImage(ld.image);
    release.tags = toList(ld.keywords);
    release.about = ld.description || '';
    release.credits = ld.creditText || '';

    const items = ld.track?.itemListElement || [];
    release.tracks = items.map((el, i) => ({
      position: el.position ?? i + 1,
      title: el.item?.name || '',
      seconds: isoDurationToSeconds(el.item?.duration),
      url: el.item?.['@id'] || el.item?.url || null,
    }));
    if (!release.tracks.length && kind === 'track') {
      release.tracks = [{ position: 1, title: ld.name || '', seconds: isoDurationToSeconds(ld.duration), url }];
    }

    for (const rel of [].concat(ld.albumRelease || [])) {
      const fmt = rel.musicReleaseFormat || '';
      const label = String(fmt).split('/').pop();
      if (label) release.formats.push(label.replace(/Format$/, ''));
      const offer = [].concat(rel.offers || [])[0];
      if (/Digital/i.test(fmt) && offer && release.price == null && offer.price != null) {
        release.price = Number(offer.price);
        release.currency = offer.priceCurrency || null;
      }
    }
    release.formats = [...new Set(release.formats)];
  }

  if (tralbum) {
    release.title ||= tralbum.current?.title || '';
    release.date ||= toIsoDate(tralbum.current?.release_date || tralbum.album_release_date);
    release.about ||= tralbum.current?.about || '';
    release.credits ||= tralbum.current?.credits || '';
    const min = tralbum.current?.minimum_price;
    if (min != null && release.price == null) release.price = Number(min);
    // Bandcamp sets minimum_price 0 with set_price for name-your-price releases.
    release.nameYourPrice = min === 0 || Boolean(tralbum.freeDownloadPage);
    if (!release.tracks.length && Array.isArray(tralbum.trackinfo)) {
      release.tracks = tralbum.trackinfo.map((t, i) => ({
        position: t.track_num ?? i + 1,
        title: t.title || '',
        seconds: t.duration ? Math.round(t.duration) : null,
        url: t.title_link ? absolute(t.title_link, url) : null,
      }));
    }
  }

  if (!release.title) {
    const og = html.match(/<meta[^>]+property=["']og:title["'][^>]*>/i);
    if (og) release.title = (attr(og[0], 'content') || '').split(', by ')[0];
  }
  if (!release.image) {
    const og = html.match(/<meta[^>]+property=["']og:image["'][^>]*>/i);
    if (og) release.image = attr(og[0], 'content') || '';
  }
  return release;
}

/** Artist-level info a release page exposes via its publisher block. */
export function parsePublisherFromRelease(html) {
  const ld = findLd(html, ['MusicAlbum', 'MusicRecording']);
  const pub = ld?.publisher;
  if (!pub) return null;
  return {
    name: pub.name || '',
    bio: pub.description || '',
    location: pub.foundingLocation?.name || '',
    image: firstImage(pub.image),
    links: [].concat(pub.mainEntityOfPage || [])
      .map((l) => (typeof l === 'string' ? { label: l, url: l } : { label: l.name || l.url, url: l.url }))
      .filter((l) => l.url),
  };
}

/**
 * Merge freshly scraped data into an existing project record. Hand-edited
 * fields (tagline, genres, contact, extra links) survive; scraped facts win
 * where present.
 */
export function mergeProject(existing, scraped) {
  const merged = { ...existing };
  const isPlaceholder = (v) => typeof v === 'string' && v.startsWith('PLACEHOLDER');

  for (const key of ['name', 'location', 'bio', 'image']) {
    if (scraped[key] && (!existing[key] || isPlaceholder(existing[key]) || key !== 'bio')) {
      merged[key] = scraped[key];
    }
  }
  if (isPlaceholder(merged.tagline)) merged.tagline = '';

  const linkUrls = new Set((existing.links || []).map((l) => l.url));
  merged.links = [...(existing.links || [])];
  for (const l of scraped.links || []) if (!linkUrls.has(l.url)) merged.links.push(l);

  const tagSet = new Set(existing.tags || []);
  for (const r of scraped.releases || []) for (const t of r.tags || []) tagSet.add(t);
  merged.tags = [...tagSet];

  const byUrl = new Map((existing.releases || []).map((r) => [r.url, r]));
  merged.releases = (scraped.releases || []).map((r) => ({ ...byUrl.get(r.url), ...r }));
  // Keep releases that were added by hand and are not on Bandcamp.
  for (const r of existing.releases || []) {
    if (r.manual && !merged.releases.some((x) => x.url === r.url)) merged.releases.push(r);
  }
  merged.releases.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  merged.placeholder = false;
  return merged;
}

export function newReleases(before, after) {
  const seen = new Set();
  for (const p of before.projects || []) for (const r of p.releases || []) seen.add(r.url);
  const fresh = [];
  for (const p of after.projects || []) {
    for (const r of p.releases || []) if (!seen.has(r.url)) fresh.push({ project: p.name, projectId: p.id, ...r });
  }
  return fresh;
}
