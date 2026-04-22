# Amplify MCP — Claude Desktop setup

Exposes your Amplify Vercel API as tools Claude can call conversationally. You chat with Claude in the Desktop app; Claude calls your Gmail / Eventbrite / Google Sheet / iMessage tools via this MCP server.

## One-time setup (5–10 minutes)

### 1. Install Claude Desktop

Download from **https://claude.ai/download**. Sign in with the same Anthropic account you use at claude.ai.

### 2. Install MCP server dependencies

Open Terminal, navigate to your repo folder, and run:

```bash
cd /path/to/Amplify2/mcp
npm install
```

(If you don't have Node.js installed, get it from **https://nodejs.org** — pick the LTS version.)

Find the absolute path to `index.js`:

```bash
pwd  # prints something like /Users/aditi/Amplify2/mcp
```

Remember this path — you'll need it in the next step.

### 3. Configure Claude Desktop

Open (or create) the Claude Desktop config file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

You can open it in your editor with:

```bash
open -e ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

(If the file doesn't exist, create it.)

Paste this, replacing `/Users/aditi/Amplify2/mcp` with YOUR path from step 2:

```json
{
  "mcpServers": {
    "amplify": {
      "command": "node",
      "args": ["/Users/aditi/Amplify2/mcp/index.js"],
      "env": {
        "AMPLIFY_API_BASE": "https://amplify2-love.vercel.app"
      }
    }
  }
}
```

Save the file.

### 4. Restart Claude Desktop

Fully quit (Cmd+Q) and reopen. It'll pick up the new MCP server.

### 5. Verify it works

In a new Claude Desktop conversation, type:

> List my NYC journalists.

Claude should invoke the `search_journalists` tool, filter by city=NYC, and show you the list from your Google Sheet. If that works, everything is wired up.

## What you can say to Claude now

- **"Add Priya Krishna as a food journalist at NYT, email priya@nyt.com, based in NYC."**
- **"Show me the last 10 emails I sent."**
- **"Fetch this event: https://eventbrite.com/..."**
- **"Draft a pitch email for the Jackson Heights Coffee Night — here's the blurb: [...]. Send it to my 3 NYC food journalists with cold relationship status."**
- **"Generate an Instagram post graphic for the June 7 coffee night at The Front Room, 123 Kent Ave Brooklyn."**
- **"Publish the Jackson Heights Coffee Night as an Eventbrite draft."**
- **"Send tonight's iMessage broadcast to all my contacts: 'Hi [first name]! coffee night this saturday at The Front Room...'"**

Claude will:
1. Figure out which tools to call
2. Draft content in the prompt itself (no extra API cost — it's just the chat model)
3. Call the right Vercel endpoints / local actions
4. Report back with results

## Recommended Claude.ai Project setup

Create a Project in claude.ai (or via Desktop) called **"Pitara Events"** and paste this as the system prompt:

```
You're helping Aditi run event outreach for Pitara Co. — an ethically-sourced South Indian coffee brand doing pop-ups and events in NYC and Houston. You have access to amplify tools that let you:
- Search/add journalists in her Google Sheet database
- Send pitch emails via her Gmail (signature auto-appends)
- Publish Eventbrite drafts
- Generate Instagram post/story graphics
- Send iMessage broadcasts to her friend list
- Fetch public event URLs into structured data

Brand voice: warm, specific, never hype-y, preserves the organizer's exact words where possible.

Default tone for pitches: short (120–180 words), hook first, one sentence of context, then practical details (day, date, time, venue, address). Warm sign-off. No emoji, no buzzwords. Greet as "Hi {{first_name}}," — the app auto-replaces per recipient.

Default tone for subscriber emails: 90–140 words, first-person-plural ("come hang with us"), blurb verbatim as its own paragraph. Human PS at the end.

When she describes an event, ALWAYS confirm the key details back before sending anything (day, date, time, venue, address, who it's going to). Never send without explicit confirmation. After sending, summarize what happened (how many sent, failures if any) and suggest next steps.

For Eventbrite listings: plain text format, no markdown. Format as:
Title: ...
Summary: ... (under 140 chars)
Description:
(2-3 paragraphs, blurb verbatim as its own)

For Instagram: generate the graphic, then write a caption (150-220 chars + 6-10 hashtags) separately. Remind her to geo-tag manually in the IG app.

For iMessage: use her template — "Hi [first name]! Wanted to send along my next event!..." Never send without confirmation.

Always ask which journalists (by city/beat/relationship) before sending mass pitches. Default to filtering by "cold" relationship so she doesn't re-pitch the same person.
```

## Troubleshooting

**"Tool not found" or Claude doesn't see amplify tools:**
- Did you fully quit + relaunch Claude Desktop?
- Check config file is valid JSON (use https://jsonlint.com)
- Check the file path in `args` is absolute and correct

**Tools fail with "unauthorized" or network errors:**
- Vercel deployment must be live. Visit https://amplify2-love.vercel.app in a browser — it should load.
- Environment vars on Vercel must be set: `ANTHROPIC_API_KEY`, `GOOGLE_*`, `SENDER_EMAIL`, `EVENTBRITE_TOKEN`. Check Vercel → Settings → Environment Variables.

**iMessage tool fails:**
- Only works on macOS (the MCP server must be running on your Mac — which it is, via Claude Desktop).
- Messages app must be signed into iMessage.
- First run: macOS will prompt you to allow Claude Desktop to control Messages. Say yes.

**Add an API key for security (optional, recommended):**
1. On Vercel, add env var `AMPLIFY_API_KEY` = some long random string
2. Update server.js to check `req.headers['x-api-key']` against that env var on /api routes
3. In your claude_desktop_config.json, add `"AMPLIFY_API_KEY": "that-same-string"` under `env`
4. Without this, anyone who knows your amplify2-love.vercel.app URL can hit your Gmail. Currently open; fine for demo but add auth soon.
