import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import { google } from 'googleapis';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const CONTACTS_PATH = path.join(__dirname, 'contacts.json');
const MODEL = 'claude-opus-4-5';
const FAST_MODEL = 'claude-sonnet-4-5';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// ---------- google oauth + sheets + gmail ----------

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/spreadsheets',
];

const JOURNALIST_COLS = [
  'name', 'email', 'outlet', 'beats', 'city',
  'relationship', 'last_contacted', 'notes', 'tags', 'created_at',
];

const SEND_LOG_COLS = [
  'sent_at', 'journalist_email', 'journalist_name', 'event_name',
  'subject', 'gmail_message_id', 'status', 'error',
];

function makeOAuthClient() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set');
  }
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback'
  );
}

function getAuthorizedClient() {
  if (!process.env.GOOGLE_REFRESH_TOKEN) {
    throw new Error('GOOGLE_REFRESH_TOKEN not set. Visit /auth/google to generate one.');
  }
  const client = makeOAuthClient();
  client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return client;
}

function getSheets() {
  return google.sheets({ version: 'v4', auth: getAuthorizedClient() });
}

function getGmail() {
  return google.gmail({ version: 'v1', auth: getAuthorizedClient() });
}

function sheetId() {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error('GOOGLE_SHEET_ID not set');
  return id;
}

// rows from Sheet -> array of objects keyed by column headers
function rowsToObjects(values, cols) {
  if (!Array.isArray(values) || values.length === 0) return [];
  const header = values[0].map((h) => String(h || '').trim().toLowerCase());
  const indices = cols.map((c) => header.indexOf(c));
  return values.slice(1).map((row, i) => {
    const obj = { _rowNumber: i + 2 };  // +2 because 1-indexed and header is row 1
    cols.forEach((c, ci) => {
      const idx = indices[ci];
      obj[c] = idx >= 0 ? (row[idx] ?? '') : '';
    });
    return obj;
  });
}

function objectToRow(obj, cols) {
  return cols.map((c) => {
    const v = obj[c];
    if (Array.isArray(v)) return v.join(', ');
    return v == null ? '' : String(v);
  });
}

async function readJournalists() {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: 'journalists!A1:Z',
  });
  const objects = rowsToObjects(res.data.values || [], JOURNALIST_COLS);
  // parse beats + tags from comma-separated strings into arrays
  return objects.map((o) => ({
    ...o,
    beats: o.beats ? o.beats.split(',').map((s) => s.trim()).filter(Boolean) : [],
    tags: o.tags ? o.tags.split(',').map((s) => s.trim()).filter(Boolean) : [],
  }));
}

async function appendJournalist(j) {
  const sheets = getSheets();
  const row = objectToRow({
    name: j.name,
    email: j.email,
    outlet: j.outlet || '',
    beats: j.beats || [],
    city: j.city || '',
    relationship: j.relationship || 'cold',
    last_contacted: j.last_contacted || '',
    notes: j.notes || '',
    tags: j.tags || [],
    created_at: new Date().toISOString(),
  }, JOURNALIST_COLS);
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId(),
    range: 'journalists!A:Z',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

async function deleteJournalistRow(rowNumber) {
  // Need sheetId (tab index, numeric) not spreadsheetId
  const sheets = getSheets();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId() });
  const tab = meta.data.sheets.find((s) => s.properties.title === 'journalists');
  if (!tab) throw new Error('journalists tab not found');
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId(),
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: tab.properties.sheetId,
            dimension: 'ROWS',
            startIndex: rowNumber - 1,
            endIndex: rowNumber,
          },
        },
      }],
    },
  });
}

