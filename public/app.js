// Amplify — frontend SPA

const state = {
  step: 1,
  eventType: 'my_event',
  event: {
    name: '', date: '', time_start: '', time_end: '',
    venue_name: '', address: '', blurb: '',
    no_end: false,
    include_eventbrite: false,
    include_partiful: false,
  },
  channels: new Set(),
  contacts: [],
  selectedGroups: new Set(),
  drafts: {},
  jobId: null,
  pollTimer: null,
  journalists: [],
  selectedJournalistEmails: new Set(),
  gmailConnected: false,
  senderEmail: null,
};

const IMESSAGE_TEMPLATE = `Hi [first name]! Wanted to send along my next event! No pressure as always to come. Would love if you could share w any friends that may be interested :) [event link or venue + date if no link]`;

// ---------- tabs ----------
document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    t.classList.add('active');
    document.getElementById('view-' + t.dataset.view).classList.add('active');
    if (t.dataset.view === 'contacts') loadContacts();
    if (t.dataset.view === 'journalists') loadJournalists();
    if (t.dataset.view === 'sent') loadSendLog();
  });
});

// ---------- Gmail connection status ----------
async function checkGmailConnection() {
  try {
    const r = await fetch('/api/connection-status');
    const data = await r.json();
    state.gmailConnected = data.connected;
    state.senderEmail = data.senderEmail;
    renderGmailBanner(data);
  } catch (err) {
    console.error(err);
  }
}

function renderGmailBanner(status) {
  const banner = document.getElementById('gmail-banner');
  const text = banner.querySelector('.gmail-banner-text');
  const link = document.getElementById('gmail-connect-link');
  const sheetLink = document.getElementById('sheet-link');
  if (sheetLink && status.sheetUrl) sheetLink.href = status.sheetUrl;
  if (status.connected) {
    banner.classList.add('hidden');
    return;
  }
  banner.classList.remove('hidden');
  const missing = [];
  if (!status.hasClient) missing.push('Google OAuth credentials');
  if (!status.hasSheet) missing.push('Sheet ID');
  if (!status.hasSender) missing.push('sender email');
  if (!status.hasToken) missing.push('Gmail authorization');

  if (status.hasClient && status.hasSheet && status.hasSender && !status.hasToken) {
    text.innerHTML = '<strong>Connect your Gmail to start sending emails.</strong> One click.';
    link.style.display = '';
  } else {
    text.innerHTML = `<strong>Setup incomplete.</strong> Missing: ${missing.join(', ')}. Check your env vars.`;
    link.style.display = 'none';
  }
}
checkGmailConnection();

// ---------- event type toggle ----------
const eventTypeEl = document.getElementById('event-type');
eventTypeEl.querySelectorAll('.seg').forEach((b) => {
  b.addEventListener('click', () => {
    eventTypeEl.querySelectorAll('.seg').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    state.eventType = b.dataset.type;
    updateEventTypeUI();
  });
});

function updateEventTypeUI() {
  const isMine = state.eventType === 'my_event';
  document.body.classList.toggle('not-my', !isMine);
  document.getElementById('fetch-block').classList.toggle('hidden', isMine);
  document.getElementById('my-event-only').classList.toggle('hidden', !isMine);
  // clear channel selections that don't apply
  if (!isMine) {
    ['eventbrite_listing', 'partiful_copy'].forEach((k) => state.channels.delete(k));
    document
      .querySelectorAll('.channel-card.my-only input[type="checkbox"]')
      .forEach((i) => (i.checked = false));
  }
}
updateEventTypeUI();

// ---------- field bindings ----------
const bind = (id, key, type = 'value') => {
  const el = document.getElementById(id);
  el.addEventListener('input', () => {
    state.event[key] = type === 'checked' ? el.checked : el.value;
    if (key === 'date') updateDayOfWeek();
    if (key === 'no_end') {
      document.getElementById('ev-end').disabled = el.checked;
      if (el.checked) state.event.time_end = '';
    }
  });
};
bind('ev-name', 'name');
bind('ev-date', 'date');
bind('ev-start', 'time_start');
bind('ev-end', 'time_end');
bind('ev-no-end', 'no_end', 'checked');
bind('ev-venue', 'venue_name');
bind('ev-address', 'address');
bind('ev-blurb', 'blurb');
bind('inc-eventbrite', 'include_eventbrite', 'checked');
bind('inc-partiful', 'include_partiful', 'checked');

function updateDayOfWeek() {
  const dow = document.getElementById('ev-dow');
  if (!state.event.date) { dow.textContent = ''; return; }
  const d = new Date(state.event.date + 'T12:00:00');
  if (isNaN(d)) { dow.textContent = ''; return; }
  dow.textContent = '· ' + d.toLocaleDateString('en-US', { weekday: 'long' });
}

