# IMGG System

One home for three Bandcamp projects:

| Project | Bandcamp |
|---|---|
| IMGG | https://imgg.bandcamp.com/ |
| raquielonara988 | https://raquielonara988.bandcamp.com/ |
| gfed0909 | https://gfed0909.bandcamp.com/ |

What's here:

- **Hub site**: roster, plus a combined discography you can filter by project (`dist/index.html`).
- **Press kits**: one printable EPK page per project (`dist/<id>/index.html`). Use **Print / save PDF** to make a one-sheet.
- **Audit**: checks bios, tags, artwork, pricing, cross-links and release cadence, and gives each project a score with fixes. It writes `AUDIT.md` and `dist/audit.html`.
- **Release tracking**: a daily GitHub Action re-scrapes Bandcamp, commits changes, and announces new releases to Slack, Airtable, Notion or any webhook.

Everything is driven by **`data/projects.json`**. No dependencies; Node 20+ only.

## Getting the real data in

The repo ships with **placeholder** data. Three ways to replace it:

1. **Let GitHub Actions scrape it (easiest).** Go to *Actions → Sync Bandcamp → Run workflow*. GitHub's runners can reach bandcamp.com, so this fills in bios, releases, tracks, tags, prices and artwork, then commits the result.
2. **Run it locally:** `npm run fetch` (or `npm run fetch -- gfed0909` for one project). Your network must allow `*.bandcamp.com`.
3. **Edit by hand:** fill in `data/projects.json`. For releases that are not on Bandcamp, add `"manual": true` so syncs keep them.

Syncing never overwrites the fields you maintain by hand: `tagline`, `genres`, `contact`, extra `links`, and a `bio` you have edited. Releases are matched by URL.

### Release fields

```json
{
  "title": "First Light", "type": "album", "url": "https://…/album/first-light",
  "date": "2025-02-14", "image": "https://…jpg", "price": 7, "currency": "USD",
  "nameYourPrice": false, "tags": ["ambient"], "about": "", "credits": "",
  "formats": ["Digital", "Cassette"],
  "tracks": [{ "position": 1, "title": "Dawn", "seconds": 200, "url": null }]
}
```

## Commands

```sh
npm run fetch    # scrape Bandcamp → data/projects.json (+ .new-releases.json)
npm run audit    # → AUDIT.md
npm run build    # → dist/ (add -- --inline for single-file pages with embedded CSS)
npm run serve    # build, then serve dist/ at http://localhost:8080
npm run notify   # announce .new-releases.json (add -- --dry-run to preview)
npm test
```

## Automation setup

**Site:** in *Settings → Pages*, set **Source** to **GitHub Actions**. `Deploy site` publishes on every push to `main` and after each sync.

**Announcements:** add any of these as repository secrets (*Settings → Secrets and variables → Actions*). Targets without secrets are skipped.

| Target | Secrets | Notes |
|---|---|---|
| Slack | `SLACK_WEBHOOK_URL` | An incoming-webhook URL |
| Airtable | `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`, `AIRTABLE_TABLE` | Fields: Title, Project, URL, Type, Release date, Tracks, Price, Tags |
| Notion | `NOTION_TOKEN`, `NOTION_DATABASE_ID` | Database properties: Name (title), Project (text), URL (url), Release date (date). Share the database with the integration. |
| Anything else | `WEBHOOK_URL` | Receives `{ "releases": [...] }` (works with Zapier, Make, IFTTT) |

A project's first sync does not announce its back catalogue; only releases that appear after that are treated as new.

## Notes

- **Labels:** IMGG's Bandcamp page lists releases hosted on Raquiel Onara 988's page. Each release is credited to the project whose domain hosts it, so it appears once on the hub and is audited once. The IMGG filter and press kit still include the roster's releases.
- **Upcoming projects:** set `"status": "upcoming"` on a project with nothing released yet (gfed0909 for now). The site shows "Coming soon", the audit gives a launch checklist instead of an error, and the first release clears the status and is announced like any other new release.
- If a sync finds nothing for a project, it keeps that project's existing data and prints a `nothing recognised` line in the Actions log, showing which page it landed on.
- The scraper reads Bandcamp's embedded structured data (`ld+json`, `data-tralbum`) rather than page layout. It waits 1.5 s between requests (`BANDCAMP_DELAY_MS`) and retries on 429/5xx errors.
- Bandcamp has no public API for artist pages. If they change their markup, the parser tests in `test/` show what is expected.
