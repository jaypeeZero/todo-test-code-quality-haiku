# `.scruple/`

Experimental. A self-contained install of the Scruple semantic lint: its own `package.json`, lockfile, and `scruple.config.ts`. Nothing else in the repository installs, builds, or tests against this directory.

## Running

The CLI is `node_modules/@scruple/cli/dist/bin.js`, run with `-c scruple.config.ts`. Run it only when asked: every run sends source excerpts to TypeSafe.

- `TYPESAFE_API_KEY` must be in the environment; the config throws without it.
- `SCRUPLE_CACHE=off` disables the decision cache for that run, forcing every candidate to go live.

## Config

`scruple.config.ts` enables the `errors`, `comments`, `tests`, `relational-databases`, and `ideology` plugins, and wraps the local Decider provider (`http://127.0.0.1:8000`) in `cachedProvider` from `scruple-provider-cache`. A rule runs only when it is listed under `rules`; the comment on each line is the principle it enforces.

A deliberate exception is recorded at the site with a reason after `--`:

```ts
// scruple-disable-next-line ideology/no-hidden-state -- module-level cache is a deliberate exception
```

`comments/require-justified-suppressions` flags a suppression with no reason.

## Picking up changes to a git-tracked plugin

`scruple-plugin-ideology` and `scruple-provider-cache` are git dependencies that track `main`. The lockfile records the exact commit, and npm keeps that commit until the entry is re-resolved, so `npm install` and `npm ci` do not pick up new commits on their own. To pull the latest `main`:

```sh
npm --prefix .scruple update scruple-plugin-ideology
```

Confirm the lockfile moved before running the lint:

```sh
jq '.packages["node_modules/scruple-plugin-ideology"] | {version, resolved}' .scruple/package-lock.json
```

`resolved` must end in the commit sha you expect from `main`. The same steps apply to `scruple-provider-cache`.

`Plugin <name> does not provide rule <id>` at startup means a rule listed in `scruple.config.ts` is missing from the installed plugin, usually because the bump above did not land.
