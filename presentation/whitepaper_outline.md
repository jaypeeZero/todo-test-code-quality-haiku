# Whitepaper outline

## 1. Problem — opening
- LLMs write more of the code; it drifts from house patterns.
- Linters can't judge meaning.
- Whole-repo LLM review misses things in large contexts and can't gate a build.

## 2. Jev: decisions, not conversation — before Scruple
- Answers one typed question: a choice, probabilities, a confidence.
- Software acts on high confidence, escalates on low.

`scruple-plugin-ideology/src/rules/injectDependencies.ts`
```ts
diagnose(answer, candidate) {
  if (answer.type !== 'choice' || answer.choice !== finding) return null   // typed: one of N criteria
  const probability = answer.probabilities[finding] ?? 0                    // per-criterion probability
  const severity = resolveDiagnosticSeverity(probability, answer.confidence, // calibrated confidence
    { threshold, minConfidence })                                           // -> warn | error | null
  ...
}
```

## 3. Scruple: how a rule works — core section
```
collect()   code scan picks candidates (no model)
  -> state     bounded excerpt: imports + function text (≤4000 chars)
  -> question  one fixed question
  -> criteria  closed set of answers, incl. "can't tell"
  -> diagnose  probability × confidence vs thresholds -> severity or nothing
```

```ts
const instructions =
  'Does this function build a collaborator it then uses, instead of receiving it as a parameter?'

const criteria = {
  constructs_collaborator_internally: '...client, repository, service, connection... constructed here and used',
  constructs_plain_value:             '...built-in types, errors, dates, collections, DTOs, value objects...',
  returns_constructed_object:         '...the function is itself a factory.',
  insufficient_context:               '...imports and body do not establish what the constructed thing is.'
}                                     // ^ "can't tell" is an allowed answer

const defaultThreshold     = { warning: 0.85, error: 0.95 }
const defaultMinConfidence = 0.7
```
- False-positive cases are named criteria, not left to judgment.
- The message is fixed text → consistent findings.

## 4. Coverage vs judgment — after §3

| Approach | Never examined | Judged wrong |
|---|---|---|
| Whole repo → LLM | ❌ misses entries | ❌ free text |
| `collect()` → LLM | ✅ | ⚠️ no confidence to gate on |
| `collect()` → Jev | ✅ | ✅ typed + confidence |

## 5. Ideology as rules — bridge to evidence
`todo_test/.scruple/scruple.config.ts`
```ts
'ideology/inject-dependencies':      'warn',  // Inject dependencies. Never instantiate or import a dependency internally
'ideology/no-hardcoded-config':      'warn',  // Config from the environment. No hardcoded credentials or connection strings
'ideology/no-hidden-state':          'warn',  // Pure functions, explicit inputs, no hidden state
'ideology/outbound-call-resilience': 'warn',  // ...infrastructure at the edges. Dependencies point inward
```
```ts
// scruple-disable-next-line ideology/no-hidden-state -- module-level cache is a deliberate exception
//                                                       ^ comments/require-justified-suppressions flags a missing reason
```

## 6. The experiment: `todo_test` — start of evidence
- Haiku wrote the code shown.
- Stages: no rules (`9669603`) → rules only (`ecb4fa8`) → rules + known-good patterns (`739fb9f`).
- Patterns = `prism-api/AGENTS.md` + `prism-api/docs/*.md`.

| Rule (`ecb4fa8`, one Haiku pass each) | Before → after |
|---|---|
| `comments/no-useless-comments` | 418 → 3 |
| `ideology/no-swallowed-errors` | 38 → 3 |
| `ideology/no-repeated-literals` | 21 → 3 |
| `ideology/no-hidden-state` | 46 → 10 |

- Whole repo: 635 → 222 after the first pass.

## 7. Example: `notifications.js` in three stages — main before/after