// ---------- fetch partner event ----------
document.getElementById('fetch-btn').addEventListener('click', async () => {
  const url = document.getElementById('fetch-url').value.trim();
  const btn = document.getElementById('fetch-btn');
  const status = document.getElementById('fetch-status');
  if (!url) { status.textContent = 'paste a URL first'; status.className = 'status error'; return; }
  btn.disabled = true;
  status.textContent = 'fetching via web search…';
  status.className = 'status';
  try {
    const r = await fetch('/api/fetch-event', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'fetch failed');
    applyEvent(data.event);
    status.textContent = 'filled from ' + new URL(url).hostname;
    status.className = 'status ok';
  } catch (err) {
    status.textContent = err.message;
    status.className = 'status error';
  } finally {
    btn.disabled = false;
  }
});

function applyEvent(ev) {
  const set = (id, v) => { const el = document.getElementById(id); if (v != null) { el.value = v; el.dispatchEvent(new Event('input')); } };
  set('ev-name', ev.name);
  set('ev-date', ev.date);
  set('ev-start', ev.time_start);
  set('ev-end', ev.time_end);
  set('ev-venue', ev.venue_name);
  set('ev-address', ev.address);
  set('ev-blurb', ev.blurb);
  if (!ev.time_end) {
    document.getElementById('ev-no-end').checked = true;
    document.getElementById('ev-no-end').dispatchEvent(new Event('input'));
  }
}

// ---------- step navigation ----------
document.querySelectorAll('[data-next]').forEach((b) =>
  b.addEventListener('click', () => goToStep(parseInt(b.dataset.next, 10)))
);
document.querySelectorAll('[data-back]').forEach((b) =>
  b.addEventListener('click', () => goToStep(parseInt(b.dataset.back, 10)))
);

