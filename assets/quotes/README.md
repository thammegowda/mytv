# Contributing motivational quotes

Motivational artwork is generated from [`motivation.jsonl`](./motivation.jsonl). Each non-empty line is one JSON object.

Quote contributions are accepted through pull requests at https://github.com/thammegowda/mytv.

## Schema

```json
{"id":"choose-a-stable-id","text":"First display line\nOptional second line","author":"Your name or handle","license":"CC0-1.0","image":"assets/quotes/images/optional-background.jpg"}
```

Fields:

- `id`: required unique lowercase kebab-case identifier.
- `text`: required quote text. Use `\n` for intentional line breaks; one to three display lines, no more than 80 characters each.
- `author`: required string with no more than 120 characters. Use an empty string for anonymous quotes.
- `license`: required; `CC0-1.0` or `CC-BY-4.0`.
- `image`: optional HTTPS URL or repository path under `assets/quotes/images/`.

When `image` is omitted, MyTV Art generates a deterministic gradient from the quote ID. When present, the image is darkened slightly and used behind the quote text.

## Pull requests

By opening a pull request, confirm that:

1. You wrote the quote or have the legal right to contribute it.
2. The quote and optional image are provided under the declared license.
3. The quote is not falsely attributed to another person.
4. The content is suitable for a general audience.
5. The JSON object occupies exactly one line and the file remains valid JSON Lines.

Run `npm test` before submitting. The loader rejects duplicate IDs, invalid image locations, unsupported licenses, and overlong text with a line-numbered error. Contributed text is XML-escaped before SVG generation.
