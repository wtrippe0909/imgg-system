#!/usr/bin/env node
// Push releases listed in .new-releases.json to whichever targets are configured:
//   SLACK_WEBHOOK_URL                               Slack incoming webhook
//   AIRTABLE_TOKEN + AIRTABLE_BASE_ID + AIRTABLE_TABLE   one record per release
//   NOTION_TOKEN + NOTION_DATABASE_ID               one page per release
//   WEBHOOK_URL                                     raw JSON POST (Zapier, Make, IFTTT…)
// Missing targets are skipped. --dry-run prints payloads instead of sending.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const env = process.env;
const DRY = process.argv.includes('--dry-run');

export function slackPayload(releases) {
  return {
    text: `${releases.length} new release(s) on Bandcamp`,
    blocks: releases.map((r) => ({
      type: 'section',
      text: { type: 'mrkdwn', text: `*${r.project}* — <${r.url}|${r.title}>${r.date ? `\n${r.date}` : ''}${r.tracks?.length ? ` · ${r.tracks.length} track(s)` : ''}` },
      ...(r.image ? { accessory: { type: 'image', image_url: r.image, alt_text: r.title } } : {}),
    })),
  };
}

export function airtableRecords(releases) {
  return releases.map((r) => ({
    fields: {
      Title: r.title,
      Project: r.project,
      URL: r.url,
      Type: r.type,
      ...(r.date ? { 'Release date': r.date } : {}),
      Tracks: r.tracks?.length ?? 0,
      ...(r.price != null ? { Price: r.price } : {}),
      Tags: (r.tags || []).join(', '),
    },
  }));
}

export function notionPage(r, databaseId) {
  return {
    parent: { database_id: databaseId },
    properties: {
      Name: { title: [{ text: { content: r.title || r.url } }] },
      Project: { rich_text: [{ text: { content: r.project } }] },
      URL: { url: r.url },
      ...(r.date ? { 'Release date': { date: { start: r.date } } } : {}),
    },
    ...(r.image ? { cover: { type: 'external', external: { url: r.image } } } : {}),
  };
}

async function post(name, url, body, headers = {}) {
  if (DRY) { console.log(`[dry-run] ${name} → ${url}\n${JSON.stringify(body, null, 2)}`); return; }
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} ${await res.text()}`);
  console.log(`${name}: sent`);
}

async function main() {
  let releases = [];
  try { releases = JSON.parse(await readFile(new URL('../.new-releases.json', import.meta.url), 'utf8')); } catch { /* none */ }
  if (!releases.length) { console.log('No new releases to announce.'); return; }

  const jobs = [];
  if (env.SLACK_WEBHOOK_URL) jobs.push(() => post('Slack', env.SLACK_WEBHOOK_URL, slackPayload(releases)));
  if (env.AIRTABLE_TOKEN && env.AIRTABLE_BASE_ID && env.AIRTABLE_TABLE) {
    const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(env.AIRTABLE_TABLE)}`;
    const records = airtableRecords(releases);
    for (let i = 0; i < records.length; i += 10) { // Airtable caps batches at 10
      const chunk = records.slice(i, i + 10);
      jobs.push(() => post('Airtable', url, { records: chunk, typecast: true }, { authorization: `Bearer ${env.AIRTABLE_TOKEN}` }));
    }
  }
  if (env.NOTION_TOKEN && env.NOTION_DATABASE_ID) {
    for (const r of releases) {
      jobs.push(() => post('Notion', 'https://api.notion.com/v1/pages', notionPage(r, env.NOTION_DATABASE_ID), {
        authorization: `Bearer ${env.NOTION_TOKEN}`, 'notion-version': '2022-06-28',
      }));
    }
  }
  if (env.WEBHOOK_URL) jobs.push(() => post('Webhook', env.WEBHOOK_URL, { releases }));

  if (!jobs.length) { console.log(`${releases.length} new release(s), but no notification targets are configured.`); return; }
  let failed = 0;
  for (const job of jobs) { try { await job(); } catch (e) { failed++; console.error(e.message); } }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