function goToStep(n) {
  if (n === 2 && !validateBrief()) return;
  state.step = n;
  document.querySelectorAll('.step').forEach((s) => {
    const sn = parseInt(s.dataset.step, 10);
    s.classList.toggle('active', sn === n);
    s.classList.toggle('done', sn < n);
  });
  document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
  document.getElementById('step-' + n).classList.add('active');

  if (n === 2) preselectChannels();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function validateBrief() {
  const e = state.event;
  const missing = [];
  if (!e.name) missing.push('name');
  if (!e.date) missing.push('date');
  if (!e.time_start) missing.push('start time');
  if (!e.venue_name) missing.push('venue');
  if (!e.address) missing.push('address');
  if (!e.blurb) missing.push('blurb');
  if (missing.length) { toast('missing: ' + missing.join(', ')); return false; }
  return true;
}

function preselectChannels() {
  if (state.eventType === 'my_event') {
    if (state.event.include_eventbrite) toggleChannel('eventbrite_listing', true);
    if (state.event.include_partiful) toggleChannel('partiful_copy', true);
  }
}

function toggleChannel(key, on) {
  const card = document.querySelector(`.channel-card[data-channel="${key}"]`);
  if (!card) return;
  const input = card.querySelector('input');
  input.checked = on;
  if (on) state.channels.add(key); else state.channels.delete(key);
}

// ---------- channel selection ----------
document.querySelectorAll('.channel-card').forEach((card) => {
  const input = card.querySelector('input');
  card.addEventListener('click', (e) => {
    if (e.target !== input) input.checked = !input.checked;
    const key = card.dataset.channel;
    if (input.checked) state.channels.add(key); else state.channels.delete(key);
    if (key === 'imessage') {
      document.getElementById('imessage-contacts').classList.toggle('hidden', !input.checked);
      if (input.checked) loadContactsForImessage();
    }
  });
});

async function loadContactsForImessage() {
  await loadContacts();
  renderImessagePreview();
}

function renderImessagePreview() {
  const preview = document.getElementById('imessage-preview');
  const all = state.contacts;
  const example = IMESSAGE_TEMPLATE.replace('[first name]', all[0]?.name.split(' ')[0] || 'Jamie');
  preview.textContent = `Sending to all ${all.length} contact${all.length === 1 ? '' : 's'} · 45–90s delay between sends\n\nPreview:\n${example}`;
}

function getImessageRecipients() {
  return state.contacts;
}

// ---------- channel specs + draft system ----------

function computeDayOfWeek(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

const CHANNEL_SPECS = {
  journalist_email: {
    label: 'Journalist email',
    guidance: '120–180 words. Subject: line first. Hook → context → details (day, date, time, venue, address) → warm sign-off. Greet as "Hi {{first_name}}," — the app replaces it per recipient.',
    promptTemplate: `Write a short pitch email to a local culture journalist.

Event: {{name}}
Day/Date: {{day}}, {{date}}
Time: {{time}}
Venue: {{venue_name}}
Address: {{address}}
Organizer's blurb (use verbatim, don't rewrite): "{{blurb}}"

Requirements:
- First line: Subject: [compelling subject line]
- 120–180 words total
- Open with the hook — the most interesting thing about this event
- One sentence of context (who organizes it, what makes it special)
- Practical details: day, date, time, venue, address
- Warm sign-off; offer to share imagery or set up an interview
- Greeting: Hi {{first_name}}, (the app personalizes this per recipient)
- No hype words, no buzzwords, no emoji
- Plain text only, no markdown`,
  },
  subscriber_email: {
    label: 'Shopify subscriber email',
    guidance: '90–140 words. Subject: line first. Blurb verbatim as its own paragraph. First-person-plural. End with a human PS.',
    promptTemplate: `Write an email to a brand's Shopify subscriber list.

Event: {{name}}
Day/Date: {{day}}, {{date}}
Time: {{time}}
Venue: {{venue_name}}
Address: {{address}}
Blurb (preserve these exact words as a paragraph): "{{blurb}}"

Requirements:
- First line: Subject: [warm, personal subject line]
- 90–140 words
- Friendly, inviting, first-person-plural ("join us", "come hang with us")
- Include the blurb verbatim as its own paragraph
- Clear CTA line listing day, date, time, venue, address
- End with a PS that feels human and personal
- Plain text only`,
  },
  reddit_nyc: {
    label: 'Reddit — NYC subreddits',
    guidance: 'Suggest 2–4 subreddits where this fits (always r/nyc + relevant others). Write a tailored post per sub. 60–110 words each. Conversational, no self-promo energy.',
    promptTemplate: `I need to post about a NYC event on Reddit. Suggest 2–4 subreddits where this genuinely fits (always include r/nyc; also consider r/queens, r/FoodNYC, r/Coffee, r/brooklyn, r/nycmeetups, r/AskNYC depending on the event). For each, note whether small-business/event posts are allowed. Then write a post for each.

Event: {{name}}
Day/Date: {{day}}, {{date}}
Time: {{time}}
Venue: {{venue_name}}
Address: {{address}}
Blurb: "{{blurb}}"

For each subreddit, format as:
---
r/[name] — [why it fits + whether event posts are ok, one sentence]
Title: [post title]
Body: [60–110 words. Conversational, low-key "hey this is happening, come hang" energy. Day, date, time, venue, address included. No emoji, no self-promo tone]
---`,
  },
  whatsapp_broadcast: {
    label: 'WhatsApp broadcast',
    guidance: '50–80 words. Lead with event name + blurb (exact words). Details on separate lines. End inviting forwarding.',
    promptTemplate: `Write a WhatsApp broadcast message for this event.

Event: {{name}}
Day/Date: {{day}}, {{date}}
Time: {{time}}
Venue: {{venue_name}}
Address: {{address}}
Blurb (preserve exact words): "{{blurb}}"

Requirements:
- 50–80 words total
- Lead with the event name and blurb (trim only if needed for length)
- Day, date, time, venue, address on their own lines at the end
- End with one line inviting people to forward to friends
- Warm but short, plain text`,
  },
  substack_post: {
    label: 'Substack post',
    guidance: '200–320 words, 2–4 paragraphs. Title: line first. Scene-setting open → blurb verbatim → practical close.',
    promptTemplate: `Write a Substack post about this event.

Event: {{name}}
Day/Date: {{day}}, {{date}}
Time: {{time}}
Venue: {{venue_name}}
Address: {{address}}
Blurb (use verbatim as its own paragraph, do not edit): "{{blurb}}"

Requirements:
- First line: Title: [evocative title]
- 200–320 words, 2–4 short paragraphs
- Open with scene-setting or a voice that pulls the reader in
- Blurb verbatim as its own paragraph
- End with practical details: day, date, time, venue, address, how to attend
- Warm, essayistic, personal tone
- Plain text (no markdown headers, no bullet points)`,
  },
  eventbrite_listing: {
    label: 'Eventbrite listing',
    guidance: 'Title + Summary (<140 chars) + Description (blurb verbatim) + Details block. No price or ticket tiers.',
    promptTemplate: `Write an Eventbrite event listing.

Event: {{name}}
Day/Date: {{day}}, {{date}}
Time: {{time}}
Venue: {{venue_name}}
Address: {{address}}
Blurb (use verbatim as one paragraph): "{{blurb}}"

Format exactly as:
Title: [event title]
Summary (under 140 chars): [one-line summary]
Description:
[2–3 short paragraphs. Include the blurb verbatim as its own paragraph.]

Details:
- Day & date: {{day}}, {{date}}
- Time: {{time}}
- Venue: {{venue_name}}
- Address: {{address}}

Do not include price, ticket tiers, or ticket links — those are added in Eventbrite directly.`,
  },
  partiful_copy: {
    label: 'Partiful invite',
    guidance: 'Event name + Tagline (<80 chars) + Description (40–90 words, your voice, details at end).',
    promptTemplate: `Write Partiful event invite copy.

Event: {{name}}
Day/Date: {{day}}, {{date}}
Time: {{time}}
Venue: {{venue_name}}
Address: {{address}}
Blurb (preserve the organizer's voice): "{{blurb}}"

Format exactly as:
Event name: [name]
Tagline (one line, under 80 chars): [catchy tagline]
Description: [40–90 words, playful, organizer's voice preserved. End with day, date, time, venue, and address on their own lines]`,
  },
  instagram: {
    label: 'Instagram post + story',
    guidance: 'Caption (150–220 chars + hashtags) + Story text (<50 chars). Graphic auto-generates below — download and geo-tag manually in the Instagram app.',
    promptTemplate: `Write Instagram content for this event.

Event: {{name}}
Day/Date: {{day}}, {{date}}
Time: {{time}}
Venue: {{venue_name}}
Address: {{address}}
Blurb (preserve exact voice): "{{blurb}}"

Write two versions:

1. CAPTION (150–220 characters + hashtags):
- Hook first (most interesting thing)
- Practical details (day, date, time, venue)
- 6–10 hashtags: mix of specific (#PitaraCo #SouthIndianCoffee) and discoverable (#NYCfood #PopUpNYC #Brooklyn etc.)
- Organizer's voice, no generic phrases

2. STORY TEXT (under 50 characters):
- Very short teaser for the story graphic
- Should make someone tap to see more`,
  },
};

function buildDraftPrompt(key, event) {
  const spec = CHANNEL_SPECS[key];
  if (!spec?.promptTemplate) return '';
  const day = computeDayOfWeek(event.date);
  const time = event.time_end ? `${event.time_start}–${event.time_end}` : (event.time_start || '');
  return spec.promptTemplate
    .replace(/\{\{name\}\}/g, event.name || '')
    .replace(/\{\{day\}\}/g, day)
    .replace(/\{\{date\}\}/g, event.date || '')
    .replace(/\{\{time\}\}/g, time)
    .replace(/\{\{venue_name\}\}/g, event.venue_name || '')
    .replace(/\{\{address\}\}/g, event.address || '')
    .replace(/\{\{blurb\}\}/g, event.blurb || '');
}

// ---------- continue to drafts ----------
document.getElementById('generate-btn').addEventListener('click', () => {
  if (!state.channels.size) { toast('pick at least one channel'); return; }
  goToStep(3);
  renderDraftCards();
  setupGmailSendPanel();
  const imPanel = document.getElementById('imessage-panel');
  if (state.channels.has('imessage')) {
    imPanel.classList.remove('hidden');
    renderImessageJobPanel();
  } else {
    imPanel.classList.add('hidden');
  }
});

function renderDraftCards() {
  const container = document.getElementById('drafts');
  container.innerHTML = '';
  const channels = Array.from(state.channels).filter((c) => c !== 'imessage');
  channels.forEach((key) => {
    const spec = CHANNEL_SPECS[key];
    if (!spec) return;
    const card = document.createElement('div');
    card.className = 'draft-card';
    card.dataset.key = key;

    if (key === 'instagram') {
      card.innerHTML = `
        <div class="draft-head">
          <div class="draft-title">${escapeHtml(spec.label)}</div>
        </div>
        <div class="draft-template">${escapeHtml(spec.guidance)}</div>
        <div class="draft-prompt-row">
          <button class="mini-btn prompt-copy-btn">Copy caption prompt</button>
          <span class="hint" style="font-size:12px;margin-left:8px">paste into Claude or ChatGPT</span>
        </div>
        <div class="ig-preview-wrap" id="ig-preview-wrap"></div>
        <div class="draft-actions-row">
          <button class="mini-btn dl-post-btn">Download post (1080×1350)</button>
          <button class="mini-btn dl-story-btn">Download story (1080×1920)</button>
        </div>`;
      container.appendChild(card);

      card.querySelector('.prompt-copy-btn').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        await navigator.clipboard.writeText(buildDraftPrompt(key, state.event));
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy caption prompt', 1500);
      });

      const postSvg = generateInstagramSVG(state.event, 'post');
      const storySvg = generateInstagramSVG(state.event, 'story');
      const wrap = card.querySelector('#ig-preview-wrap');
      const postEl = document.createElement('div');
      postEl.style.cssText = 'flex-shrink:0';
      postEl.innerHTML = postSvg;
      postEl.querySelector('svg').setAttribute('width', '270');
      postEl.querySelector('svg').setAttribute('height', '338');
      const storyEl = document.createElement('div');
      storyEl.style.cssText = 'flex-shrink:0';
      storyEl.innerHTML = storySvg;
      storyEl.querySelector('svg').setAttribute('width', '152');
      storyEl.querySelector('svg').setAttribute('height', '270');
      wrap.appendChild(postEl);
      wrap.appendChild(storyEl);

      card.querySelector('.dl-post-btn').addEventListener('click', () => downloadSvg(postSvg, `pitara-post-${state.event.date || 'event'}.svg`));
      card.querySelector('.dl-story-btn').addEventListener('click', () => downloadSvg(storySvg, `pitara-story-${state.event.date || 'event'}.svg`));
      return;
    }

    card.innerHTML = `
      <div class="draft-head">
        <div class="draft-title">${escapeHtml(spec.label)}</div>
      </div>
      <div class="draft-template">${escapeHtml(spec.guidance)}</div>
      <div class="draft-prompt-row">
        <button class="mini-btn prompt-copy-btn">Copy prompt</button>
        <span class="hint" style="font-size:12px;margin-left:8px">paste into Claude or ChatGPT → paste result below</span>
      </div>
      <textarea class="draft-body" placeholder="paste your draft here…" rows="6"></textarea>
      <div class="draft-actions-row"></div>`;

    container.appendChild(card);

    const ta = card.querySelector('textarea.draft-body');
    ta.addEventListener('input', () => { state.drafts[key] = ta.value; autoSize(ta); });

    card.querySelector('.prompt-copy-btn').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      await navigator.clipboard.writeText(buildDraftPrompt(key, state.event));
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy prompt', 1500);
    });

    const actionsRow = card.querySelector('.draft-actions-row');

    const copyBtn = document.createElement('button');
    copyBtn.className = 'mini-btn copy-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(ta.value || '');
      copyBtn.classList.add('copied');
      copyBtn.textContent = 'Copied';
      setTimeout(() => { copyBtn.classList.remove('copied'); copyBtn.textContent = 'Copy'; }, 1500);
    });
    actionsRow.appendChild(copyBtn);

    if (key === 'partiful_copy') {
      const openBtn = makeOpenBtn('Open Partiful', 'https://partiful.com/e/create');
      actionsRow.appendChild(openBtn);
    }
    if (key === 'substack_post') {
      const openBtn = makeOpenBtn('Open Substack', 'https://substack.com/p/new');
      actionsRow.appendChild(openBtn);
    }
    if (key === 'subscriber_email') {
      const openBtn = makeOpenBtn('Open Shopify Email', 'https://admin.shopify.com/store/pitaraco/marketing');
      actionsRow.appendChild(openBtn);
    }
    if (key === 'eventbrite_listing') {
      const pubBtn = document.createElement('button');
      pubBtn.className = 'mini-btn pub-btn';
      pubBtn.textContent = 'Publish to Eventbrite';
      pubBtn.addEventListener('click', async () => {
        if (!ta.value.trim()) { toast('paste a draft first'); return; }
        pubBtn.disabled = true;
        pubBtn.textContent = 'Publishing…';
        try {
          const r = await fetch('/api/eventbrite/publish', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event: { ...state.event }, draft: ta.value }),
          });
          const data = await r.json();
          if (!r.ok) throw new Error(data.error || 'publish failed');
          const badge = document.createElement('span');
          badge.className = 'publish-badge';
          badge.innerHTML = `Draft created — <a href="${escapeHtml(data.url)}" target="_blank">view on Eventbrite ↗</a>`;
          actionsRow.appendChild(badge);
          pubBtn.textContent = 'Published ✓';
        } catch (err) {
          toast(err.message);
          pubBtn.disabled = false;
          pubBtn.textContent = 'Publish to Eventbrite';
        }
      });
      actionsRow.appendChild(pubBtn);
    }
  });
}

