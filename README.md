# kijiji-agents

Steel.dev browser agents that drive **your own** Kijiji accounts: one cloud browser
per account, staying signed in, browsing listings, and sending messages you approve.

Each account gets its own Steel session, its own cookie/localStorage profile on
disk, and its own proxy/region — so accounts never share a browser fingerprint or
a login.

## Setup

```bash
npm install
cp .env.example .env                  # add STEEL_API_KEY + one password var per account
cp accounts.example.json accounts.json
npm run kijiji -- accounts            # sanity check the config
npm run kijiji -- login               # sign every agent in, save session profiles
```

`accounts.json`, `.env`, `profiles/` and `data/` are gitignored. Passwords are read
from environment variables named in `accounts.json` (`passwordEnv`), never stored
in the config file itself. Accounts with an authenticator app set `totpSecretEnv`
and codes are generated locally.

Kijiji often interrupts sign-in with a code mailed to the account. Run `login`
from a terminal and paste the code when prompted; the saved profile is then
reused until it expires. For unattended runs set `KIJIJI_EMAIL_CODE` instead.

## Commands

```bash
# browse: every agent searches in parallel, one browser each
npm run kijiji -- search "ps5 controller" --max-price 60 --limit 20
npm run kijiji -- search "dining table" --account primary --json > results.json

# read one listing in full
npm run kijiji -- view https://www.kijiji.ca/v-view-details.html?adId=1700000000

# message a seller from a chosen account (asks for confirmation first)
npm run kijiji -- message 1700000000 --account primary --text "Hi, is this still available?"
npm run kijiji -- message 1700000000 --dry-run      # types the message, stops before sending (no prompt)

# price offers: each listing's ask is read live, the offer is drafted from it, you approve
npm run kijiji -- offer 1700000000 1700000001 --percent 80 --floor 40 --note "Can pick up this weekend."
npm run kijiji -- offer 1700000000 --amount 150 --account secondary --dry-run

# ask a seller to match cheaper live listings of the same item
npm run kijiji -- offer 1700000000 --price-match --comps 3 --floor 40

# post a listing for something you're selling (form is filled, then you confirm)
npm run kijiji -- post listing.example.json --dry-run
npm run kijiji -- post listing.example.json --account secondary

# turn a saved search into an offer plan, edit it, then work through it
npm run kijiji -- search "ps5 controller" --json > results.json
npm run kijiji -- plan-offers results.json --percent 80 --out offer-plan.json
npm run kijiji -- run offer-plan.json
npm run kijiji -- history           # what each account has already messaged
```

Add `--viewer` to any command to print the Steel session viewer URL and watch the
agent work live.

## Control panel

```bash
npm run ui           # http://127.0.0.1:5173
```

The same commands with a browser in front of them: pick which agents run, search,
open a listing, draft offers, write a message, fill the ad form, and read the send
history. Agent logs stream into the page as the job runs, and anything the
terminal would ask for — a mailed sign-in code, approval before a message or an
ad goes out — appears as a prompt in the page instead.

One job runs at a time, since each one opens cloud browsers you pay for.

**Password.** Set `UI_PASSWORD` in `.env` and the panel asks for it. Signing in
sets a cookie signed with a key generated at startup, so restarting the server
signs every browser out, and wrong guesses lock out for a minute after five
tries. Leave `UI_PASSWORD` empty and there is no sign-in at all — fine on
localhost, but never with `HOST` or a tunnel, since whoever reaches the port can
message and post from your accounts.

**Reaching it from elsewhere.** It listens on `127.0.0.1:5173`; `HOST=0.0.0.0`
opens it to your network, and any tunnel (`cloudflared tunnel --url
http://localhost:5173`, `ngrok http 5173`) gives it a public HTTPS address. The
cookie is not marked `Secure`, so anything past your own LAN should go through a
tunnel or a reverse proxy that terminates TLS — the panel drives real accounts
and the password is all that stands in front of it.

## How sends are gated

Messaging is deliberately one-at-a-time, not a broadcast:

- **One conversation per listing per account** — repeats are refused using `data/sent-messages.json`.
- **Spacing and a daily cap** — `minSecondsBetweenMessages` and `maxMessagesPerAccountPerDay` in `accounts.json`.
- **Approval** — each message is printed with the listing title, asking price and offer, and waits for `y`, unless you pass `--yes` for that run.

Offers are priced per listing from that listing's live asking price (`--percent`,
with `--floor`/`--ceiling` bounds) or pinned with `--amount`, and rotate between
wording variants so they don't read as a copy-paste blast.

