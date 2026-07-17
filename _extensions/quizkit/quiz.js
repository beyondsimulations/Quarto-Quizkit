(function () {
    // --- CONFIG SHIM ---
    // The Lua filter injects window.quizkitConfig into the head. Fall back to
    // English defaults so the engine still runs if the config is missing.
    const CFG = window.quizkitConfig || {};
    const S = Object.assign(
        {
            submit: "Check",
            correct: "Correct!",
            wrong: "Not quite. ",
            cooldown: "Try again in {n}s …",
            kprim_partial: "{c}/{t} statements rated correctly",
            multi_partial: "{h} of {t} correct answers selected",
            progress: "{s} / {t} solved",
            firsttry: "{c} / {t} on the first try",
            reset: "Start over",
        },
        CFG.strings || {},
    );
    const DEFAULT_LOCKOUT = Number.isFinite(CFG.lockout) ? CFG.lockout : 10;
    const fmt = (str, map) => str.replace(/\{(\w+)\}/g, (_, k) => map[k]);

    // Per-scenario lockout: data-lockout overrides the global default; a
    // non-finite attribute falls back to the default too.
    function lockoutFor(scenario) {
        const rawv = scenario.getAttribute("data-lockout");
        const n = rawv != null ? Number(rawv) : DEFAULT_LOCKOUT;
        return Number.isFinite(n) ? n : DEFAULT_LOCKOUT;
    }

    document.addEventListener("DOMContentLoaded", function () {
        const scenarios = document.querySelectorAll(".scenario-block");

        // --- HELPER: NUMERIC PARSE (thousands / decimal separators) ---
        // Turns a user-typed number string into a float, deciding whether
        // "," "." or spaces act as thousands separators or a decimal mark.
        function parseNumeric(str) {
            // Remove all internal whitespace ("3 200" -> "3200").
            let s = str.replace(/\s+/g, "");

            if (/^-?\d{1,3}([.,]\d{3})+$/.test(s)) {
                // Digit groups of exactly 3 -> thousands separators: strip them
                // ("3,200", "3.200", "1,000,000" -> 3200 / 1000000).
                s = s.replace(/[.,]/g, "");
            } else if (/^-?\d+,\d+$/.test(s)) {
                // A single comma with a non-thousands part -> decimal comma
                // ("7,5" -> "7.5"). "3.2" keeps "." as its decimal point.
                s = s.replace(",", ".");
            }

            if (s === "" || s === "-" || isNaN(Number(s))) return null;
            return Number(s);
        }

        // --- HELPER: TOLERANT ANSWER COMPARISON ---
        // Applied to BOTH the typed answer and the expected data-answer so
        // that answers written in common formats still count as correct.
        function answersMatch(userRaw, correctRaw, tol) {
            // Shared text normalization for both sides.
            function normalize(str) {
                return str
                    .trim()
                    .toLowerCase()
                    // Unicode minus + en/em dashes -> plain hyphen.
                    .replace(/[−–—]/g, "-")
                    // Strip currency/percent symbols anywhere.
                    .replace(/[€$%]/g, "")
                    // Strip an optional leading variable prefix ("q=", "x = ").
                    .replace(/^[a-z]\s*=\s*/, "")
                    // Strip a single trailing "." or ",".
                    .replace(/[.,]$/, "")
                    .trim();
            }

            const user = normalize(userRaw);
            const correct = normalize(correctRaw);

            // If the expected answer is numeric, compare numerically so that
            // "7.0", "7,0", "3 200" etc. still match (but "3.2" != 3200,
            // "-2" != 2).
            if (correct !== "" && !isNaN(Number(correct))) {
                const userNum = parseNumeric(user);
                const tolNum = Number(tol) || 0;
                return userNum !== null && Math.abs(userNum - Number(correct)) <= tolNum;
            }

            // Non-numeric answer (e.g. "true"/"false"): compare as strings.
            return user === correct;
        }

        scenarios.forEach((scenario) => {
            const hiddenText = scenario.querySelector(".revealed-text");
            const boxes = scenario.querySelectorAll(".puzzle-box");

            // We keep track of how many boxes are solved. Only count boxes
            // that are actually wireable (have a submit button), so a
            // malformed box never blocks the completion reveal.
            const totalRequired = Array.from(boxes).filter((b) =>
                b.querySelector(".quiz-submit"),
            ).length;

            // --- PROGRESS / FIRST-TRY SCORE ---
            // Per-quiz attr (data-progress) overrides the global default (on).
            function resolveFlag(attr, globalOn) {
                const a = scenario.getAttribute(attr);
                if (a === "false") return false;
                if (a === "true") return true;
                return globalOn !== false;
            }
            const progressOn = resolveFlag("data-progress", CFG.progress);
            const progressEl = scenario.querySelector(".quiz-progress");
            const persistOn = resolveFlag("data-persist", CFG.persist);
            const quizIndex = [
                ...document.querySelectorAll(".scenario-block"),
            ].indexOf(scenario);
            // Per-box keys are keyed by a CONTENT HASH, not position, so the
            // key survives question-order shuffle and a question edit
            // automatically orphans its old key (no false "solved").
            const keyPrefix =
                "quizkit:" + location.pathname + ":" + quizIndex + ":";

            function quizHash(str) {
                let h = 5381;
                for (let i = 0; i < str.length; i++)
                    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
                return (h >>> 0).toString(36);
            }
            // Show the bar if progress OR persistence needs it; hide the
            // count/score when progress is off, and the reset button when
            // persistence is off.
            const showBar = (progressOn && totalRequired > 0) || persistOn;
            if (progressEl) {
                progressEl.style.display = showBar ? "" : "none";
                if (!progressOn) {
                    const c = progressEl.querySelector(".quiz-progress-count");
                    const s = progressEl.querySelector(".quiz-progress-score");
                    if (c) c.style.display = "none";
                    if (s) s.style.display = "none";
                }
                const rb = progressEl.querySelector(".quiz-reset");
                if (rb && !persistOn) rb.style.display = "none";
            }

            function updateProgress() {
                if (!progressOn || !progressEl) return;
                const solved =
                    scenario.querySelectorAll(".puzzle-box.solved").length;
                const countEl =
                    progressEl.querySelector(".quiz-progress-count");
                if (countEl)
                    countEl.textContent = fmt(S.progress, {
                        s: solved,
                        t: totalRequired,
                    });
            }

            function showFirstTryScore() {
                if (!progressOn || !progressEl) return;
                const scoreEl =
                    progressEl.querySelector(".quiz-progress-score");
                if (!scoreEl) return;
                const firstTry = scenario.querySelectorAll(
                    '.puzzle-box[data-first-try="true"]',
                ).length;
                scoreEl.textContent = fmt(S.firsttry, {
                    c: firstTry,
                    t: totalRequired,
                });
            }

            boxes.forEach((box) => {
                const optionsContainer = box.querySelector(".quiz-options");

                // Stable content hash captured before any DOM mutation.
                const boxHash = quizHash(
                    (box.textContent || "").replace(/\s+/g, " ").trim(),
                );

                // Optional per-scenario option shuffle: Fisher–Yates over the
                // option buttons so their DOM order is randomized on load.
                if (
                    scenario.getAttribute("data-shuffle") === "true" &&
                    optionsContainer
                ) {
                    const kids = [...optionsContainer.children];
                    for (let i = kids.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        optionsContainer.appendChild(kids[j]);
                        kids.splice(j, 1);
                    }
                }

                // Multi-response boxes are marked with .quiz-multi on their
                // options container: options toggle instead of exclusively
                // selecting, and >=1 selection is enough to enable Submit.
                const isMulti = !!(
                    optionsContainer &&
                    optionsContainer.classList.contains("quiz-multi")
                );
                // K-Prim boxes carry a .kprim-table instead of .quiz-options:
                // four independent true/false rows, each judged separately.
                const kprimTable = box.querySelector(".kprim-table");
                const kprimRows = kprimTable
                    ? Array.from(kprimTable.querySelectorAll(".kprim-row"))
                    : [];
                const options = box.querySelectorAll(".quiz-option");
                const inputField = box.querySelector(".quiz-input");
                const submitBtn = box.querySelector(".quiz-submit");
                const feedback = box.querySelector(".quiz-feedback");

                // A box missing its submit button can't be wired. Skip it
                // gracefully instead of throwing on submitBtn access below,
                // which would permanently block the completion reveal.
                if (!submitBtn) {
                    console.warn(
                        "Quiz: puzzle-box missing .quiz-submit, skipping.",
                        box,
                    );
                    return;
                }

                // Screen readers should announce feedback changes (penalty
                // countdown, success message) without stealing focus.
                if (feedback) feedback.setAttribute("aria-live", "polite");

                // Authoring-error checks: warn early so a broken quiz page
                // is caught in the console during development.
                if (isMulti) {
                    const anyCorrect = Array.from(options).some(
                        (o) => o.getAttribute("data-correct") === "true",
                    );
                    if (!anyCorrect) {
                        console.warn(
                            'Quiz: .quiz-multi has no data-correct="true" option; it can never be solved.',
                            optionsContainer,
                        );
                    }
                }
                kprimRows.forEach((row) => {
                    const answer = row.getAttribute("data-kprim");
                    if (answer !== "richtig" && answer !== "falsch") {
                        console.warn(
                            'Quiz: kprim-row missing data-kprim="richtig|falsch".',
                            row,
                        );
                    }
                });

                let selectedBtn = null;
                // Tracks the chosen options for a multi-response box.
                let selectedSet = new Set();

                // --- LOGIC A: BUTTONS (Single Choice) ---
                if (options.length > 0 && !isMulti) {
                    options.forEach((opt) => {
                        opt.addEventListener("click", function () {
                            if (submitBtn.style.display === "none") return; // Already solved
                            if (this.disabled) return; // Penalty active

                            // Visual selection
                            options.forEach((o) =>
                                o.classList.remove("selected"),
                            );
                            this.classList.add("selected");
                            selectedBtn = this;

                            submitBtn.disabled = false;
                        });
                    });
                }

                // --- LOGIC A2: BUTTONS (Multiple Response) ---
                if (isMulti) {
                    options.forEach((opt) => {
                        opt.setAttribute("aria-pressed", "false");
                        opt.addEventListener("click", function () {
                            if (submitBtn.style.display === "none") return; // Already solved
                            if (this.disabled) return; // Penalty active

                            // Toggle this option in/out of the selection.
                            this.classList.toggle("selected");
                            const pressed =
                                this.classList.contains("selected");
                            this.setAttribute("aria-pressed", String(pressed));
                            if (pressed) {
                                selectedSet.add(this);
                            } else {
                                selectedSet.delete(this);
                            }

                            submitBtn.disabled = selectedSet.size === 0;
                        });
                    });
                }

                // --- LOGIC B: INPUT FIELD (Type Answer) ---
                if (inputField) {
                    inputField.addEventListener("input", function () {
                        if (submitBtn.style.display === "none") return;

                        // Enable button only if text is typed
                        if (this.value.trim().length > 0) {
                            submitBtn.disabled = false;
                        } else {
                            submitBtn.disabled = true;
                        }
                    });

                    // Allow pressing "Enter"
                    inputField.addEventListener("keypress", function (event) {
                        if (event.key === "Enter" && !submitBtn.disabled) {
                            submitBtn.click();
                        }
                    });
                }

                // --- LOGIC C: K-PRIM TABLE (4 richtig/falsch rows) ---
                if (kprimTable) {
                    kprimRows.forEach((row) => {
                        const trueBtn = row.querySelector(".kprim-true");
                        const falseBtn = row.querySelector(".kprim-false");
                        if (!trueBtn || !falseBtn) return;

                        trueBtn.setAttribute("aria-pressed", "false");
                        falseBtn.setAttribute("aria-pressed", "false");

                        const choose = function (choice) {
                            if (submitBtn.style.display === "none") return; // Already solved
                            if (trueBtn.disabled || falseBtn.disabled) return; // Penalty active

                            row.dataset.chosen = choice;
                            trueBtn.classList.toggle(
                                "selected",
                                choice === "richtig",
                            );
                            falseBtn.classList.toggle(
                                "selected",
                                choice === "falsch",
                            );
                            trueBtn.setAttribute(
                                "aria-pressed",
                                String(choice === "richtig"),
                            );
                            falseBtn.setAttribute(
                                "aria-pressed",
                                String(choice === "falsch"),
                            );

                            const allAnswered = kprimRows.every(
                                (r) => r.dataset.chosen,
                            );
                            submitBtn.disabled = !allAnswered;
                        };

                        trueBtn.addEventListener("click", () =>
                            choose("richtig"),
                        );
                        falseBtn.addEventListener("click", () =>
                            choose("falsch"),
                        );
                    });
                }

                // --- SUBMISSION HANDLER ---
                if (submitBtn) {
                    submitBtn.addEventListener("click", function () {
                        let isCorrect = false;
                        // Set for a wrong multi-response/K-Prim guess to show
                        // a partial-progress message instead of the plain
                        // wrong text; kept null for single-choice/input.
                        let wrongMessage = null;
                        let errorEl = null;

                        if (kprimTable) {
                            // Check K-Prim: every row's choice must match its
                            // data-kprim answer.
                            const correctCount = kprimRows.filter(
                                (r) =>
                                    r.dataset.chosen ===
                                    r.getAttribute("data-kprim"),
                            ).length;
                            isCorrect = correctCount === kprimRows.length;
                            errorEl = kprimTable;
                            if (!isCorrect) {
                                wrongMessage = fmt(S.kprim_partial, {
                                    c: correctCount,
                                    t: kprimRows.length,
                                });
                            }
                        } else if (isMulti) {
                            // Check multi-response: the selected set must
                            // exactly equal the set of data-correct="true"
                            // options.
                            const correctOptions = Array.from(options).filter(
                                (o) =>
                                    o.getAttribute("data-correct") === "true",
                            );
                            const selectedArr = Array.from(selectedSet);
                            const hits = selectedArr.filter(
                                (o) =>
                                    o.getAttribute("data-correct") === "true",
                            ).length;
                            isCorrect =
                                selectedArr.length === correctOptions.length &&
                                hits === correctOptions.length;
                            errorEl = optionsContainer;
                            if (!isCorrect) {
                                wrongMessage = fmt(S.multi_partial, {
                                    h: hits,
                                    t: correctOptions.length,
                                });
                            }
                        } else if (selectedBtn) {
                            // Check MCQ
                            isCorrect =
                                selectedBtn.getAttribute("data-correct") ===
                                "true";
                            errorEl = selectedBtn;
                        } else if (inputField) {
                            // Check Input (tolerant, format-insensitive)
                            const rawCorrect =
                                submitBtn.getAttribute("data-answer") || "";
                            const rawTol =
                                submitBtn.getAttribute("data-tolerance");
                            isCorrect = answersMatch(
                                inputField.value,
                                rawCorrect,
                                rawTol,
                            );
                            errorEl = inputField;
                        }

                        // Record the first-submit outcome once, for the
                        // first-try score. Retries never change it.
                        if (box.getAttribute("data-attempted") !== "true") {
                            box.setAttribute("data-attempted", "true");
                            box.setAttribute(
                                "data-first-try",
                                String(isCorrect),
                            );
                        }
                        persistBox();

                        // Announce the result for host pages / telemetry. Fired
                        // on every check, regardless of correctness.
                        const detail = {
                            label: CFG.label || document.title,
                            quiz:
                                scenario.getAttribute("data-label") ||
                                String(
                                    [
                                        ...document.querySelectorAll(
                                            ".scenario-block",
                                        ),
                                    ].indexOf(scenario) + 1,
                                ),
                            question:
                                [
                                    ...scenario.querySelectorAll(".puzzle-box"),
                                ].indexOf(box) + 1,
                            correct: isCorrect,
                        };
                        document.dispatchEvent(
                            new CustomEvent("quiz:answer", { detail }),
                        );
                        if (CFG.telemetry && window.umami) {
                            try {
                                window.umami.track("quiz-answer", detail);
                            } catch (e) {}
                        }

                        if (isCorrect) {
                            // === SUCCESS ===
                            box.classList.add("solved");

                            if (kprimTable) {
                                kprimRows.forEach((row) => {
                                    const activeBtn = row.querySelector(
                                        row.dataset.chosen === "richtig"
                                            ? ".kprim-true"
                                            : ".kprim-false",
                                    );
                                    if (activeBtn)
                                        activeBtn.classList.add("correct");
                                    row.querySelectorAll("button").forEach(
                                        (b) => (b.disabled = true),
                                    );
                                });
                                // Grid fully solved → reveal every statement's
                                // note (leak-safe: only shown once all correct).
                                box.querySelectorAll(".kprim-note").forEach(
                                    (n) => (n.style.display = ""),
                                );
                            } else if (isMulti) {
                                selectedSet.forEach((o) => {
                                    o.classList.remove("selected");
                                    o.classList.add("correct");
                                });
                            } else if (selectedBtn) {
                                selectedBtn.classList.remove("selected");
                                selectedBtn.classList.add("correct");
                            } else if (inputField) {
                                inputField.classList.add("correct");
                                inputField.disabled = true;
                            }

                            feedback.classList.add("success");
                            feedback.innerText = S.correct;

                            // Hide submit button
                            submitBtn.style.display = "none";

                            // Lock options
                            if (options)
                                options.forEach((o) => (o.disabled = true));

                            // Reveal correct/always feedback + the option's note.
                            revealFeedback(true);
                            if (selectedBtn) showOptionNote(selectedBtn);

                            // Check if ALL boxes in this scenario are done
                            checkAllSolved();
                            persistBox();
                        } else {
                            // === FAILURE ===

                            if (errorEl) {
                                if (selectedBtn)
                                    selectedBtn.classList.remove("selected");
                                errorEl.classList.add("wrong");
                                errorEl.classList.add("shake");

                                // Remove shake after animation (0.5s)
                                setTimeout(() => {
                                    errorEl.classList.remove("shake");
                                }, 500);
                            }

                            // Reveal wrong/always feedback + the picked option's
                            // note (single-choice only — per-option notes on
                            // multi/K-Prim would leak which options are wrong).
                            revealFeedback(false);
                            if (selectedBtn) showOptionNote(selectedBtn);

                            if (
                                scenario.getAttribute("data-disable-on-check") ===
                                "true"
                            ) {
                                // Freeze the question: no countdown, no reset.
                                // Permanently disable every control and leave
                                // the wrong feedback in place.
                                if (options)
                                    options.forEach((o) => (o.disabled = true));
                                if (inputField) inputField.disabled = true;
                                if (kprimTable)
                                    kprimRows.forEach((row) =>
                                        row
                                            .querySelectorAll("button")
                                            .forEach((b) => (b.disabled = true)),
                                    );
                                submitBtn.disabled = true;
                                feedback.style.color =
                                    "var(--bs-danger, #db6b6b)";
                                feedback.innerText = S.wrong;
                                box.setAttribute("data-frozen", "true");
                                persistBox();
                            } else {
                                // Penalty Timer
                                startPenaltyTimer(
                                    lockoutFor(scenario),
                                    wrongMessage,
                                );
                            }
                        }
                    });
                }

                // --- HELPER: PER-OPTION NOTE (single-choice) ---
                // Reveals the picked option's explanation (rich HTML) in a shared
                // box below the options. Keyed by data-opt-index so it survives
                // option shuffling. Shown for both correct and wrong picks.
                function showOptionNote(picked) {
                    const idx = picked.getAttribute("data-opt-index");
                    if (idx == null) return;
                    const src = box.querySelector(
                        '.quiz-option-note[data-opt="' + idx + '"]',
                    );
                    if (!src) return;
                    let ex = box.querySelector(".quiz-option-explanation");
                    if (!ex) {
                        ex = document.createElement("div");
                        ex.className = "quiz-option-explanation";
                        if (optionsContainer && optionsContainer.parentNode) {
                            optionsContainer.insertAdjacentElement(
                                "afterend",
                                ex,
                            );
                        } else {
                            box.appendChild(ex);
                        }
                    }
                    ex.innerHTML = src.innerHTML;
                }

                // --- HELPER: OUTCOME FEEDBACK ---
                // Shows the .quiz-feedback-note blocks whose data-when matches the
                // outcome: "always" always, "correct"/"wrong" per result.
                function revealFeedback(correct) {
                    box.querySelectorAll(".quiz-feedback-note").forEach((n) => {
                        const when = n.getAttribute("data-when");
                        const show =
                            when === "always" ||
                            (correct && when === "correct") ||
                            (!correct && when === "wrong");
                        n.style.display = show ? "" : "none";
                    });
                }

                // --- HELPER: PENALTY TIMER ---
                function startPenaltyTimer(seconds, customMessage) {
                    // A zero (or negative) lockout disables the cooldown: reset
                    // immediately so the student can retry at once, but keep the
                    // wrong-answer feedback/explanation visible (there is no
                    // cooldown window in which to read it otherwise).
                    if (seconds <= 0) {
                        resetState(true);
                        return;
                    }

                    if (options) options.forEach((o) => (o.disabled = true));
                    if (inputField) inputField.disabled = true;
                    if (kprimTable)
                        kprimRows.forEach((row) =>
                            row
                                .querySelectorAll("button")
                                .forEach((b) => (b.disabled = true)),
                        );
                    submitBtn.disabled = true;

                    // A custom message (multi-response/K-Prim partial score)
                    // reveals progress without giving away which answers
                    // were right, styled as a "partial" warning rather than
                    // the plain red wrong text of the binary question types.
                    feedback.style.color = customMessage
                        ? "var(--bs-warning, #E65100)"
                        : "var(--bs-danger, #db6b6b)";
                    const prefix = customMessage
                        ? `${customMessage}. `
                        : S.wrong;

                    let timeLeft = seconds;
                    feedback.innerText = `${prefix}${fmt(S.cooldown, { n: timeLeft })}`;

                    const timer = setInterval(() => {
                        timeLeft--;
                        feedback.innerText = `${prefix}${fmt(S.cooldown, { n: timeLeft })}`;
                        if (timeLeft <= 0) {
                            clearInterval(timer);
                            resetState();
                        }
                    }, 1000);
                }

                // --- HELPER: RESET AFTER PENALTY ---
                // keepFeedback re-enables the controls but leaves the wrong-answer
                // feedback/explanation on screen. Used for an immediate retry
                // (lockout="0"), where wiping it synchronously would clear it
                // before the student ever sees it.
                function resetState(keepFeedback) {
                    if (!keepFeedback) {
                        feedback.innerText = "";

                        // Clear any revealed single-choice explanation.
                        const ex = box.querySelector(".quiz-option-explanation");
                        if (ex) ex.remove();

                        // Hide any outcome feedback shown on the failed attempt.
                        box.querySelectorAll(".quiz-feedback-note").forEach(
                            (n) => (n.style.display = "none"),
                        );
                    }

                    if (options)
                        options.forEach((o) => {
                            o.disabled = false;
                            o.classList.remove("wrong");
                        });

                    if (inputField) {
                        inputField.disabled = false;
                        inputField.classList.remove("wrong");
                    }

                    if (optionsContainer)
                        optionsContainer.classList.remove("wrong");

                    // Multi-response: force a fresh, complete re-selection
                    // rather than letting the student nudge the prior guess,
                    // since the wrong-count feedback alone isn't enough to
                    // safely narrow it down.
                    if (isMulti) {
                        selectedSet.clear();
                        options.forEach((o) => {
                            o.classList.remove("selected");
                            o.setAttribute("aria-pressed", "false");
                        });
                    }

                    // K-Prim: same rationale, clear all four rows.
                    if (kprimTable) {
                        kprimRows.forEach((row) => {
                            delete row.dataset.chosen;
                            row.querySelectorAll("button").forEach((b) => {
                                b.disabled = false;
                                b.classList.remove("selected");
                                b.setAttribute("aria-pressed", "false");
                            });
                        });
                        kprimTable.classList.remove("wrong");
                    }

                    // Re-arm the submit button. For a typed box, keep it usable
                    // when text still remains so the user can re-check without
                    // editing the input; for MC/multi/K-Prim, wait for a fresh
                    // selection. The Enter-key path checks submitBtn.disabled,
                    // so this keeps it consistent too.
                    if (inputField) {
                        submitBtn.disabled =
                            inputField.value.trim().length === 0;
                    } else {
                        submitBtn.disabled = true;
                    }
                    selectedBtn = null;
                }

                // --- HELPER: PERSISTENCE ---
                function persistBox() {
                    if (!persistOn) return;
                    try {
                        localStorage.setItem(
                            keyPrefix + boxHash,
                            JSON.stringify({
                                a: box.getAttribute("data-attempted") === "true",
                                f: box.getAttribute("data-first-try") === "true",
                                s: box.classList.contains("solved"),
                                d: box.getAttribute("data-frozen") === "true",
                            }),
                        );
                    } catch (e) {}
                }

                // Render a box in the solved state on restore. We don't know
                // which option was picked — only that it's done — so we mark
                // solved, freeze controls, and reveal outcome notes.
                function markSolvedFromRestore() {
                    box.classList.add("solved");
                    submitBtn.style.display = "none";
                    if (options) options.forEach((o) => (o.disabled = true));
                    if (inputField) inputField.disabled = true;
                    if (kprimTable) {
                        kprimRows.forEach((row) =>
                            row
                                .querySelectorAll("button")
                                .forEach((b) => (b.disabled = true)),
                        );
                        box.querySelectorAll(".kprim-note").forEach(
                            (n) => (n.style.display = ""),
                        );
                    }
                    feedback.classList.add("success");
                    feedback.innerText = S.correct;
                    revealFeedback(true);
                }

                // Render a box in the frozen (disable-on-check wrong) state on
                // restore: locked controls, disabled submit, wrong feedback.
                function markFrozenFromRestore() {
                    if (options) options.forEach((o) => (o.disabled = true));
                    if (inputField) inputField.disabled = true;
                    if (kprimTable)
                        kprimRows.forEach((row) =>
                            row
                                .querySelectorAll("button")
                                .forEach((b) => (b.disabled = true)),
                        );
                    submitBtn.disabled = true;
                    feedback.style.color = "var(--bs-danger, #db6b6b)";
                    feedback.innerText = S.wrong;
                    revealFeedback(false);
                }

                function restoreBox() {
                    if (!persistOn) return;
                    let stored;
                    try {
                        const rawv = localStorage.getItem(keyPrefix + boxHash);
                        if (!rawv) return;
                        stored = JSON.parse(rawv);
                    } catch (e) {
                        return;
                    }
                    if (!stored) return;
                    if (stored.a) {
                        box.setAttribute("data-attempted", "true");
                        box.setAttribute("data-first-try", String(!!stored.f));
                    }
                    if (stored.s) markSolvedFromRestore();
                    else if (stored.d) markFrozenFromRestore();
                }

                // Restore any saved state for this box on load.
                restoreBox();
            });

            // --- HELPER: GLOBAL CHECK ---
            function checkAllSolved() {
                updateProgress();
                const currentSolved =
                    scenario.querySelectorAll(".puzzle-box.solved").length;

                if (currentSolved === totalRequired) {
                    if (hiddenText) {
                        hiddenText.style.display = "block";
                        // Gentle fade in logic is handled by CSS animation 'fadeText'
                    }
                    showFirstTryScore();
                }
            }

            // Reflect any restored solves in the counter, reveal, and score.
            checkAllSolved();

            // "Start over": clear every stored key for this quiz (matched by
            // prefix, so it works regardless of hashing/shuffle) and reload.
            const resetBtn = scenario.querySelector(".quiz-reset");
            if (resetBtn) {
                resetBtn.addEventListener("click", function () {
                    if (persistOn) {
                        try {
                            for (let i = localStorage.length - 1; i >= 0; i--) {
                                const k = localStorage.key(i);
                                if (k && k.indexOf(keyPrefix) === 0)
                                    localStorage.removeItem(k);
                            }
                        } catch (e) {}
                    }
                    location.reload();
                });
            }
        });
    });
})();