function makeOpenBtn(label, url) {
  const btn = document.createElement('button');
  btn.className = 'mini-btn open-btn';
  btn.textContent = label;
  btn.addEventListener('click', () => window.open(url, '_blank'));
  return btn;
}

// ---------- instagram svg ----------

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

function downloadSvg(svgStr, filename) {
  const blob = new Blob([svgStr], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function autoSize(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.max(140, ta.scrollHeight + 4) + 'px';
}

// ---------- iMessage send ----------
function renderImessageJobPanel() {
  const recipients = getImessageRecipients();
  const progress = document.getElementById('im-progress');
  if (!recipients.length) {
    progress.innerHTML = '<div class="hint">no recipients — pick a group in step 2.</div>';
    document.getElementById('im-send-btn').disabled = true;
    return;
  }
  document.getElementById('im-send-btn').disabled = false;
  progress.innerHTML = recipients.map((c) => `
    <div class="im-row" data-phone="${escapeHtml(c.phone)}">
      <div><strong>${escapeHtml(c.name)}</strong> <span class="phone">${escapeHtml(c.phone)}</span></div>
      <div></div>
      <div class="im-status queued">queued</div>
    </div>
  `).join('');
}

document.getElementById('im-send-btn').addEventListener('click', async () => {
  const recipients = getImessageRecipients();
  if (!recipients.length) return;
  if (!confirm(`Send iMessages to ${recipients.length} people? 45–90s delay between each.`)) return;

  const btn = document.getElementById('im-send-btn');
  btn.disabled = true;
  btn.textContent = 'Sending…';

  try {
    const r = await fetch('/api/imessage/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template: IMESSAGE_TEMPLATE, recipients }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'send failed');
    state.jobId = data.jobId;
    pollImessage();
  } catch (err) {
    toast(err.message);
    btn.disabled = false;
    btn.textContent = 'Send iMessages';
  }
});

function pollImessage() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    if (!state.jobId) return;
    try {
      const r = await fetch('/api/imessage/status/' + state.jobId);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      updateImessageProgress(data.items);
      const done = data.items.every((i) => i.status === 'sent' || i.status === 'error');
      if (done) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
        const btn = document.getElementById('im-send-btn');
        btn.disabled = false;
        btn.textContent = 'Send again';
        toast('iMessage batch complete');
      }
    } catch (err) {
      clearInterval(state.pollTimer);
      toast(err.message);
    }
  }, 1200);
}

