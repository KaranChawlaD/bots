/**
 * Kijiji ships markup changes regularly, so every selector lives here as an
 * ordered fallback list: the first one that matches wins.
 */
export const selectors = {
  signInLink: [
    '[data-testid="header-sign-in"]',
    'a[href*="/consumer/login"]',
    'button:has-text("Sign In")',
  ],
  emailField: ['input[type="email"]', 'input[name="email"]', "#email"],
  passwordField: ['input[type="password"]', 'input[name="password"]', "#password"],
  submitLogin: [
    'button[type="submit"]',
    'button:has-text("Sign in")',
    'button:has-text("Log in")',
  ],
  totpField: ['input[name="code"]', 'input[autocomplete="one-time-code"]', 'input[name="otp"]'],
  /** Kijiji's own step: it mails a code instead of using an authenticator app. */
  emailCodeRequest: [
    'form#fm1 button:has-text("Send Code")',
    'button:has-text("Send Code")',
    'button:has-text("Send code")',
  ],
  emailCodeField: [
    'input[autocomplete="one-time-code"]',
    'input[name="code"]',
    'input[name="otpCode"]',
    'input[inputmode="numeric"]',
  ],
  loggedInMarker: [
    '[data-testid="header-avatar"]',
    '[data-testid="header-my-account"]',
    'a[href*="/m-my-ads"]',
    'a[href*="/m-msg-my-messages"]',
  ],
  /** Present only while signed out; the header shows buttons, not links. */
  signedOutMarker: ['[data-testid="header-sign-in"]', '[data-testid="header-register"]'],
  searchKeywordInput: [
    '[data-testid="global-header-search-bar"] input',
    '[data-testid="global-search-bar"] input',
    'input[name="keywords"]',
    'input[placeholder*="what are you looking for" i]',
    'input[type="search"]',
  ],
  searchSubmit: [
    'button[data-testid="search-submit"]',
    'form button[type="submit"]',
    'button:has-text("Search")',
  ],
  searchResultCard: [
    '[data-testid="rich-card"]',
    '[data-testid="srp-grid-search-list"] > li',
    '[data-testid="listing-card"]',
    "[data-listing-id]",
  ],
  listingTitle: ['h1[data-testid="vip-title"]', "h1"],
  listingPrice: ['[data-testid="vip-price"]', '[itemprop="price"]', "span.price"],
  listingDescription: [
    '[data-testid="vip-description-wrapper"]',
    '[data-testid="vip-description"]',
  ],
  /** The heading link, not the avatar link above it, whose text is one initial. */
  listingSeller: [
    '[data-testid="vip-about-seller"] h3 a[href*="/o-profile/"]',
    '[data-testid="vip-about-seller"] a[href*="/o-profile/"]:not(:has([data-testid="profile-avatar"]))',
    'a[href*="/o-profile/"]',
  ],
  listingLocation: ['[data-testid="vip-location"]', 'span[itemprop="address"]'],
  /** Only openers — never the composer's own "Send message" submit button. */
  messageOpenButton: [
    '[data-testid="vip-contact-message"]',
    'button:text-is("Message")',
    'button:text-is("Contact seller")',
  ],
  messageField: [
    'textarea[name="message"]',
    'textarea[data-testid="message-input"]',
    "form textarea",
    "textarea",
  ],
  messageSendButton: [
    'button[data-testid="send-message"]',
    '[data-testid="r2s-form"] button[type="submit"]',
    'button:has-text("Send message")',
  ],
  messageSentMarker: [
    'text=/message (was )?sent/i',
    '[data-testid="message-sent-confirmation"]',
  ],
  /** First step of posting: the ad title, which Kijiji turns into category suggestions. */
  postTitleSeedField: [
    'input[data-testid="category-search-input"]',
    'input[placeholder*="what are you posting" i]',
    'input[placeholder*="title" i]',
    'input[name="categoryKeyword"]',
    'form input[type="text"]',
  ],
  postCategorySuggestion: [
    '[data-testid="category-suggestion"]',
    'ul[role="listbox"] li',
    'button[data-testid="category-option"]',
  ],
  postTitleField: ['input[name="title"]', 'input[data-testid="title-input"]', "#postad-title"],
  postDescriptionField: [
    'textarea[name="description"]',
    'textarea[data-testid="description-input"]',
    "#pstad-descrptn",
  ],
  postPriceField: ['input[name="price"]', 'input[data-testid="price-input"]', "#PriceAmount"],
  postLocationField: [
    'input[name="location"]',
    'input[data-testid="location-input"]',
    'input[placeholder*="postal code" i]',
  ],
  postLocationSuggestion: ['ul[role="listbox"] li', '[data-testid="location-suggestion"]'],
  postPhotoInput: ['input[type="file"]'],
  postContinueButton: [
    'button[data-testid="next-button"]',
    'button:has-text("Next")',
    'button:has-text("Continue")',
  ],
  postSubmitButton: [
    'button[data-testid="post-ad-button"]',
    'button:has-text("Post your ad")',
    'button:has-text("Post Ad")',
    'button[type="submit"]',
  ],
  postSuccessMarker: [
    'text=/your ad is (now )?(live|posted)/i',
    '[data-testid="post-ad-success"]',
    'a[href*="/m-my-ads"]',
  ],
} as const;

export type SelectorKey = keyof typeof selectors;
