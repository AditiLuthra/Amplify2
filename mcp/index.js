#!/usr/bin/env node
// Amplify MCP server — exposes event-publishing tools to Claude Desktop / Claude.ai.
// Runs locally via Claude Desktop's stdio transport. Calls the Vercel API for
// Gmail / Sheet / Eventbrite. Calls local osascript for iMessage (Mac only).
// Generates Instagram SVGs purely client-side.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const API_BASE = process.env.AMPLIFY_API_BASE || 'https://amplify2-love.vercel.app';
const API_KEY = process.env.AMPLIFY_API_KEY || '';
const DOWNLOADS = path.join(os.homedir(), 'Downloads');

async function api(pathname, { method = 'GET', body } = {}) {
  const r = await fetch(API_BASE + pathname, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY && { 'x-api-key': API_KEY }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!r.ok) {
    const msg = data?.error || data?.raw || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return data;
}

function textResult(obj) {
  return { content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] };
}

// ---------- Instagram SVG (pure client, no API needed) ----------

function generateInstagramSVG(event, type) {
  const W = 1080;
  const H = type === 'story' ? 1920 : 1350;
  const month = event.date ? parseInt(event.date.split('-')[1], 10) : (new Date().getMonth() + 1);
  const pal = getSeasonalPalette(month);
  const d = event.date ? new Date(event.date + 'T12:00:00') : null;
  const dayFull = d && !isNaN(d) ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : '';
  const timeStr = event.time_end ? `${fmt12(event.time_start)} – ${fmt12(event.time_end)}` : fmt12(event.time_start);
  const nameParts = wrapSvgText(event.name || 'Event', 20);
  const nameFS = 80;
  const nameLH = 96;
  const nameY = type === 'story' ? 420 : 300;
  const detailsY = nameY + nameParts.length * nameLH + 64;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${pal.bg}"/>
  <rect x="0" y="0" width="${W}" height="10" fill="${pal.accent}"/>
  <text x="80" y="108" font-family="Georgia, serif" font-size="30" fill="${pal.text}" opacity="0.42" letter-spacing="8">PITARA CO.</text>
  <line x1="80" y1="140" x2="360" y2="140" stroke="${pal.accent}" stroke-width="2.5"/>
  ${nameParts.map((line, i) => `<text x="80" y="${nameY + i * nameLH}" font-family="system-ui, -apple-system, sans-serif" font-size="${nameFS}" font-weight="700" fill="${pal.text}">${escSvg(line)}</text>`).join('\n  ')}
  <text x="80" y="${detailsY}" font-family="Georgia, serif" font-size="38" fill="${pal.text}" opacity="0.82">${escSvg(dayFull)}</text>
  <text x="80" y="${detailsY + 58}" font-family="Georgia, serif" font-size="33" fill="${pal.text}" opacity="0.62">${escSvg(timeStr)}</text>
  <text x="80" y="${detailsY + 140}" font-family="system-ui, sans-serif" font-size="34" font-weight="600" fill="${pal.accent}">${escSvg(event.venue_name || '')}</text>
  <text x="80" y="${detailsY + 190}" font-family="system-ui, sans-serif" font-size="27" fill="${pal.text}" opacity="0.52">${escSvg(event.address || '')}</text>
  <rect x="0" y="${H - 96}" width="${W}" height="96" fill="${pal.accent}" opacity="0.1"/>
  <text x="${W - 80}" y="${H - 30}" font-family="Georgia, serif" font-size="26" fill="${pal.text}" opacity="0.42" text-anchor="end">@pitaraco</text>
</svg>`;
}

function getSeasonalPalette(month) {
  if (month >= 3 && month <= 5) return { bg: '#f0ede4', accent: '#7a9b6e', text: '#2b2a24' };
  if (month >= 6 && month <= 8) return { bg: '#f5ede0', accent: '#c46b2d', text: '#2b2a24' };
  if (month >= 9 && month <= 10) return { bg: '#f0e8d8', accent: '#b55a2a', text: '#2b2a24' };
  return { bg: '#e8e4ec', accent: '#5a4a7a', text: '#2b2a24' };
}
function wrapSvgText(text, maxChars) {
  const words = (text || '').split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (next.length > maxChars && cur) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}
function escSvg(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmt12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// ---------- iMessage (Mac only) ----------

function sendIMessageViaAppleScript(phone, body) {
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

// ---------- Server setup ----------

const server = new Server(
  { name: 'amplify-events', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

const TOOLS = [
  {
    name: 'search_journalists',
    description: 'Search the journalist database (Google Sheet). Filter by city, beat, or a free-text query across name/email/outlet. Returns a list of journalists with their email, outlet, city, beats, relationship (cold/warm/replied), and notes.',
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'Filter by city (substring match). E.g., "NYC" or "Houston".' },
        beat: { type: 'string', description: 'Filter by beat (substring match). E.g., "food", "culture".' },
        query: { type: 'string', description: 'Free-text search across name, email, outlet.' },
      },
    },
  },
  {
    name: 'add_journalist',
    description: 'Add a new journalist to the database.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
        outlet: { type: 'string' },
        city: { type: 'string' },
        beats: { type: 'array', items: { type: 'string' } },
        tags: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
        relationship: { type: 'string', enum: ['cold', 'warm', 'replied', 'declined'] },
      },
      required: ['name', 'email'],
    },
  },
  {
    name: 'remove_journalist',
    description: 'Remove a journalist by email address.',
    inputSchema: {
      type: 'object',
      properties: { email: { type: 'string' } },
      required: ['email'],
    },
  },
  {
    name: 'send_pitch_email',
    description: 'Send an email via Gmail to one or more journalists. If the body contains {{first_name}}, it will be replaced per recipient with each journalist\'s first name. The email signature is auto-appended by the server. Logs to the send_log Google Sheet tab.',
    inputSchema: {
      type: 'object',
      properties: {
        recipients: {
          type: 'array',
          description: 'List of {email, name} objects. Each gets a personalized send.',
          items: {
            type: 'object',
            properties: { email: { type: 'string' }, name: { type: 'string' } },
            required: ['email', 'name'],
          },
        },
        subject: { type: 'string' },
        body: { type: 'string', description: 'Plain-text email body. Can include {{first_name}} placeholder.' },
        event_name: { type: 'string', description: 'Event name for the send_log.' },
      },
      required: ['recipients', 'subject', 'body'],
    },
  },
  {
    name: 'get_send_log',
    description: 'Retrieve the send log (all pitches sent, newest-first). Useful for checking whether a journalist has been pitched recently.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'fetch_event_from_url',
    description: 'Given a public event URL (Eventbrite, Partiful, Luma, etc.), uses web search to extract the event name, date, time, venue, address, and blurb. Returns structured data. Note: Partiful pages that require login cannot be parsed this way.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
  },
  {
    name: 'publish_to_eventbrite',
    description: 'Create an unlisted Eventbrite event draft. Creates a venue using the event\'s venue_name + address. Returns a URL you (Aditi) can visit to review and publish.',
    inputSchema: {
      type: 'object',
      properties: {
        event: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            date: { type: 'string', description: 'YYYY-MM-DD' },
            time_start: { type: 'string', description: 'HH:MM 24-hour' },
            time_end: { type: 'string', description: 'HH:MM 24-hour; empty defaults to start + 2hr' },
            venue_name: { type: 'string' },
            address: { type: 'string' },
            blurb: { type: 'string' },
          },
          required: ['name', 'date', 'time_start'],
        },
        listing_draft: { type: 'string', description: 'Full listing text. Should include "Title:", "Summary:", and a description section.' },
      },
      required: ['event', 'listing_draft'],
    },
  },
  {
    name: 'list_contacts',
    description: 'List iMessage contacts (local contacts.json). Used to see who will receive iMessage broadcasts.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'send_imessage_broadcast',
    description: 'Send an iMessage to every contact in the local contacts.json. Uses macOS osascript (Mac only). Each [first name] placeholder in the template is replaced with the contact\'s first name. A 45–90 second random delay between sends to avoid spam flags.',
    inputSchema: {
      type: 'object',
      properties: {
        template: { type: 'string', description: 'Message template. Use [first name] as placeholder.' },
      },
      required: ['template'],
    },
  },
  {
    name: 'generate_instagram_graphic',
    description: 'Generate a branded Instagram post (1080×1350) or story (1080×1920) graphic for an event as SVG. Seasonal color palette. Saves to ~/Downloads and returns the file path.',
    inputSchema: {
      type: 'object',
      properties: {
        event: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            date: { type: 'string' },
            time_start: { type: 'string' },
            time_end: { type: 'string' },
            venue_name: { type: 'string' },
            address: { type: 'string' },
          },
          required: ['name'],
        },
        type: { type: 'string', enum: ['post', 'story'] },
      },
      required: ['event', 'type'],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    switch (name) {
      case 'search_journalists': {
        const data = await api('/api/journalists');
        let list = data.journalists || [];
        if (args.city) list = list.filter((j) => (j.city || '').toLowerCase().includes(args.city.toLowerCase()));
        if (args.beat) list = list.filter((j) => (j.beats || []).some((b) => b.toLowerCase().includes(args.beat.toLowerCase())));
        if (args.query) {
          const q = args.query.toLowerCase();
          list = list.filter((j) =>
            (j.name || '').toLowerCase().includes(q) ||
            (j.email || '').toLowerCase().includes(q) ||
            (j.outlet || '').toLowerCase().includes(q)
          );
        }
        return textResult({ count: list.length, journalists: list });
      }

      case 'add_journalist': {
        const data = await api('/api/journalists', { method: 'POST', body: args });
        return textResult(data);
      }

      case 'remove_journalist': {
        const data = await api('/api/journalists/' + encodeURIComponent(args.email), { method: 'DELETE' });
        return textResult(data);
      }

      case 'send_pitch_email': {
        const { recipients, subject, body, event_name } = args;
        const results = [];
        for (const r of recipients) {
          const firstName = (r.name || '').trim().split(/\s+/)[0] || 'there';
          const personalized = (body || '').replace(/\{\{first_name\}\}/gi, firstName);
          try {
            const res = await api('/api/send-email', {
              method: 'POST',
              body: {
                to: r.email,
                subject,
                body: personalized,
                journalist_name: r.name,
                event_name: event_name || '',
              },
            });
            results.push({ email: r.email, ok: true, messageId: res.messageId });
          } catch (err) {
            results.push({ email: r.email, ok: false, error: err.message });
          }
          if (recipients.length > 1) await new Promise((res) => setTimeout(res, 800));
        }
        return textResult({ sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
      }

      case 'get_send_log': {
        const data = await api('/api/send-log');
        return textResult(data);
      }

      case 'fetch_event_from_url': {
        const data = await api('/api/fetch-event', { method: 'POST', body: { url: args.url } });
        return textResult(data);
      }

      case 'publish_to_eventbrite': {
        const data = await api('/api/eventbrite/publish', {
          method: 'POST',
          body: { event: args.event, draft: args.listing_draft },
        });
        return textResult(data);
      }

      case 'list_contacts': {
        const data = await api('/api/contacts');
        return textResult({ count: (data.contacts || []).length, contacts: data.contacts || [] });
      }

      case 'send_imessage_broadcast': {
        if (process.platform !== 'darwin') {
          throw new Error('iMessage sending only works on macOS. This MCP server must run on your Mac.');
        }
        const contactsData = await api('/api/contacts');
        const contacts = contactsData.contacts || [];
        if (!contacts.length) return textResult({ sent: 0, note: 'No contacts found.' });
        const results = [];
        for (let i = 0; i < contacts.length; i++) {
          const c = contacts[i];
          const firstName = (c.name || '').trim().split(/\s+/)[0] || 'there';
          const message = (args.template || '').replace(/\[first name\]/gi, firstName);
          try {
            await sendIMessageViaAppleScript(c.phone, message);
            results.push({ name: c.name, phone: c.phone, ok: true });
          } catch (err) {
            results.push({ name: c.name, phone: c.phone, ok: false, error: err.message });
          }
          if (i < contacts.length - 1) {
            const delay = 45000 + Math.floor(Math.random() * 45000);
            await new Promise((res) => setTimeout(res, delay));
          }
        }
        return textResult({ sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
      }

      case 'generate_instagram_graphic': {
        const svg = generateInstagramSVG(args.event, args.type);
        const safeName = (args.event.name || 'event').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40);
        const filename = `pitara-${args.type}-${args.event.date || 'event'}-${safeName}.svg`;
        const filepath = path.join(DOWNLOADS, filename);
        await fs.writeFile(filepath, svg, 'utf8');
        return textResult({
          filepath,
          type: args.type,
          dimensions: args.type === 'story' ? '1080x1920' : '1080x1350',
          note: 'SVG saved to Downloads. Open it in Preview, then File → Export to PNG for Instagram upload. Geo-tag manually in the IG app.',
        });
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('amplify-mcp server running on stdio');
