# Quarto Quizkit

A reusable [Quarto](https://quarto.org) extension for **formative self-check quizzes** on HTML websites and documents. Write questions as readable Markdown fenced divs; Quizkit compiles them into an interactive, self-grading widget that **brands itself automatically** from your site's theme or `_brand.yml`.

- **Zero configuration** — add the extension, write a quiz, done. Nothing is tracked.
- **Four question types** — single choice, multi-select, numeric/text (with tolerant parsing), and K-prim (true/false grids).
- **Branded automatically** — styling rides on Bootstrap CSS variables (`--bs-primary`, `--bs-success`, …), so the quiz matches any Quarto theme or `_brand.yml` with no per-site styling.
- **Answer-safe for plaintext exports** — a format-aware filter emits the full widget in HTML but strips every answer from Markdown/`gfm`/`hugo-md` renders, so answer keys never leak into a plaintext corpus.
- **Optional, anonymous telemetry** — off by default. When enabled, it emits aggregate [umami](https://umami.is) events (no cookies, no per-student identity), or a generic DOM event you can wire to any analytics.
- **Internationalised** — English, German, French, Spanish, Italian, and Dutch UI strings ship built in; override any string, or add your own language.

Quizzes are **formative and client-side**: answers live in the page, nothing is graded or sent anywhere unless you opt in. There is no login, no backend, and no per-student tracking by design.

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
| `disable-on-check="true"` | off | Freeze a question after the first check instead of allowing retries. |
| `label="…"` | page index | Telemetry label for this quiz (see below). |

```markdown
::: {.quiz lockout="5" shuffle="true"}
…
:::
```

## Configuration

All optional. Put a `quiz:` block in `_quarto.yml` (project-wide) or a document's front matter (per-page):

```yaml
quiz:
  lang: de              # en (default) | de | fr | es | it | nl — built-in UI strings
  lockout: 10           # default cooldown seconds (overridable per .quiz)
  strings:              # override any individual UI string
    submit: "Prüfen"
    correct: "Stimmt!"
  telemetry:            # omit this whole block to disable telemetry entirely
    umami-src: "https://your-umami.example.com/script.js"
    umami-website-id: "00000000-0000-0000-0000-000000000000"
    label: "My Course"  # optional; defaults to the page title
```

Overridable string keys: `submit`, `correct`, `wrong`, `cooldown` (`{n}` = seconds left), `kprim_partial` (`{c}`/`{t}`), `multi_partial` (`{h}`/`{t}`), `kprim_true`, `kprim_false`, `placeholder`.

## Telemetry — three modes

**1. Off (default).** No `quiz.telemetry` block ⇒ no script is loaded and nothing is sent. GDPR-clean because the default is no tracking at all.

**2. umami.** Add the `quiz.telemetry` block above. Quizkit loads the umami script and, on each answer, sends an anonymous, aggregate event `quiz-answer` with `{ label, quiz, question, correct }`. umami is cookieless and stores no per-user identity.

**3. Your own analytics.** Quizkit dispatches a DOM event on every answer regardless of telemetry config, so you can forward it anywhere:

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
