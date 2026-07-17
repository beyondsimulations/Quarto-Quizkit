-- quiz.lua — compiles ::: {.quiz} authoring into the quiz widget's HTML.
-- Supports single-choice, multi-select, numeric, and kprim questions plus
-- reveal/feedback/explanation blocks. Reads a `quiz:` metadata block for
-- language, string overrides, lockout, and optional telemetry, injecting a
-- window.quizkitConfig into the HTML head. In non-HTML output it strips every
-- answer and emits question stems only.

-- Bundled UI strings. `en` is the default; `de` ships for the German lectures.
-- A consumer overrides individual keys via `quiz.strings` in _quarto.yml.
local STRINGS = {
  en = {
    submit = "Check", correct = "Correct!", wrong = "Not quite. ",
    cooldown = "Try again in {n}s …",
    kprim_partial = "{c}/{t} statements rated correctly",
    multi_partial = "{h} of {t} correct answers selected",
    kprim_true = "true", kprim_false = "false", placeholder = "Your answer…",
  },
  de = {
    submit = "Check", correct = "Richtig!", wrong = "Leider falsch. ",
    cooldown = "Noch {n}s …",
    kprim_partial = "{c}/{t} Aussagen korrekt bewertet",
    multi_partial = "{h} von {t} richtigen Antworten gewählt",
    kprim_true = "richtig", kprim_false = "falsch", placeholder = "Deine Antwort…",
  },
  fr = {
    submit = "Vérifier", correct = "Correct !", wrong = "Pas tout à fait. ",
    cooldown = "Réessayez dans {n} s …",
    kprim_partial = "{c}/{t} affirmations évaluées correctement",
    multi_partial = "{h} sur {t} bonnes réponses sélectionnées",
    kprim_true = "vrai", kprim_false = "faux", placeholder = "Votre réponse…",
  },
  es = {
    submit = "Comprobar", correct = "¡Correcto!", wrong = "No exactamente. ",
    cooldown = "Inténtalo de nuevo en {n} s …",
    kprim_partial = "{c}/{t} afirmaciones evaluadas correctamente",
    multi_partial = "{h} de {t} respuestas correctas seleccionadas",
    kprim_true = "verdadero", kprim_false = "falso", placeholder = "Tu respuesta…",
  },
  it = {
    submit = "Verifica", correct = "Corretto!", wrong = "Non proprio. ",
    cooldown = "Riprova tra {n} s …",
    kprim_partial = "{c}/{t} affermazioni valutate correttamente",
    multi_partial = "{h} su {t} risposte corrette selezionate",
    kprim_true = "vero", kprim_false = "falso", placeholder = "La tua risposta…",
  },
  nl = {
    submit = "Controleren", correct = "Correct!", wrong = "Niet helemaal. ",
    cooldown = "Probeer opnieuw over {n} s …",
    kprim_partial = "{c}/{t} stellingen juist beoordeeld",
    multi_partial = "{h} van {t} juiste antwoorden geselecteerd",
    kprim_true = "waar", kprim_false = "onwaar", placeholder = "Jouw antwoord…",
  },
}

local CONFIG = { strings = STRINGS.en, lockout = 10, telemetry = nil, label = nil }

-- Render inlines to an HTML string (preserves math/emphasis/code).
-- pandoc.Plain avoids the <p> wrapper Para would add.
local function inlines_to_html(inlines)
  local doc = pandoc.Pandoc({ pandoc.Plain(inlines) })
  return pandoc.write(doc, "html"):gsub("%s+$", "")
end