function updateImessageProgress(items) {
  const progress = document.getElementById('im-progress');
  progress.innerHTML = items.map((it) => `
    <div class="im-row">
      <div><strong>${escapeHtml(it.name)}</strong> <span class="phone">${escapeHtml(it.phone)}</span></div>
      <div>${it.error ? `<span class="hint" title="${escapeHtml(it.error)}">error</span>` : ''}</div>
      <div class="im-status ${it.status}">${it.status}</div>
    </div>
  `).join('');
}

// ---------- restart ----------
document.getElementById('restart').addEventListener('click', () => {
  if (!confirm('Start over? This clears your drafts.')) return;
  location.reload();
});

// ---------- contacts tab ----------
async function loadContacts() {
  try {
    const r = await fetch('/api/contacts');
    const data = await r.json();
    state.contacts = data.contacts || [];
    renderContacts();
  } catch (err) { console.error(err); }
}

function renderContacts(filter = '') {
  const list = document.getElementById('contact-list');
  const q = filter.trim().toLowerCase();
  const shown = !q ? state.contacts : state.contacts.filter((c) =>
    c.name.toLowerCase().includes(q) ||
    c.phone.toLowerCase().includes(q) ||
    (c.tags || []).some((t) => t.toLowerCase().includes(q))
  );
  if (!shown.length) {
    list.innerHTML = '<li class="hint" style="grid-template-columns:1fr">no contacts yet.</li>';
    return;
  }
  list.innerHTML = shown.map((c) => `
    <li>
      <span class="contact-name">${escapeHtml(c.name)}</span>
      <span class="contact-phone">${escapeHtml(c.phone)}</span>
      <span class="tag-dots">${(c.tags || []).map((t) => `<span class="tag-dot">${escapeHtml(t)}</span>`).join('')}</span>
      <button class="del-btn" data-id="${c.id}">remove</button>
    </li>
  `).join('');
  list.querySelectorAll('.del-btn').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Remove contact?')) return;
      await fetch('/api/contacts/' + b.dataset.id, { method: 'DELETE' });
      loadContacts();
    })
  );
}

