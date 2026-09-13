/**
 * Which of your accounts.json accounts plays which role in the scenario, and
 * how each one prices its move. Edit the `account` ids below to match the
 * `id` field of real accounts in the root project's accounts.json — this UI
 * never invents accounts, it only drives the ones already configured there.
 */

export type AgentRole = "lowball" | "fair" | "poster";

export interface AgentConfig {
  /** Must match an `id` in accounts.json. */
  account: string;
  /** Display name shown on its card. */
  name: string;
  role: AgentRole;
  /** For "lowball"/"fair" roles: percent of the asking price to offer. */
  percent?: number;
  note?: string;
}

export const ROLE_LABEL: Record<AgentRole, string> = {
  lowball: "Lowball offer",
  fair: "Fair offer",
  poster: "Competing listing",
};

export const AGENTS: AgentConfig[] = [
  {
    account: "hernandez",
    name: "Hernandez",
    role: "lowball",
    percent: 60,
    note: "Best I can do, cash in hand today.",
  },
  {
    account: "hing",
    name: "Hing",
    role: "lowball",
    percent: 70,
    note: "Would you take this for a quick pickup?",
  },
  {
    account: "karan",
    name: "Karan",
    role: "fair",
    percent: 92,
    note: "Fair price for both of us — can grab it this week.",
  },
  {
    account: "bobby",
    name: "Bobby",
    role: "poster",
  },
];

/**
 * Bobby's job is to list a competing item, but the scenario only has a
 * *viewed* listing to go on — Kijiji requires a category and (for a fresh
 * browser profile) an area id that a listing page never exposes. Fill these
 * in so his card can actually run instead of stopping at "needs setup":
 *  - category: a full path ("Buy & Sell > Video Games & Consoles > Nintendo
 *    Switch") or a single label Kijiji can match against the copied title.
 *  - locationId: the number in any Kijiji city URL, e.g.
 *    /b-city-of-toronto/l1700273 -> 1700273. Leave blank if that account's
 *    saved browser profile already has an area set.
 */
export const POSTER_DEFAULTS = {
  category: "",
  locationId: "",
};
