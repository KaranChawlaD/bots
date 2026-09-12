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

## Commands

```bash
# browse: every agent searches in parallel, one browser each
npm run kijiji -- search "ps5 controller" --max-price 60 --limit 20
npm run kijiji -- search "dining table" --account primary --json > results.json

# read one listing in full
npm run kijiji -- view https://www.kijiji.ca/v-view-details.html?adId=1700000000

# message a seller from a chosen account (asks for confirmation first)
npm run kijiji -- message 1700000000 --account primary --text "Hi, is this still available?"
npm run kijiji -- message 1700000000 --dry-run      # types the message, stops before sending

# price offers: each listing's ask is read live, the offer is drafted from it, you approve
npm run kijiji -- offer 1700000000 1700000001 --percent 80 --floor 40 --note "Can pick up this weekend."
npm run kijiji -- offer 1700000000 --amount 150 --account secondary --dry-run

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

## How sends are gated

Messaging is deliberately one-at-a-time, not a broadcast:

- **One conversation per listing per account** — repeats are refused using `data/sent-messages.json`.
- **Spacing and a daily cap** — `minSecondsBetweenMessages` and `maxMessagesPerAccountPerDay` in `accounts.json`.
- **Approval** — each message is printed with the listing title, asking price and offer, and waits for `y`, unless you pass `--yes` for that run.

Offers are priced per listing from that listing's live asking price (`--percent`,
with `--floor`/`--ceiling` bounds) or pinned with `--amount`, and rotate between
wording variants so they don't read as a copy-paste blast.

## Layout

```
src/
  cli.ts              commands and argument handling
  config.ts           accounts.json + .env loading
  safety.ts           rate limits, send history, approval prompt
  agents/pool.ts      runs one agent per account with a concurrency ceiling
  steel/agent.ts      Steel session + Playwright-over-CDP, profile save/restore
  steel/profiles.ts   per-account cookie/localStorage storage
  kijiji/auth.ts      sign-in and two-factor
  kijiji/listings.ts  search results and listing details
  kijiji/offers.ts    offer pricing and message drafting
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
(a number, `"free"` or `"contact"`), optional `photos` paths, and an optional
`account`. The category string is typed into Kijiji's picker and the first
suggestion is taken, so word it the way Kijiji labels it. The whole form is
filled and shown to you before anything is published.

## Notes

Use this on accounts you own, within Kijiji's terms. It is an assistant for
browsing, for conversations you would have anyway, and for listing items you
actually have — not a bulk-messaging tool.