**No rules — `9669603:src/notifications.js`**
```js
const NOTIFICATIONS_URL = process.env.NOTIFICATIONS_URL || 'http://localhost:4002'; // module-level config
const APP_ENV = process.env.APP_ENV || 'development';

function getNotifyApiKey() {
  ...
  return process.env.NOTIFY_API_KEY || 'test-key-123';      // hardcoded credential fallback
}

async function publishEvent(topic, payload) {
  try {
    await fetch(`${NOTIFICATIONS_URL}/topics/${topic}/publish`, { ... });  // no timeout
  } catch (error) {
    console.error(`Failed to publish event to topic ${topic}:`, error);    // swallowed
  }
}
```

**Rules only — `ecb4fa8`**
```js
const SEND_ENDPOINT = '/send';
const JSON_CONTENT_TYPE = 'application/json';
const POST_METHOD = 'POST';                    // literals extracted into constants
const PROVIDER_ERROR_STATUS = 500;
const MAX_ATTEMPTS = 3;

function getNotifyApiKey() {
  ...
  return process.env.NOTIFY_API_KEY || 'test-key-123';      // still here
}

  } catch (error) {
    console.error(`Failed to publish event to topic ${topic}:`, error);
    throw error;                                             // now rethrows
  }
```

**Rules + patterns — `739fb9f:src/api/notifications.js`**
```js
class Notifications {
  #url; #apiKey; #enabled; #appEnv; #timeout; #maxAttempts
  constructor(config) { ... }                                 // config injected, not read from env

  async publishEvent(topic, payload) {
    ...
      signal: AbortSignal.timeout(this.#timeout)              // bounded outbound call
    ...
  }
}

function buildNotificationsConfig(env) {                      // env read once, at the edge
  ...
  let apiKey = null                                           // no credential fallback
  ...
}
```

Callers receive it instead of importing it (`src/api/todos.js`; written by Sonnet agents):
```diff
-const { publishEvent, sendNotification, publishToUser } = require('./notifications');
-function registerTodoRoutes(app, requireAuth, db, auth) {
+function registerTodoRoutes(app, requireAuth, db, auth, notifications) {
-      await publishEvent('todos', {
+      await notifications.publishEvent('todos', {
```

Findings across the three Haiku passes in `739fb9f`: 3 → 5 → 4 → 0
- pass 3 used guidance: "the platform provides a [timeout signal] directly from a duration"

Points:
- Rules only → easy local fixes; structural problems remain.
- Rules + patterns → structural fixes.

## 8. Example: clutter — `no-useless-comments`
418 → 3 in one Haiku pass.

**Before — `9669603:src/notifications.js`**
```js
// Notifications module for sending notifications and publishing events
// Send a notification with retry logic
async function sendNotification(to, subject, message) {
        // Retry on 500
        continue;
  // All retries failed, log and give up
  console.error('Failed to send notification after 3 attempts:', lastError);
// Publish an event to a topic
async function publishEvent(topic, payload) {
```

**After — `ecb4fa8`**
```js
// Determine which API key to use (per-env override or fallback to NOTIFY_API_KEY)
function getNotifyApiKey() {
```
- Kept: the comment explaining *why*. Removed: comments restating the next line.

## 9. Cheap models, good outcomes — payoff
```
Haiku writes code (guided by known-good shapes)
  -> scruple: bounded candidates, typed answers
  -> findings to Haiku
  -> Haiku fixes, copying the shape
  -> scruple re-runs (cached for unchanged code)
  -> clean -> human review
```
- Quality comes from the system, not the model → choosing a model becomes a cost decision.

## 10. Adoption — closing
- WWT level: security packs in CI.
- Team level: pattern packs that stop LLMs from breaking accepted patterns.
- The provider can be swapped; few alternatives to Jev exist today.

```ts
provider: cachedProvider(jevProvider({ apiKey }), {  // pins jev-1.13.0
  enabled: process.env['SCRUPLE_CACHE'] !== 'off'
}),
```

## 11. Limits — end
- A rule only sees what its code scan selects. Not caught by `no-hardcoded-config` (`src/api/index.js`):
```js
app.use(express.static('/Users/wrigjame/code/todo_test/src/ui'));
```
- Rules alone → the smallest change that clears the finding (§7 rules-only stage).

## Open
- Is `// Success` one of the 3 deliberately kept comments?
- Does `sendNotification` still get flagged at HEAD?