document.getElementById('contact-search').addEventListener('input', (e) => renderContacts(e.target.value));

document.getElementById('contact-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const tags = (f.get('tags') || '').toString().split(',').map((s) => s.trim()).filter(Boolean);
  try {
    const r = await fetch('/api/contacts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: f.get('name'), phone: f.get('phone'), tags }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    e.target.reset();
    toast('added ' + data.contact.name);
    loadContacts();
  } catch (err) { toast(err.message); }
});

// drag-drop vcf
const drop = document.getElementById('drop-zone');
['dragenter', 'dragover'].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); })
);
['dragleave', 'drop'].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); })
);
drop.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files?.[0];
  if (file) uploadVcf(file);
});
document.getElementById('vcf-pick').addEventListener('click', () => document.getElementById('vcf-input').click());
document.getElementById('vcf-input').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) uploadVcf(file);
});

async function uploadVcf(file) {
  const tag = document.getElementById('vcf-tag').value.trim();
  const fd = new FormData();
  fd.append('file', file);
  if (tag) fd.append('tag', tag);
  try {
    const r = await fetch('/api/contacts/import-vcf', { method: 'POST', body: fd });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    toast(`imported ${data.added} contact${data.added === 1 ? '' : 's'}`);
    loadContacts();
  } catch (err) { toast(err.message); }
}

// ---------- journalists tab ----------
async function loadJournalists() {
  try {
    const r = await fetch('/api/journalists');
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'failed to load journalists');
    state.journalists = data.journalists || [];
    renderJournalists();
  } catch (err) {
    const list = document.getElementById('journalist-list');
    list.innerHTML = `<li class="hint" style="grid-template-columns:1fr">couldn't load: ${escapeHtml(err.message)}. Make sure Gmail is connected and GOOGLE_SHEET_ID is set.</li>`;
  }
}

