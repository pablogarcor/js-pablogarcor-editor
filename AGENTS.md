# AGENTS.md

Instructions for coding agents working on this repo: a dependency-free block
editor that publishes posts to pablogarcor/js-pablogarcor-web.

## Rules

- Branch from `origin/main` and open the PR against `main`. Never push to `main`.
- No dependencies: no `package.json`, no npm packages, no bundler, no CDN
  scripts. Plain ES modules that run as they are in the browser and in Node.
- Keep `// @ts-check` and JSDoc types on every file in `src/`.
- Never commit a token or any credential, not even in tests.
- Do not change the house style of the serializer (`*` bullets, `**bold**`,
  `*italic*`, `**_both_**`, ATX headings, backtick fences) without a task of
  its own: it decides the diff of every edited post.

## Module boundaries

- `src/model/` and `src/markdown/`: no DOM, no network. They must stay
  testable in Node.
- `src/hugo/post.js`: the only place that knows the blog's conventions
  (paths, front matter order, slug, translationKey).
- `src/github/`: the only code that talks to the network or sees the token.
- `src/media/webp.js`: browser only.
- `src/editor/view.js`: what the page shows, as plain objects. No DOM, so it
  stays testable in Node.
- `src/editor/dom.js`: the only view code that touches the DOM. Post content
  goes in as text nodes and attributes, never through `innerHTML`.
- `serve.js`: local server, 127.0.0.1 only, serves `index.html` and `src/`
  with a strict CSP. Do not loosen the CSP (no inline scripts or styles,
  no external origins) without a task of its own.

## Test

There are no dependencies to install. Node 20.11 or newer.

```sh
git clone https://github.com/pablogarcor/js-pablogarcor-web.git ../js-pablogarcor-web   # once
node --test
```

Run the editor with `node serve.js` and open http://localhost:8000.
CI also type-checks `src/` with `tsc -p jsconfig.json` (JSDoc only, no
TypeScript files).

`tests/corpus.test.js` reads the real posts from `../js-pablogarcor-web`
(or `BLOG_DIR`). Any change to `src/markdown/` must keep these green:

- `corpus.test.js`: lossless round trip of every post, verified blocks,
  stable canonical output.
- `fuzz.test.js`: random inline content must round-trip. If it finds a
  failure, fix the serializer; do not narrow the generator.