An account can also carry a `style` in `accounts.json`, so its drafts read the
way that account's owner actually types rather than like a form letter:

```json
"style": { "casing": "lower", "length": "brief", "slang": true, "emoticons": false }
```

`casing: "lower"` drops everything to lowercase, `length: "brief"` keeps the
sentence with the offer in it, `slang` swaps a few openers and sign-offs, and
`emoticons` adds a closing `:)`. Quoted comparable listings are left alone —
lowercasing a URL breaks it. Style only changes wording; it is not a persona,
and every message still goes out from the account of the person it belongs to.

## Price matching

`--price-match` has the agent search Kijiji for the same item, keep the listings
that are genuinely cheaper, and quote them with their prices and links so the
seller can check them. The offer is then the cheapest of those (still bounded by
`--floor`/`--ceiling`), rather than a percentage of the ask.

Comparables are filtered before they are cited: a real price, cheaper than the
ask, at least half the title words in common, and no lower than `--comps-min-ratio`
(0.5) of the ask so accessories and parts don't get quoted as the same item. If
nothing survives the filter, the offer falls back to the percentage and cites
nothing. Use `--comps-query` when the title is worded oddly, and `--comps` to
change how many are quoted (3).

`plan-offers --price-match` does the same offline, using the other listings in
the search file as the comparables.

## How Kijiji is reached

Kijiji publishes no public developer API, so everything here is a real browser
driven through Steel:

- **Search** goes straight to `kijiji.ca/b-canada/<keywords>/k0l0` with `sort` and
  `price` parameters, paging through `/page-N` — no dependence on the header
  search box.
- **Listing details** are read from the page's schema.org JSON-LD first, with DOM
  selectors as the fallback, so a class rename doesn't blank out a listing.
- **Sign-in** starts at `/consumer/login`, which hands off to `id.kijiji.ca`.
  Messaging and posting past that point can only be verified with a signed-in
  account; treat those selectors as the first thing to check when a run fails.

Search, listing details and the sign-in form have been run live against Kijiji
through a Steel session.

**Blocks.** Kijiji answers 429 from addresses it doesn't like, and cloud IPs get
hit sooner than home ones — commands fail with that status rather than quietly
reporting zero results. Steel's own proxies and CAPTCHA solving are billed
extras, so they are off unless you ask: set `"useProxy": true` (or a residential
`"proxyUrl"`) on the account, and `STEEL_SOLVE_CAPTCHA=true` in the environment.

## Layout

```
src/
  cli.ts              commands and argument handling
  ui/server.ts        control panel HTTP API, serving web/
  ui/jobs.ts          job queue, log capture, in-page prompts
  config.ts           accounts.json + .env loading
  safety.ts           rate limits, send history, approval prompt
  agents/pool.ts      runs one agent per account with a concurrency ceiling
  steel/agent.ts      Steel session + Playwright-over-CDP, profile save/restore
  steel/profiles.ts   per-account cookie/localStorage storage
  kijiji/auth.ts      sign-in and two-factor
  kijiji/listings.ts  search results and listing details
  kijiji/offers.ts    offer pricing and message drafting
  kijiji/comps.ts     finding cheaper comparable listings to cite
  kijiji/messages.ts  the send flow
  kijiji/post.ts      creating a listing from a draft file
  kijiji/selectors.ts every DOM selector, with fallbacks
```

Kijiji changes its markup regularly. When a command reports it could not find an
element, update the fallback list in `src/kijiji/selectors.ts` — that file is the
only place selectors live.

## Posting

`post` takes a JSON file with one draft or an array of them (see
`listing.example.json`): `title`, `description`, `category`, `location`, `price`
(a number, `"free"` or `"contact"`), optional `photos` paths, optional
`locationId`, and an optional `account`. Kijiji's first posting step takes the ad
title and only then shows categories: give `category` as a full path such as
`"Buy & Sell > Video Games & Consoles > Nintendo Switch"` and each level is
clicked in turn; a single label falls back to Kijiji's own suggestion, with a
warning.

Kijiji will not render the ad form until the browser has an area set, so drafts
need `locationId` — the number in any Kijiji city URL, e.g.
`/b-city-of-toronto/l1700273` → `1700273`. `location` is the postal code typed
into the ad itself. Photo paths are absolute or relative to the directory you run
from. The whole form is filled and shown to you before anything is published;
`--dry-run` stops after filling it.

## Notes

Use this on accounts you own, within Kijiji's terms. It is an assistant for
browsing, for conversations you would have anyway, and for listing items you
actually have — not a bulk-messaging tool.
