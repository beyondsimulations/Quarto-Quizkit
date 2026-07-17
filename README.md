# Quarto Quizkit

A reusable [Quarto](https://quarto.org) extension for **formative self-check quizzes** on HTML websites and documents. Write questions as readable Markdown fenced divs; Quizkit compiles them into an interactive, self-grading widget that **brands itself automatically** from your site's theme or `_brand.yml`.

- **Zero configuration** — add the extension, write a quiz, done.
- **Four question types** — single choice, multi-select, numeric/text (with tolerant parsing), and K-prim (true/false grids).
- **Progress & persistence** — a live solved-counter and end-of-quiz first-try score; solved progress is saved and restored across reloads (localStorage), with a "Start over" control. On by default, with per-quiz and project-wide opt-outs.
- **Custom labels & shuffle** — override any question's submit button text; optionally randomise option order and/or question order.
- **Branded automatically** — styling rides on Bootstrap CSS variables (`--bs-primary`, `--bs-success`, …), so the quiz matches any Quarto theme or `_brand.yml` with no per-site styling.
- **Answer-safe for plaintext exports** — a format-aware filter emits the full widget in HTML but strips every answer from Markdown/`gfm`/`hugo-md` renders, so answer keys never leak into a plaintext corpus.
- **Automatic, anonymous telemetry** — if your page already loads [umami](https://umami.is), quizzes emit aggregate `quiz-answer` events automatically (no cookies, no per-student identity, no extra config). Opt out with one line, or wire the generic DOM event to any analytics.
- **Internationalised** — English, German, French, Spanish, Italian, and Dutch UI strings ship built in; override any string, or add your own language.

Quizzes are **formative and client-side**: answers live in the page and nothing is graded. There is no login, no backend, and no per-student identity. If your site already loads [umami](https://umami.is), anonymous aggregate events fire automatically — opt out with `quiz.telemetry: false` (see [Telemetry](#telemetry--three-modes)).

## Installation

```bash
quarto add beyondsimulations/Quarto-Quizkit
```

This puts the extension in `_extensions/quizkit/`. Then add the filter to your `_quarto.yml` (or a document's front matter):

```yaml
filters:
  - quizkit
```

## Quick start

````markdown
::: {.quiz}

::: {.question}
What is 2 + 2?

- [ ] 3
- [x] 4
- [ ] 5
:::

:::
````

That's it. `[x]` marks the correct option; `[ ]` marks a wrong one.

## Authoring reference

Everything lives inside a `::: {.quiz}` container. Each question is a `::: {.question}` div. Any prose between questions (intros, section headers) is passed through untouched.

### Single choice

Exactly one `[x]`:

````markdown
::: {.question}
Which framing is most defensible?

- [ ] Around 90% of all new products fail.
- [x] Depending on sector and definition, roughly a third to half fail within a year or two.
- [ ] Nearly all startups fail from lack of capital.
:::
````

### Multi-select

Two or more `[x]` ⇒ the question becomes all-or-nothing multi-select automatically:

````markdown
::: {.question}
Which are prime? (select all)

- [x] 2
- [x] 3
- [ ] 4
- [x] 5
:::
````

### Numeric / text

Give an `answer` attribute and no list. Numeric answers are matched tolerantly (thousands/decimal separators, `%`/currency symbols, unicode minus). `tolerance` (absolute) is optional:

````markdown
::: {.question answer="40" tolerance="0"}
Roughly what percent of new consumer goods are withdrawn within two years? Enter the number only.
:::
````

### K-prim (true/false grid)

Add `.kprim`; each task-list item is judged independently (`[x]` = true, `[ ]` = false):

````markdown
::: {.question .kprim}
Rate each statement.

- [x] The figure depends on how "failure" is defined.
- [ ] The 90% figure comes from an official EU statistic.
:::
````

Indent a markdown block under a statement to attach a per-statement explanation. All notes are revealed together only once the whole grid is solved correctly, so they can't be used to probe the answers:

````markdown
::: {.question .kprim}
Rate each statement.

- [x] Every integer is a rational number.

    Because ℤ ⊂ ℚ.
- [ ] Pi is a rational number.

    Pi is irrational (Lambert, 1761).
:::
````

### Custom submit label

Any question can override its submit button text with a `submit` attribute (works for every question type):

````markdown
::: {.question submit="Confirm answer"}
…
:::
````

### Per-option explanation (single choice)

Give an option its own explanation, revealed under the box when that option is picked — on **both correct and wrong** picks. Two forms:

**Short** — a bracketed span with an `explanation` attribute:

````markdown
- [ ] [Around 90% of all products fail.]{explanation="An unsourced figure repeated for decades."}
````

**Rich (any length, full markdown)** — indent a block under the option:

````markdown
- [x] 4

    Right: **2 + 2 = 4**. This is the basis for everything that follows.
- [ ] 3

    Close — that's 2 + 1. *Add one more.*
````

Per-option explanations are single-choice only; on multi-select and K-prim they would leak which options are correct, so they're omitted there.

### Per-question feedback (outcome-specific)

A `::: {.feedback}` block inside a question is revealed after it's answered — full markdown, any length. Add `.correct` or `.wrong` to show it only on that outcome; a plain `.feedback` shows on either. Combine them freely:

````markdown
::: {.question}
Is 7 prime?

- [x] Yes
- [ ] No

::: {.feedback}
A prime has exactly two divisors: 1 and itself.
:::

::: {.feedback .correct}
Exactly — 7's only divisors are 1 and 7.
:::

::: {.feedback .wrong}
Check: can any number other than 1 and 7 divide it evenly?
:::
:::
````

### Completion reveal

A `::: {.reveal}` block inside the quiz stays hidden until **every** question in the quiz is solved:

````markdown
::: {.reveal}
Nicely done — you worked through the whole self-test.
:::
````

### Quiz options

Attributes on the `.quiz` div:

| Attribute | Default | Effect |
|---|---|---|
| `lockout="10"` | `10` | Seconds a question is locked after a wrong answer. `0` disables the cooldown. |
| `shuffle="true"` | off | Randomise option order on load. |
| `shuffle-questions="true"` | off | Randomise the order of questions within the quiz on load. |
| `disable-on-check="true"` | off | Freeze a question after the first check instead of allowing retries. |
| `label="…"` | page index | Telemetry label for this quiz (see below). |
| `progress="false"` | on | Hide the live progress bar and first-try score for this quiz. |
| `persist="false"` | on | Disable saved progress and the "Start over" button for this quiz. |

```markdown
::: {.quiz lockout="5" shuffle="true"}
…
:::
```

### Progress & persistence

Every quiz shows a live **solved counter** and, on completion, a **first-try score** (how many questions were correct on the first attempt). Solved progress is **persisted** in the browser's `localStorage` and restored on reload; a **Start over** button clears it. Both are on by default.

Persistence is keyed by a content hash of each question, so editing a question automatically invalidates its saved state — a changed question never shows as falsely "solved". It is entirely client-side and anonymous: no server, no login, no per-student identity. If `localStorage` is unavailable (private mode), the quiz still works, just without memory.

Opt out per-quiz (attribute on `.quiz`) or project-wide (`quiz:` block):

| | Progress bar / score | Saved progress |
|---|---|---|
| `.quiz` attribute | `progress="false"` | `persist="false"` |
| `quiz:` metadata | `progress: false` | `persist: false` |

## Configuration

All optional. Put a `quiz:` block in `_quarto.yml` (project-wide) or a document's front matter (per-page):

```yaml
quiz:
  lang: de              # en (default) | de | fr | es | it | nl — built-in UI strings
  lockout: 10           # default cooldown seconds (overridable per .quiz)
  progress: true            # false to hide the solved counter + first-try score everywhere
  persist: true             # false to disable saved progress everywhere
  shuffle: false            # true to randomise option order by default
  shuffle-questions: false  # true to randomise question order by default
  strings:              # override any individual UI string
    submit: "Prüfen"
    correct: "Stimmt!"
  telemetry:            # only needed if the page doesn't already load umami; set 'telemetry: false' to opt out
    umami-src: "https://your-umami.example.com/script.js"
    umami-website-id: "00000000-0000-0000-0000-000000000000"
    label: "My Course"  # optional; defaults to the page title
```

Overridable string keys: `submit`, `correct`, `wrong`, `cooldown` (`{n}` = seconds left), `kprim_partial` (`{c}`/`{t}`), `multi_partial` (`{h}`/`{t}`), `kprim_true`, `kprim_false`, `placeholder`.

## Telemetry — three modes

**1. Automatic (default).** If the page already loads [umami](https://umami.is) — e.g. your site runs it for page analytics — Quizkit emits an anonymous, aggregate event `quiz-answer` on each answer, with `{ label, quiz, question, correct }`. No configuration, and no second umami script is injected. umami is cookieless and stores no per-user identity, so this inherits your site's existing analytics posture. If the page does not load umami, nothing is sent.

**2. Self-contained umami.** For a page that does *not* already load umami, add the `quiz.telemetry` block so Quizkit loads the script itself:

```yaml
quiz:
  telemetry:
    umami-src: "https://your-umami.example.com/script.js"
    umami-website-id: "00000000-0000-0000-0000-000000000000"
    label: "My Course"   # optional; defaults to the page title
```

**3. Opt out.** Set `quiz.telemetry: false` to disable umami firing entirely, even when umami is present on the page.

Regardless of the mode, Quizkit also dispatches a `quiz:answer` DOM event on every answer, so you can forward results to any analytics:

```js
document.addEventListener("quiz:answer", (e) => {
  const { label, quiz, question, correct } = e.detail;
  // send to Plausible / Matomo / GA / your endpoint …
});
```

`label` is the quiz/page label, `quiz` identifies the quiz on the page, `question` is its 1-based index, `correct` is a boolean. No answer text is ever included.

## Answer safety for plaintext exports

If your project also renders a Markdown format (e.g. `hugo-md` for a search index or an LLM corpus), Quizkit's filter is format-aware: HTML output gets the full widget, while any non-HTML output gets **only the question stems** — every option, answer, `[x]`, feedback, and reveal is stripped. Answer keys never reach your `.md` files. Note that non-HTML output keeps only the question stems: any loose prose between questions is omitted there (unlike HTML output, where it is passed through).

## Requirements

- Quarto ≥ 1.4
- A Quarto HTML format (any theme). No JavaScript dependencies, no build step.

## License

MIT — see [LICENSE](LICENSE).
