// Regression test: quiz.js must read window.quizkitConfig LAZILY.
//
// Quarto emits the quiz.js dependency script in the head BEFORE the inline
// <script>window.quizkitConfig={…}</script> that quiz.lua injects via
// include_text("in-header", …). If quiz.js resolves the config at script-eval
// time, it always sees `undefined` and silently falls back to the English
// defaults (the bug observed on Study-Business-Basics with quiz.lang: de).
//
// This test replays that exact order: evaluate quiz.js first, define the
// config afterwards, then fire DOMContentLoaded — and asserts the configured
// strings are used. Run with: node tests/config-load-order.test.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(
    join(root, "_extensions", "quizkit", "quiz.js"),
    "utf8",
);

// Minimal DOM stub: one .scenario-block with zero questions and a progress
// bar. That is enough to drive the code path that renders S.progress and
// S.firsttry into the progress element.
function makeDom() {
    const listeners = {};
    const countEl = { textContent: "", style: {} };
    const scoreEl = { textContent: "", style: {} };
    const progressEl = {
        style: {},
        querySelector(sel) {
            if (sel === ".quiz-progress-count") return countEl;
            if (sel === ".quiz-progress-score") return scoreEl;
            return null;
        },
    };
    const scenario = {
        getAttribute: () => null,
        querySelector(sel) {
            return sel === ".quiz-progress" ? progressEl : null;
        },
        querySelectorAll: () => [],
    };
    const document = {
        title: "Test page",
        addEventListener(type, fn) {
            listeners[type] = fn;
        },
        querySelectorAll(sel) {
            return sel === ".scenario-block" ? [scenario] : [];
        },
    };
    return { document, listeners, countEl, scoreEl };
}

// Boots quiz.js the way a rendered page does: script eval first, config
// injection second (or never), DOMContentLoaded last.
function boot(config) {
    const { document, listeners, countEl, scoreEl } = makeDom();
    const sandbox = {
        document,
        location: { pathname: "/test.html" },
        localStorage: {
            length: 0,
            getItem: () => null,
            setItem() {},
            removeItem() {},
            key: () => null,
        },
        console,
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);

    vm.runInContext(source, sandbox); // 1. dependency script evaluates
    if (config !== undefined) sandbox.window.quizkitConfig = config; // 2. inline config script
    assert.ok(
        listeners["DOMContentLoaded"],
        "quiz.js should register a DOMContentLoaded handler",
    );
    listeners["DOMContentLoaded"](); // 3. DOM ready

    return { countEl, scoreEl };
}

// Config defined AFTER script eval (the real load order) must be honored.
const de = boot({
    lockout: 10,
    progress: true,
    persist: true,
    shuffle: false,
    shuffleQuestions: false,
    strings: {
        progress: "{s} / {t} gelöst",
        firsttry: "{c} / {t} im ersten Versuch richtig",
    },
});
assert.equal(
    de.countEl.textContent,
    "0 / 0 gelöst",
    "progress string must come from window.quizkitConfig, not the English default",
);
assert.equal(
    de.scoreEl.textContent,
    "0 / 0 im ersten Versuch richtig",
    "first-try string must come from window.quizkitConfig, not the English default",
);

// No config at all: the English defaults must still work.
const en = boot(undefined);
assert.equal(en.countEl.textContent, "0 / 0 solved");
assert.equal(en.scoreEl.textContent, "0 / 0 on the first try");

console.log("ok — quizkitConfig is resolved lazily; localized strings apply");