async function appendSendLog(entry) {
  const sheets = getSheets();
  const row = objectToRow({
    sent_at: new Date().toISOString(),
    journalist_email: entry.journalist_email || '',
    journalist_name: entry.journalist_name || '',
    event_name: entry.event_name || '',
    subject: entry.subject || '',
    gmail_message_id: entry.gmail_message_id || '',
    status: entry.status || 'sent',
    error: entry.error || '',
  }, SEND_LOG_COLS);
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId(),
    range: 'send_log!A:Z',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

function base64UrlEncode(str) {
  return Buffer.from(str, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildMimeMessage({ from, to, subject, body }) {
  const boundary = 'amplify_' + randomUUID().replace(/-/g, '');
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: text/plain; charset="UTF-8"`,
    'Content-Transfer-Encoding: 7bit',
  ].join('\r\n');
  return `${headers}\r\n\r\n${body}`;
}

async function sendGmail({ to, subject, body }) {
  const gmail = getGmail();
  const from = process.env.SENDER_EMAIL;
  if (!from) throw new Error('SENDER_EMAIL not set');
  const raw = base64UrlEncode(buildMimeMessage({ from, to, subject, body }));
  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });
  return { id: res.data.id, threadId: res.data.threadId };
}

// ---------- oauth routes ----------

app.get('/auth/google', (req, res) => {
  try {
    const client = makeOAuthClient();
    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',  // force refresh_token on every consent
      scope: GOOGLE_SCOPES,
    });
    res.redirect(url);
  } catch (err) {
    res.status(500).send(`<pre>${err.message}</pre>`);
  }
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    const { code, error } = req.query;
    if (error) return res.status(400).send(`<pre>OAuth error: ${error}</pre>`);
    if (!code) return res.status(400).send('<pre>missing code</pre>');
    const client = makeOAuthClient();
    const { tokens } = await client.getToken(code);
    const refresh = tokens.refresh_token;
    const hasExisting = Boolean(process.env.GOOGLE_REFRESH_TOKEN);

    // Log the refresh token to server console so the operator (Aditi) can grab it.
    if (refresh) {
      console.log('\n=== GOOGLE_REFRESH_TOKEN (save this in your env) ===');
      console.log(refresh);
      console.log('=== end ===\n');
    }

    res.send(`<!doctype html>
<meta charset="utf-8" />
<title>Amplify — connected</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 640px; margin: 60px auto; padding: 0 24px; line-height: 1.5; }
  code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-size: 13px; word-break: break-all; }
  .tok { background: #fffbe6; border: 1px solid #f0c674; padding: 12px; border-radius: 8px; margin: 16px 0; word-break: break-all; font-family: monospace; font-size: 12px; }
  .ok { background: #e6ffed; border: 1px solid #34d058; padding: 12px; border-radius: 8px; }
  a { color: #0366d6; }
</style>
<h1>✅ Google connected</h1>
${refresh ? `
  <p>Your refresh token has been printed to the server console. <strong>Copy it now</strong> — Google only shows it once.</p>
  <div class="tok">${refresh}</div>
  <p><strong>Next steps:</strong></p>
  <ol>
    <li>Copy the token above.</li>
    <li>Add it to your <code>.env</code> file as <code>GOOGLE_REFRESH_TOKEN=...</code></li>
    <li>Also add it to Vercel → Settings → Environment Variables as <code>GOOGLE_REFRESH_TOKEN</code></li>
    <li>Restart the local server (<code>npm start</code>) and redeploy on Vercel</li>
  </ol>
` : `
  <div class="ok">Connected. No new refresh token was issued (you already have one). That's fine — keep using your existing <code>GOOGLE_REFRESH_TOKEN</code>.</div>
`}
<p><a href="/">← back to Amplify</a></p>
`);
  } catch (err) {
    console.error(err);
    res.status(500).send(`<pre>${err.message}\n\n${err.stack}</pre>`);
  }
});

app.get('/api/connection-status', (_req, res) => {
  const hasClient = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const hasToken = Boolean(process.env.GOOGLE_REFRESH_TOKEN);
  const hasSheet = Boolean(process.env.GOOGLE_SHEET_ID);
  const hasSender = Boolean(process.env.SENDER_EMAIL);
  const sheetUrl = hasSheet
    ? `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID}/edit`
    : null;
  res.json({
    connected: hasClient && hasToken && hasSheet && hasSender,
    hasClient, hasToken, hasSheet, hasSender,
    senderEmail: process.env.SENDER_EMAIL || null,
    sheetUrl,
  });
});

// ---------- journalist CRUD (Google Sheet backed) ----------

app.get('/api/journalists', async (req, res) => {
  try {
    const all = await readJournalists();
    const { city, beat } = req.query;
    let filtered = all;
    if (city) {
      const c = String(city).toLowerCase();
      filtered = filtered.filter((j) => (j.city || '').toLowerCase().includes(c));
    }
    if (beat) {
      const b = String(beat).toLowerCase();
      filtered = filtered.filter((j) => (j.beats || []).some((x) => x.toLowerCase().includes(b)));
    }
    res.json({ journalists: filtered });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/journalists', async (req, res) => {
  try {
    const { name, email, outlet, beats, city, notes, tags, relationship } = req.body || {};
    if (!name || !email) return res.status(400).json({ error: 'name and email required' });
    const existing = await readJournalists();
    if (existing.some((j) => (j.email || '').toLowerCase() === String(email).toLowerCase())) {
      return res.status(409).json({ error: 'a journalist with that email already exists' });
    }
    await appendJournalist({
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
      outlet: outlet ? String(outlet).trim() : '',
      beats: Array.isArray(beats) ? beats : (beats ? String(beats).split(',').map((s) => s.trim()).filter(Boolean) : []),
      city: city ? String(city).trim() : '',
      relationship: relationship || 'cold',
      notes: notes ? String(notes).trim() : '',
      tags: Array.isArray(tags) ? tags : (tags ? String(tags).split(',').map((s) => s.trim()).filter(Boolean) : []),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/journalists/:email', async (req, res) => {
  try {
    const email = String(req.params.email).toLowerCase();
    const all = await readJournalists();
    const target = all.find((j) => (j.email || '').toLowerCase() === email);
    if (!target) return res.status(404).json({ error: 'not found' });
    await deleteJournalistRow(target._rowNumber);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- send email via Gmail ----------

app.post('/api/send-email', async (req, res) => {
  try {
    const { to, subject, body, journalist_name, event_name } = req.body || {};
    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'to, subject, body required' });
    }
    let result = null;
    let status = 'sent';
    let error = '';
    try {
      result = await sendGmail({ to, subject, body });
    } catch (err) {
      status = 'failed';
      error = err.message;
    }
    try {
      await appendSendLog({
        journalist_email: to,
        journalist_name: journalist_name || '',
        event_name: event_name || '',
        subject,
        gmail_message_id: result?.id || '',
        status,
        error,
      });
    } catch (logErr) {
      console.error('send_log append failed:', logErr.message);
    }
    if (status === 'failed') return res.status(502).json({ error });
    res.json({ ok: true, messageId: result.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


// ---------- contacts ----------

async function readContacts() {
  try {
    const raw = await fs.readFile(CONTACTS_PATH, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data.contacts) ? data.contacts : [];
  } catch {
    return [];
  }
}

async function writeContacts(contacts) {
  await fs.writeFile(CONTACTS_PATH, JSON.stringify({ contacts }, null, 2));
}

app.get('/api/contacts', async (_req, res) => {
  const contacts = await readContacts();
  res.json({ contacts });
});

app.post('/api/contacts', async (req, res) => {
  const { name, phone, tags } = req.body || {};
  if (!name || !phone) return res.status(400).json({ error: 'name and phone required' });
  const contacts = await readContacts();
  const contact = {
    id: randomUUID(),
    name: String(name).trim(),
    phone: normalizePhone(phone),
    tags: Array.isArray(tags) ? tags.filter(Boolean) : (tags ? [String(tags).trim()] : []),
  };
  contacts.push(contact);
  await writeContacts(contacts);
  res.json({ contact });
});

app.delete('/api/contacts/:id', async (req, res) => {
  const contacts = await readContacts();
  const next = contacts.filter((c) => c.id !== req.params.id);
  await writeContacts(next);
  res.json({ ok: true });
});

app.post('/api/contacts/import-vcf', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  const parsed = parseVCF(req.file.buffer.toString('utf8'));
  const defaultTag = (req.body?.tag || '').toString().trim();
  const existing = await readContacts();
  const existingPhones = new Set(existing.map((c) => c.phone));
  const added = [];
  for (const p of parsed) {
    if (!p.phone || existingPhones.has(p.phone)) continue;
    const contact = {
      id: randomUUID(),
      name: p.name || 'Unknown',
      phone: p.phone,
      tags: defaultTag ? [defaultTag] : [],
    };
    existing.push(contact);
    added.push(contact);
    existingPhones.add(p.phone);
  }
  await writeContacts(existing);
  res.json({ added: added.length, contacts: added });
});

function normalizePhone(raw) {
  const s = String(raw).replace(/[^\d+]/g, '');
  if (s.startsWith('+')) return s;
  if (s.length === 10) return '+1' + s;
  if (s.length === 11 && s.startsWith('1')) return '+' + s;
  return s;
}

function parseVCF(text) {
  const cards = text.split(/END:VCARD/i).map((c) => c.trim()).filter(Boolean);
  const contacts = [];
  for (const card of cards) {
    let name = '';
    let phone = '';
    for (const rawLine of card.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (/^FN[:;]/i.test(line)) {
        name = line.split(':').slice(1).join(':').trim();
      } else if (/^N[:;]/i.test(line) && !name) {
        const parts = line.split(':').slice(1).join(':').split(';');
        name = [parts[1], parts[0]].filter(Boolean).join(' ').trim();
      } else if (/^TEL/i.test(line) && !phone) {
        phone = normalizePhone(line.split(':').slice(1).join(':'));
      }
    }
    if (name || phone) contacts.push({ name, phone });
  }
  return contacts;
}

// ---------- event auto-fetch (web search) ----------

app.post('/api/fetch-event', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'url required' });

    const prompt = `Use web search to look up this event page and extract its details: ${url}

Return ONLY a single JSON object with these keys (no markdown, no commentary):
{
  "name": "",
  "date": "YYYY-MM-DD",
  "time_start": "HH:MM",
  "time_end": "HH:MM or empty string if no end time",
  "venue_name": "",
  "address": "",
  "blurb": "organizer's own words describing the event, preserved verbatim where possible"
}

If a field is unknown leave it as an empty string. Use 24-hour time. Preserve the organizer's voice exactly in the blurb.`;

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
      messages: [{ role: 'user', content: prompt }],
    });

    const text = extractText(response);
    const json = extractJSON(text);
    if (!json) return res.status(502).json({ error: 'could not parse event', raw: text });
    res.json({ event: json });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

function extractText(response) {
  if (!response?.content) return '';
  return response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function extractJSON(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

// ---------- draft generation ----------

const CHANNEL_SPECS = {
  journalist_email: {
    label: 'Journalist email',
    guidance: `A short, direct pitch email to a local culture journalist. Subject line on first line prefixed with "Subject: ". Keep it 120–180 words. Lead with the hook, then a sentence of context, then the practical details (day, date, time, venue, address). Close with a warm sign-off and offer to share imagery or set up an interview. No hype words, no emoji.`,
  },
  subscriber_email: {
    label: 'Shopify subscriber email',
    guidance: `An email to the brand's Shopify subscriber list. Subject line on first line prefixed with "Subject: ". 90–140 words. Friendly, inviting, first-person-plural. Preserve the blurb verbatim as one paragraph, surround it with a warm opening and a clear CTA line listing day, date, time, venue, address. End with a PS that feels human.`,
  },
  reddit_nyc: {
    label: 'Reddit — r/nyc + r/queens',
    guidance: `Two short Reddit posts, one for r/nyc and one for r/queens. Format as:\n\nr/nyc\nTitle: ...\nBody: ...\n\nr/queens\nTitle: ...\nBody: ...\n\nNo self-promo tone. Conversational, low-key, "hey, this is happening, come hang" energy. 60–110 words per body. Always list day, date, time, venue, address. No emoji.`,
  },
  whatsapp_broadcast: {
    label: 'WhatsApp broadcast draft',
    guidance: `A single WhatsApp broadcast message. Warm, short (50–80 words), 1–2 line breaks max. Lead with the event name, then the blurb in the organizer's words (lightly trimmed only if needed), then day, date, time, venue, address on separate lines. End with one line inviting forwarding.`,
  },
  substack_post: {
    label: 'Substack post draft',
    guidance: `A Substack post. Title on first line prefixed with "Title: ". 200–320 words, 2–4 short paragraphs. Opens with scene/voice, keeps the organizer's blurb intact as its own paragraph, and lands with practical details: day, date, time, venue, address, and how to RSVP/attend. Warm, essayistic, personal.`,
  },
  eventbrite_listing: {
    label: 'Eventbrite listing',
    guidance: `A full Eventbrite listing. Format:\n\nTitle: ...\nSummary (under 140 chars): ...\nDescription: 2–3 short paragraphs, preserving the organizer's blurb verbatim as one paragraph.\nDetails:\n- Day & date\n- Time\n- Venue\n- Address\n\nNo price, no ticket tiers — those are set in Eventbrite.`,
  },
  partiful_copy: {
    label: 'Partiful invite copy',
    guidance: `Partiful invite copy. Format:\n\nEvent name: ...\nTagline (one line, under 80 chars): ...\nDescription: 40–90 words, playful, preserves the organizer's voice. Include day, date, time, venue, address on their own lines at the end.`,
  },
};

app.post('/api/generate-drafts', async (req, res) => {
  try {
    const { event, channels, eventType } = req.body || {};
    if (!event) return res.status(400).json({ error: 'event required' });
    const selected = (channels || []).filter((c) => CHANNEL_SPECS[c]);
    if (!selected.length) return res.json({ drafts: {} });

    const dayOfWeek = computeDayOfWeek(event.date);
    const timeStr = event.time_end
      ? `${event.time_start}–${event.time_end}`
      : `${event.time_start} (open end)`;

    const context = `EVENT BRIEF
Name: ${event.name}
Day: ${dayOfWeek}
Date: ${event.date}
Time: ${timeStr}
Venue: ${event.venue_name}
Address: ${event.address}
Event type: ${eventType || 'my_event'}

Organizer's blurb (DO NOT REWRITE — use exact words, only adjust length/framing):
"""
${event.blurb || ''}
"""

GLOBAL RULES
- Never rewrite the organizer's voice. Adapt length and framing only. Use their exact words.
- Always include day, date, time, venue name, and address somewhere in the draft.
- Plain text only. No markdown headers unless specified. No emoji unless the blurb already uses them.
- Do not invent facts (prices, performers, RSVP links) that aren't in the brief.`;

    const results = await Promise.all(
      selected.map(async (channelKey) => {
        const spec = CHANNEL_SPECS[channelKey];
        const prompt = `${context}\n\nCHANNEL: ${spec.label}\n${spec.guidance}\n\nReturn only the draft text, nothing else.`;
        try {
          const resp = await anthropic.messages.create({
            model: FAST_MODEL,
            max_tokens: 1200,
            messages: [{ role: 'user', content: prompt }],
          });
          return [channelKey, extractText(resp).trim()];
        } catch (err) {
          return [channelKey, `[error generating draft: ${err.message}]`];
        }
      })
    );

    const drafts = Object.fromEntries(results);
    res.json({ drafts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

function computeDayOfWeek(date) {
  if (!date) return '';
  const d = new Date(date + 'T12:00:00');
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

// ---------- iMessage send (local only, AppleScript) ----------

const imessageJobs = new Map();

app.post('/api/imessage/send', async (req, res) => {
  if (process.platform !== 'darwin') {
    return res.status(400).json({ error: 'iMessage sending only works on macOS (darwin). Run this app locally on a Mac.' });
  }
  const { template, recipients } = req.body || {};
  if (!template || !Array.isArray(recipients) || !recipients.length) {
    return res.status(400).json({ error: 'template and recipients required' });
  }
  const job = {
    id: randomUUID(),
    items: recipients.map((r) => ({
      id: randomUUID(),
      name: r.name,
      phone: r.phone,
      status: 'queued',
      error: null,
    })),
    createdAt: Date.now(),
  };
  imessageJobs.set(job.id, job);
  runImessageJob(job, template).catch((err) => console.error('imessage job error', err));
  res.json({ jobId: job.id, items: job.items });
});

app.get('/api/imessage/status/:id', (req, res) => {
  const job = imessageJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  res.json({ jobId: job.id, items: job.items });
});

async function runImessageJob(job, template) {
  for (const item of job.items) {
    item.status = 'sending';
    const firstName = (item.name || '').trim().split(/\s+/)[0] || 'there';
    const body = template.replace(/\[first name\]/gi, firstName);
    try {
      await sendIMessage(item.phone, body);
      item.status = 'sent';
    } catch (err) {
      item.status = 'error';
      item.error = err.message;
    }
    // 45–90s random delay between sends, except after the last
    if (item !== job.items[job.items.length - 1]) {
      const delay = 45000 + Math.floor(Math.random() * 45000);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

function sendIMessage(phone, body) {
  return new Promise((resolve, reject) => {
    const script = `
on run argv
  set phoneNumber to item 1 of argv
  set messageBody to item 2 of argv
  tell application "Messages"
    set targetService to 1st service whose service type = iMessage
    set targetBuddy to buddy phoneNumber of targetService
    send messageBody to targetBuddy
  end tell
end run`;
    execFile('osascript', ['-e', script, phone, body], { timeout: 15000 }, (err, _stdout, stderr) => {
      if (err) return reject(new Error(stderr?.toString().trim() || err.message));
      resolve();
    });
  });
}

// ---------- start ----------

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    platform: process.platform,
    hasKey: Boolean(process.env.ANTHROPIC_API_KEY),
  });
});

// When running on Vercel, export the app and let Vercel handle the server.
// Locally (and anywhere else), start a listener.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Amplify running at http://localhost:${PORT}`);
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn('⚠  ANTHROPIC_API_KEY not set. Copy .env.example to .env and add your key.');
    }
  });
}

export default app;
