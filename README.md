# Amplify

An event awareness agent for NYC & Houston pop-ups. Drafts emails, Reddit posts, WhatsApp, Substack, Eventbrite, Partiful, and iMessage broadcasts — in the organizer's own words. Sends journalist pitches from your Gmail, with the database of local reporters living in your own Google Sheet.

## Stack

- Node.js + Express backend
- Vanilla single-page frontend (`public/`)
- Anthropic API with web search for auto-fetching partner events (Partiful, Luma, Eventbrite)
- Gmail API for sending journalist pitches from your own address
- Google Sheets as the journalist database (lives on your Drive)
- AppleScript bridge to Mac Messages for iMessage sends (local only)

## Run locally

```bash
npm install
cp .env.example .env
# fill in the env values — see "Setup" below
npm start
```

Open http://localhost:3000.

## Setup

### 1. Anthropic API key
Get one at https://console.anthropic.com/settings/keys. Set `ANTHROPIC_API_KEY`.

### 2. Google Cloud + Gmail OAuth

1. Go to https://console.cloud.google.com/ (signed in with the Google account whose Gmail you want to send from)
2. Create a new project named `amplify`
3. Enable APIs: **Gmail API** and **Google Sheets API** (APIs & Services → Library)
4. Configure OAuth consent screen (External for personal Gmail, Internal for Workspace). Add yourself as a test user. Add these scopes:
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/spreadsheets`
5. Create OAuth 2.0 Client ID (type: Web application) with authorized redirect URIs:
   - `http://localhost:3000/auth/google/callback`
   - `https://your-vercel-url/auth/google/callback` (if deploying)
6. Copy Client ID and Client Secret into `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
7. Set `SENDER_EMAIL` to the Gmail address you'll send from

### 3. Google Sheet (journalist DB)

1. Create a new Google Sheet on your Drive named **Amplify Data**
2. Create two tabs named exactly `journalists` and `send_log`
3. Paste these headers in row 1 of `journalists`:
   ```
   name	email	outlet	beats	city	relationship	last_contacted	notes	tags	created_at
   ```
4. Paste these headers in row 1 of `send_log`:
   ```
   sent_at	journalist_email	journalist_name	event_name	subject	gmail_message_id	status	error
   ```
5. Copy the Sheet ID from the URL (`docs.google.com/spreadsheets/d/<SHEET_ID>/edit`) into `.env` as `GOOGLE_SHEET_ID`

### 4. First-time Gmail authorization (one time)

```bash
npm start
```

Open http://localhost:3000/auth/google → authorize the app → you'll be redirected back and shown your **refresh token**. Copy it and paste into `.env` as `GOOGLE_REFRESH_TOKEN`. Restart the server.

From then on, the server uses that refresh token automatically. If you ever need a new one, visit `/auth/google` again.

### 5. Deploy to Vercel (optional)

- Import `AditiLuthra/Amplify2` into Vercel
- Add all env vars from `.env` into Vercel → Settings → Environment Variables (all 7: `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` pointing at your Vercel domain, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_SHEET_ID`, `SENDER_EMAIL`)
- Deploy

## Flow

1. **Brief** — event name, date, time, venue, address, blurb. Toggle my event / partner / collab. For partner/collab, paste a URL and hit Fetch — Anthropic's `web_search` tool extracts and auto-fills the fields.
2. **Channels** — pick where to publish: journalist email, Shopify subscriber email, Reddit (r/nyc + r/queens), WhatsApp, Substack, Eventbrite, Partiful, iMessage. For iMessage, filter contacts by group tag.
3. **Drafts & send** — each channel gets a draft you can edit and copy.
   - **Journalist email**: pick recipients from your Sheet (filter by city + beat), then send via Gmail. Each send is logged to the `send_log` tab.
   - **iMessage**: sends via AppleScript with 45–90s random delays and a live progress panel. Mac-only.
   - Other channels: copy to clipboard, paste into the relevant platform.

## Journalists DB

- Managed from the **Journalists** tab in the app (add, filter, delete)
- Stored in your `Amplify Data` Google Sheet — `journalists` tab
- For bulk edits, open the Sheet directly in Drive. Changes reflect in Amplify on next reload.
- Fields: `name`, `email`, `outlet`, `beats` (comma-sep), `city`, `relationship` (cold/warm/replied/declined), `last_contacted`, `notes`, `tags` (comma-sep), `created_at`

## Contacts (iMessage only)

- `contacts.json` at repo root stores iMessage contacts with `name`, `phone`, `tags[]`
- Add manually in the Contacts tab, or drag a `.vcf` file onto the drop zone
- Group tags (e.g. `local friends`, `press`, `influencers`) drive iMessage recipient filtering
- Separate from the journalist DB because iMessage uses phone numbers, not emails

## iMessage / AppleScript

Only works on macOS with the Messages app configured. The server refuses the send endpoint on other platforms. This cannot be hosted on Vercel — run it on your Mac for iMessage. The rest of the app (fetch, draft generation, Gmail send, Journalist DB) works anywhere Node runs.

## Writing rules

- Never rewrite the organizer's voice.
- Adapt length and framing only; use their exact words.
- Always include day, date, time, venue, address in every draft.
- iMessage uses a fixed, non-AI template:
  > Hi [first name]! Wanted to send along my next event! No pressure as always to come. Would love if you could share w any friends that may be interested :) [event link or venue + date if no link]

## Files

```
server.js            Express API (drafts, Gmail send, Sheets DB, AppleScript bridge)
public/index.html    SPA shell
public/styles.css    Warm minimal type-driven design
public/app.js        Client logic
contacts.json        Local iMessage contact store (phones)
.env                 Secrets — see .env.example
```