-- Pandoc encodes task-list markers as the first Str of the item's first block:
--   "☒" (U+2612) = checked/correct, "☐" (U+2610) = unchecked/wrong.
-- Returns checked(boolean), label_inlines, extra_blocks; or nil if not a
-- task-list item. extra_blocks are any blocks after the first (an indented
-- markdown block under the item = that option's rich explanation).
local function task_item(blocks)
  local first = blocks[1]
  if not first or not first.content then return nil end
  local marker = first.content[1]
  if not marker or marker.t ~= "Str" then return nil end
  local checked
  if marker.text == "\u{2612}" then checked = true
  elseif marker.text == "\u{2610}" then checked = false
  else return nil end
  local rest = {}
  for i = 3, #first.content do rest[#rest + 1] = first.content[i] end  -- drop marker + Space
  local extra = {}
  for i = 2, #blocks do extra[#extra + 1] = blocks[i] end
  return checked, rest, extra
end

local function is_task_list(list)
  for _, item in ipairs(list.content) do
    if task_item(item) == nil then return false end
  end
  return #list.content > 0
end

-- Escape a string for safe use inside a double-quoted HTML attribute.
local function attr_escape(s)
  return (tostring(s):gsub("&", "&amp;"):gsub('"', "&quot;")
    :gsub("<", "&lt;"):gsub(">", "&gt;"))
end

-- Escape a string for safe use as raw-HTML element text.
local function text_escape(s)
  return (tostring(s):gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"))
end

-- Recursively drop answer-bearing content (task lists, .feedback, .reveal) at
-- any depth, keeping only stem prose. Used for non-HTML (corpus) output.
local function strip_blocks(blocks)
  local out = {}
  for _, b in ipairs(blocks) do
    if b.t == "BulletList" and is_task_list(b) then
      -- drop task-list options
    elseif b.t == "Div" and (b.classes:includes("feedback")
        or b.classes:includes("reveal")) then
      -- drop feedback/reveal blocks
    elseif b.t == "Div" then
      out[#out + 1] = pandoc.Div(strip_blocks(b.content), b.attr)
    else
      out[#out + 1] = b
    end
  end
  return out
end

local function json_escape(s)
  s = tostring(s):gsub("[\\\"]", "\\%0")
  s = s:gsub("\n", "\\n"):gsub("\r", "\\r"):gsub("\t", "\\t")
  s = s:gsub("</", "<\\/")  -- prevent </script> breaking out of the tag
  return s
end

local function inject_config()
  local parts = { string.format('"lockout":%d', math.floor(tonumber(CONFIG.lockout) or 10)) }
  local kv = {}
  for k, v in pairs(CONFIG.strings) do
    kv[#kv + 1] = string.format('"%s":"%s"', k, json_escape(v))
  end
  parts[#parts + 1] = '"strings":{' .. table.concat(kv, ",") .. '}'
  if CONFIG.label then
    parts[#parts + 1] = string.format('"label":"%s"', json_escape(CONFIG.label))
  end
  local t = CONFIG.telemetry
  if t and t.website then
    parts[#parts + 1] = string.format('"telemetry":{"website":"%s"}', json_escape(t.website))
  end
  quarto.doc.include_text("in-header",
    "<script>window.quizkitConfig={" .. table.concat(parts, ",") .. "};</script>")
  if t and t.src and t.website then
    quarto.doc.include_text("in-header", string.format(
      '<script defer src="%s" data-website-id="%s"></script>',
      attr_escape(t.src), attr_escape(t.website)))
  end
end

local deps_added = false
local function ensure_deps()
  if deps_added then return end
  deps_added = true
  quarto.doc.add_html_dependency({
    name = "quizkit",
    version = "1.0.0",
    scripts = { "quiz.js" },
    stylesheets = { "quiz.css" },
  })
  inject_config()
end

local function raw(html) return pandoc.RawBlock("html", html) end

-- If the option's inlines end in a Span carrying an `explanation` attribute,
-- pull the explanation text out and UNWRAP the span so its visible label
-- survives in the button. Returns the explanation string or nil.
local function extract_explanation(inlines)
  local last = inlines[#inlines]
  if last and last.t == "Span" and last.attributes["explanation"] then
    local exp = last.attributes["explanation"]
    inlines[#inlines] = nil
    for _, il in ipairs(last.content) do inlines[#inlines + 1] = il end
    return exp
  end
  return nil
end

local function build_choice(list, submit_label)
  local correct = 0
  local opts = {}
  local notes = {}
  for i, item in ipairs(list.content) do
    local checked, rest, extra = task_item(item)
    if checked then correct = correct + 1 end
    -- Rich explanation: an indented markdown block under the option. Falls back
    -- to the short {explanation="…"} attribute form on the label inlines.
    local exp = extract_explanation(rest)
    local note_html = nil
    if extra and #extra > 0 then
      note_html = pandoc.write(pandoc.Pandoc(extra), "html")
    elseif exp then
      note_html = "<p>" .. text_escape(exp) .. "</p>"
    end
    -- data-opt-index keys the note to its option so it survives shuffling.
    if note_html then
      notes[#notes + 1] = string.format(
        '<div class="quiz-option-note" data-opt="%d">%s</div>', i - 1, note_html)
    end
    opts[#opts + 1] = string.format(
      '<button class="quiz-option" data-correct="%s" data-opt-index="%d">%s</button>',
      tostring(checked), i - 1, inlines_to_html(rest))
  end
  local multi = correct >= 2 and " quiz-multi" or ""
  local html = string.format('<div class="quiz-options%s">\n%s\n</div>', multi,
    table.concat(opts, "\n"))
  -- Per-option notes only for single-choice; on multi they'd leak which options
  -- are correct, so omit them there.
  if correct < 2 and #notes > 0 then
    html = html .. string.format('\n<div class="quiz-option-notes" hidden>\n%s\n</div>',
      table.concat(notes, "\n"))
  end
  html = html .. string.format(
    '\n<div class="quiz-actions"><p class="quiz-feedback"></p>' ..
    '<button class="quiz-submit" disabled>%s</button></div>', text_escape(submit_label))
  return raw(html)
end

local function build_input(answer, tolerance, submit_label, placeholder)
  local tol = tolerance and string.format(' data-tolerance="%s"', attr_escape(tolerance)) or ""
  return raw(string.format(
    '<input class="quiz-input" type="text" placeholder="%s">\n' ..
    '<div class="quiz-actions"><p class="quiz-feedback"></p>' ..
    '<button class="quiz-submit" data-answer="%s"%s disabled>%s</button></div>',
    attr_escape(placeholder), attr_escape(answer), tol, text_escape(submit_label)))
end

local function build_kprim(list, submit_label, t_true, t_false)
  local rows = {}
  for _, item in ipairs(list.content) do
    local checked, rest = task_item(item)
    local key = checked and "richtig" or "falsch"
    rows[#rows + 1] = string.format(
      '<div class="kprim-row" data-kprim="%s">' ..
      '<span class="kprim-statement">%s</span>' ..
      '<div class="kprim-buttons">' ..
      '<button class="kprim-true">%s</button>' ..
      '<button class="kprim-false">%s</button></div></div>',
      key, inlines_to_html(rest), text_escape(t_true), text_escape(t_false))
  end
  return raw(string.format(
    '<div class="kprim-table">\n%s\n</div>\n' ..
    '<div class="quiz-actions"><p class="quiz-feedback"></p>' ..
    '<button class="quiz-submit" disabled>%s</button></div>',
    table.concat(rows, "\n"), text_escape(submit_label)))
end

local function compile_question(qdiv, cfg)
  local is_kprim = qdiv.classes:includes("kprim")
  local answer = qdiv.attributes["answer"]
  local tolerance = qdiv.attributes["tolerance"]
  local submit_label = qdiv.attributes["submit"] or cfg.strings.submit
  local stem, list = {}, nil
  local feedbacks = {}  -- { {when=..., content=...}, … } in author order
  for _, blk in ipairs(qdiv.content) do
    if blk.t == "BulletList" and is_task_list(blk) then
      list = blk
    elseif blk.t == "Div" and blk.classes:includes("feedback") then
      local when = "always"
      if blk.classes:includes("correct") then when = "correct"
      elseif blk.classes:includes("wrong") then when = "wrong" end
      feedbacks[#feedbacks + 1] = { when = when, content = blk.content }
    else
      stem[#stem + 1] = blk
    end
  end
  local inner = {}
  for _, b in ipairs(stem) do inner[#inner + 1] = b end
  if is_kprim and list then
    inner[#inner + 1] = build_kprim(list, submit_label,
      cfg.strings.kprim_true, cfg.strings.kprim_false)
  elseif answer ~= nil then
    inner[#inner + 1] = build_input(answer, tolerance, submit_label,
      cfg.strings.placeholder)
  elseif list then
    inner[#inner + 1] = build_choice(list, submit_label)
  end
  -- Feedback notes: shown after answering. data-when is "always" (any outcome),
  -- "correct", or "wrong" (from a .correct/.wrong class on the .feedback div).
  for _, fb in ipairs(feedbacks) do
    inner[#inner + 1] = raw(string.format(
      '<div class="quiz-feedback-note" data-when="%s" style="display:none">%s</div>',
      fb.when, pandoc.write(pandoc.Pandoc(fb.content), "html")))
  end
  return pandoc.Div(inner, pandoc.Attr("", { "puzzle-box" }))
end

function Meta(meta)
  local q = meta.quiz
  if not q then return nil end
  local lang = q.lang and pandoc.utils.stringify(q.lang) or "en"
  local base = STRINGS[lang] or STRINGS.en
  local strings = {}
  for k, v in pairs(base) do strings[k] = v end
  if q.strings then
    for k, v in pairs(q.strings) do strings[k] = pandoc.utils.stringify(v) end
  end
  CONFIG.strings = strings
  if q.lockout then
    local n = tonumber(pandoc.utils.stringify(q.lockout)); if n then CONFIG.lockout = n end
  end
  if q.label then CONFIG.label = pandoc.utils.stringify(q.label) end
  if q.telemetry then
    CONFIG.telemetry = {
      src = q.telemetry["umami-src"] and pandoc.utils.stringify(q.telemetry["umami-src"]),
      website = q.telemetry["umami-website-id"] and pandoc.utils.stringify(q.telemetry["umami-website-id"]),
    }
    if q.telemetry.label then CONFIG.label = pandoc.utils.stringify(q.telemetry.label) end
  end
  return nil
end

function Div(el)
  if not el.classes:includes("quiz") then return nil end

  -- Non-HTML (e.g. hugo-md corpus): emit question stems ONLY, never answers.
  if not quarto.doc.is_format("html") then
    local stems = {}
    for _, blk in ipairs(el.content) do
      if blk.t == "Div" and blk.classes:includes("question") then
        for _, b in ipairs(strip_blocks(blk.content)) do stems[#stems + 1] = b end
      end
      -- intentionally drop .reveal and any answer-bearing content
    end
    return pandoc.Div(stems)
  end

  ensure_deps()
  local cfg = CONFIG
  local out = {}
  local reveal_html = nil
  for _, blk in ipairs(el.content) do
    if blk.t == "Div" and blk.classes:includes("question") then
      out[#out + 1] = compile_question(blk, cfg)
    elseif blk.t == "Div" and blk.classes:includes("reveal") then
      reveal_html = pandoc.write(pandoc.Pandoc(blk.content), "html")
    else
      out[#out + 1] = blk
    end
  end
  if reveal_html then
    out[#out + 1] = raw('<div class="revealed-text" style="display:none">' .. reveal_html .. '</div>')
  end
  local attrs = {}
  local function put(k) if el.attributes[k] then attrs["data-" .. k] = el.attributes[k] end end
  put("label"); put("lockout"); put("shuffle"); put("disable-on-check")
  return pandoc.Div(out, pandoc.Attr("", { "scenario-block" }, attrs))
end

-- Meta first (populate CONFIG), then Div (compile using CONFIG).
return { { Meta = Meta }, { Div = Div } }
