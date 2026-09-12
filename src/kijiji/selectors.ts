/**
 * Kijiji ships markup changes regularly, so every selector lives here as an
 * ordered fallback list: the first one that matches wins.
 */
export const selectors = {
  signInLink: [
    'a[href*="/t-login.html"]',
    'a[data-testid="header-sign-in"]',
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
  loggedInMarker: [
    'a[href*="/m-my-ads"]',
    'a[href*="/m-msg-my-messages"]',
    '[data-testid="header-avatar"]',
  ],
  searchKeywordInput: [
    'input[name="keywords"]',
    'input[data-testid="search-keyword-input"]',
    'input[placeholder*="what are you looking for" i]',
    'input[type="search"]',
  ],
  searchSubmit: [
    'button[data-testid="search-submit"]',
    'form button[type="submit"]',
    'button:has-text("Search")',
  ],
  nextPageLink: ['a[title="Next"]', 'a[data-testid="pagination-next-link"]', 'a[rel="next"]'],
  searchResultCard: [
    '[data-testid="listing-card"]',
    "[data-listing-id]",
    'section[data-testid="srp-search-list"] li',
    "div.search-item",
  ],
  listingTitle: ['h1[data-testid="vip-title"]', "h1"],
  listingPrice: ['[data-testid="vip-price"]', '[itemprop="price"]', "span.price"],
  listingDescription: ['[data-testid="vip-description"]', 'div[itemprop="description"]'],
  listingSeller: ['[data-testid="vip-seller-name"]', 'a[href*="/o-profile/"]'],
  listingLocation: ['[data-testid="vip-location"]', 'span[itemprop="address"]'],
  messageOpenButton: [
    'button:has-text("Message")',
    'button:has-text("Send message")',
    '[data-testid="vip-contact-message"]',
  ],
  messageField: [
    'textarea[name="message"]',
    'textarea[data-testid="message-input"]',
    "form textarea",
    "textarea",
  ],
  messageSendButton: [
    'button[data-testid="send-message"]',
    'form button:has-text("Send")',
    'button:has-text("Send message")',
  ],
  messageSentMarker: [
    'text=/message (was )?sent/i',
    '[data-testid="message-sent-confirmation"]',
  ],
  postCategoryKeywordInput: [
    'input[data-testid="category-search-input"]',
    'input[placeholder*="what are you posting" i]',
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