function renderJournalists() {
  const searchEl = document.getElementById('j-search');
  const cityFilter = document.getElementById('j-filter-city').value.trim().toLowerCase();
  const beatFilter = document.getElementById('j-filter-beat').value.trim().toLowerCase();
  const q = (searchEl?.value || '').trim().toLowerCase();
  const list = document.getElementById('journalist-list');
  const stats = document.getElementById('j-stats');

  let shown = state.journalists;
  if (cityFilter) shown = shown.filter((j) => (j.city || '').toLowerCase().includes(cityFilter));
  if (beatFilter) shown = shown.filter((j) => (j.beats || []).some((b) => b.toLowerCase().includes(beatFilter)));
  if (q) shown = shown.filter((j) =>
    (j.name || '').toLowerCase().includes(q) ||
    (j.email || '').toLowerCase().includes(q) ||
    (j.outlet || '').toLowerCase().includes(q)
  );

  stats.textContent = `${shown.length} of ${state.journalists.length} journalists`;

  if (!shown.length) {
    list.innerHTML = '<li class="hint" style="grid-template-columns:1fr">no journalists match these filters.</li>';
    return;
  }

  list.innerHTML = shown.map((j) => `
    <li class="j-row">
      <div class="j-main">
        <div class="j-name">${escapeHtml(j.name)}</div>
        <div class="j-email">${escapeHtml(j.email)}</div>
      </div>
      <div class="j-meta">
        ${j.outlet ? `<div class="j-outlet">${escapeHtml(j.outlet)}</div>` : ''}
        <div class="j-tags">
          ${j.city ? `<span class="tag-dot">${escapeHtml(j.city)}</span>` : ''}
          ${(j.beats || []).map((b) => `<span class="tag-dot beat">${escapeHtml(b)}</span>`).join('')}
          ${j.relationship ? `<span class="tag-dot rel-${escapeHtml(j.relationship)}">${escapeHtml(j.relationship)}</span>` : ''}
        </div>
      </div>
      <button class="del-btn" data-email="${escapeHtml(j.email)}">remove</button>
    </li>
  `).join('');
  list.querySelectorAll('.del-btn').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm(`Remove ${b.dataset.email}?`)) return;
      const r = await fetch('/api/journalists/' + encodeURIComponent(b.dataset.email), { method: 'DELETE' });
      if (!r.ok) { toast('delete failed'); return; }
      loadJournalists();
    })
  );
}

['j-filter-city', 'j-filter-beat', 'j-search'].forEach((id) => {
  document.getElementById(id)?.addEventListener('input', () => renderJournalists());
});

document.getElementById('journalist-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const beats = (f.get('beats') || '').toString().split(',').map((s) => s.trim()).filter(Boolean);
  const tags = (f.get('tags') || '').toString().split(',').map((s) => s.trim()).filter(Boolean);
  try {
    const r = await fetch('/api/journalists', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: f.get('name'), email: f.get('email'),
        outlet: f.get('outlet'), city: f.get('city'),
        relationship: f.get('relationship'),
        beats, tags, notes: f.get('notes'),
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    e.target.reset();
    toast('added ' + f.get('name'));
    loadJournalists();
  } catch (err) { toast(err.message); }
});

// ---------- Gmail send from Drafts step ----------
function setupGmailSendPanel() {
  const panel = document.getElementById('gmail-panel');
  if (!state.channels.has('journalist_email')) { panel.classList.add('hidden'); return; }
  if (!state.gmailConnected) {
    panel.classList.add('hidden');
    toast('Connect Gmail to send journalist emails');
    return;
  }
  panel.classList.remove('hidden');
  document.getElementById('gm-sender').textContent = state.senderEmail || '(sender)';
  state.selectedJournalistEmails.clear();
  loadJournalists().then(() => renderGmailRecipients());
}

function renderGmailRecipients() {
  const cityFilter = document.getElementById('gm-filter-city').value.trim().toLowerCase();
  const beatFilter = document.getElementById('gm-filter-beat').value.trim().toLowerCase();
  const container = document.getElementById('gm-recipients');
  let list = state.journalists;
  if (cityFilter) list = list.filter((j) => (j.city || '').toLowerCase().includes(cityFilter));
  if (beatFilter) list = list.filter((j) => (j.beats || []).some((b) => b.toLowerCase().includes(beatFilter)));
  if (!list.length) {
    container.innerHTML = '<div class="hint">no journalists match. add some in the Journalists tab or widen the filter.</div>';
    updateGmailCount();
    return;
  }
  container.innerHTML = list.map((j) => `
    <label class="gm-row">
      <input type="checkbox" data-email="${escapeHtml(j.email)}" ${state.selectedJournalistEmails.has(j.email) ? 'checked' : ''} />
      <div>
        <strong>${escapeHtml(j.name)}</strong>
        <span class="j-email">${escapeHtml(j.email)}</span>
        ${j.outlet ? `<span class="j-outlet">${escapeHtml(j.outlet)}</span>` : ''}
      </div>
      <div class="j-tags">
        ${j.city ? `<span class="tag-dot">${escapeHtml(j.city)}</span>` : ''}
        ${(j.beats || []).slice(0, 3).map((b) => `<span class="tag-dot beat">${escapeHtml(b)}</span>`).join('')}
      </div>
    </label>
  `).join('');
  container.querySelectorAll('input[type="checkbox"]').forEach((i) => {
    i.addEventListener('change', () => {
      if (i.checked) state.selectedJournalistEmails.add(i.dataset.email);
      else state.selectedJournalistEmails.delete(i.dataset.email);
      updateGmailCount();
    });
  });
  updateGmailCount();
}

