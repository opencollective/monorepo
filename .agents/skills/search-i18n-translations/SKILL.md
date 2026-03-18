---
name: search-i18n-translations
description: Searches lang/en.json for existing i18n strings in opencollective-frontend. Use when implementing UIs, adding user-facing text, or when the user asks to find or reuse translations.
---

# Search i18n Translations

## When to Use

- Before adding new translation keys—check if a suitable string already exists
- When implementing UI components that need user-facing text
- When asked to find translations for a given phrase or concept

## Command

From the workspace root, search `opencollective-frontend/lang/en.json` directly with grep:

```bash
grep -i "search string" opencollective-frontend/lang/en.json
```

## Match Modes

### Partial match (default)

Case-insensitive search in both translation IDs and messages. Use when exploring or when you have a word or phrase:

```bash
grep -i "payout method" opencollective-frontend/lang/en.json
```

### Exact match

Use when you have the **exact** translation ID or the **exact** message text.

**Exact ID** (key in the JSON):

```bash
grep '"Ri4REE":' opencollective-frontend/lang/en.json
```

**Exact message** (full value only—use `-F` to avoid regex, escape quotes if needed):

```bash
grep -F '": "Select a payout method"' opencollective-frontend/lang/en.json
```

For exact message, the pattern is `": "your exact message"` so the match is on the full value, not a substring.

## Usage in Components

When a suitable translation exists, use it with `FormattedMessage`:

```tsx
<FormattedMessage defaultMessage="Select a payout method" id="Ri4REE" />
```

Alternatively, when a string is needed as the output, use `intl.formatMessage`:

```tsx
const itemLabel = intl.formatMessage({
  id: "Ri4REE",
  defaultMessage: "Select a payout method",
});
```

Prefer reusing existing translations over adding new keys to keep the translation set maintainable.