function updateGmailCount() {
  const n = state.selectedJournalistEmails.size;
  document.getElementById('gm-count').textContent = `${n} selected`;
  document.getElementById('gm-send-btn').disabled = n === 0;
}

['gm-filter-city', 'gm-filter-beat'].forEach((id) => {
  document.getElementById(id)?.addEventListener('input', () => renderGmailRecipients());
});

document.getElementById('gm-send-btn').addEventListener('click', async () => {
  const draft = state.drafts.journalist_email || '';
  if (!draft) { toast('no journalist_email draft to send'); return; }
  const { subject, body } = splitSubjectBody(draft);
  if (!subject || !body) {
    toast('draft must start with a "Subject: ..." line');
    return;
  }
  const recipients = state.journalists.filter((j) => state.selectedJournalistEmails.has(j.email));
  if (!recipients.length) return;
  if (!confirm(`Send this email to ${recipients.length} journalists?`)) return;

  const btn = document.getElementById('gm-send-btn');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  const progress = document.getElementById('gm-progress');
  progress.innerHTML = recipients.map((j) => `
    <div class="im-row" data-email="${escapeHtml(j.email)}">
      <div><strong>${escapeHtml(j.name)}</strong> <span class="phone">${escapeHtml(j.email)}</span></div>
      <div></div>
      <div class="im-status queued">queued</div>
    </div>
  `).join('');

  for (const j of recipients) {
    const row = progress.querySelector(`.im-row[data-email="${CSS.escape(j.email)}"]`);
    row.querySelector('.im-status').textContent = 'sending';
    row.querySelector('.im-status').className = 'im-status sending';
    try {
      const firstName = j.name.trim().split(/\s+/)[0] || 'there';
      const personalizedBody = body.replace(/\{\{first_name\}\}/gi, firstName);
      const r = await fetch('/api/send-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: j.email,
          subject,
          body: personalizedBody,
          journalist_name: j.name,
          event_name: state.event.name,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'send failed');
      row.querySelector('.im-status').textContent = 'sent';
      row.querySelector('.im-status').className = 'im-status sent';
    } catch (err) {
      row.querySelector('.im-status').textContent = 'error';
      row.querySelector('.im-status').className = 'im-status error';
      row.children[1].innerHTML = `<span class="hint" title="${escapeHtml(err.message)}">${escapeHtml(err.message)}</span>`;
    }
    // brief delay between sends, just to be a good citizen
    await new Promise((r) => setTimeout(r, 800));
  }

  btn.disabled = false;
  btn.textContent = 'Send again';
  toast('Gmail batch complete');
});

function splitSubjectBody(draft) {
  const m = draft.match(/^\s*Subject:\s*(.+?)\r?\n([\s\S]*)$/);
  if (!m) return { subject: '', body: '' };
  return { subject: m[1].trim(), body: m[2].trim() };
}

// ---------- helpers ----------
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- sent log ----------

async function loadSendLog() {
  const loading = document.getElementById('sent-loading');
  if (loading) { loading.textContent = 'loading…'; loading.classList.remove('hidden'); }
  try {
    const r = await fetch('/api/send-log');
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'failed to load');
    renderSendLog(data.entries || []);
  } catch (err) {
    if (loading) loading.textContent = 'error: ' + err.message;
  }
}

function renderSendLog(entries) {
  const loading = document.getElementById('sent-loading');
  if (loading) loading.classList.add('hidden');
  const list = document.getElementById('sent-list');
  if (!list) return;
  if (!entries.length) {
    list.innerHTML = '<li class="hint" style="padding:12px 0">no emails sent yet.</li>';
    return;
  }
  list.innerHTML = entries.map((e) => `
    <li class="sent-row">
      <div class="sent-date">${escapeHtml(formatSentDate(e.sent_at))}</div>
      <div class="sent-to">${escapeHtml(e.journalist_name || e.journalist_email || '')}</div>
      <div class="sent-subject">${escapeHtml(e.subject || '')}</div>
      <div class="sent-status ${escapeHtml(e.status || '')}">${escapeHtml(e.status || '')}</div>
    </li>
  `).join('');
}

function formatSentDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return iso; }
}

// initial
loadContacts();
