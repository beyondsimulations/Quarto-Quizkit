-- quiz.lua — compiles ::: {.quiz} authoring into the quiz widget's HTML.
-- Task 1: single-choice and multi-select questions only.

-- Render inlines to an HTML string (preserves math/emphasis/code).
-- pandoc.Plain avoids the <p> wrapper Para would add.
local function inlines_to_html(inlines)
  local doc = pandoc.Pandoc({ pandoc.Plain(inlines) })
  return pandoc.write(doc, "html"):gsub("%s+$", "")
end

-- Pandoc encodes task-list markers as the first Str of the item's first block:
--   "☒" (U+2612) = checked/correct, "☐" (U+2610) = unchecked/wrong.
-- Returns checked(boolean), remaining_inlines; or nil if not a task-list item.
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
  return checked, rest
end

local function is_task_list(list)
  for _, item in ipairs(list.content) do
    if task_item(item) == nil then return false end
  end
  return #list.content > 0
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
end

local function raw(html) return pandoc.RawBlock("html", html) end

local function build_choice(list, submit_label)
  local correct = 0
  local opts = {}
  for _, item in ipairs(list.content) do
    local checked, rest = task_item(item)
    if checked then correct = correct + 1 end
    opts[#opts + 1] = string.format(
      '<button class="quiz-option" data-correct="%s">%s</button>',
      tostring(checked), inlines_to_html(rest))
  end
  local multi = correct >= 2 and " quiz-multi" or ""
  local html = string.format('<div class="quiz-options%s">\n%s\n</div>', multi,
    table.concat(opts, "\n"))
  html = html .. string.format(
    '\n<div class="quiz-actions"><p class="quiz-feedback"></p>' ..
    '<button class="quiz-submit" disabled>%s</button></div>', submit_label)
  return raw(html)
end

local function build_input(answer, tolerance, submit_label, placeholder)
  local tol = tolerance and string.format(' data-tolerance="%s"', tolerance) or ""
  return raw(string.format(
    '<input class="quiz-input" type="text" placeholder="%s">\n' ..
    '<div class="quiz-actions"><p class="quiz-feedback"></p>' ..
    '<button class="quiz-submit" data-answer="%s"%s disabled>%s</button></div>',
    placeholder, answer, tol, submit_label))
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
      key, inlines_to_html(rest), t_true, t_false)
  end
  return raw(string.format(
    '<div class="kprim-table">\n%s\n</div>\n' ..
    '<div class="quiz-actions"><p class="quiz-feedback"></p>' ..
    '<button class="quiz-submit" disabled>%s</button></div>',
    table.concat(rows, "\n"), submit_label))
end

local function compile_question(qdiv, cfg)
  local is_kprim = qdiv.classes:includes("kprim")
  local answer = qdiv.attributes["answer"]
  local tolerance = qdiv.attributes["tolerance"]
  local stem, list = {}, nil
  for _, blk in ipairs(qdiv.content) do
    if blk.t == "BulletList" and is_task_list(blk) then list = blk
    else stem[#stem + 1] = blk end
  end
  local inner = {}
  for _, b in ipairs(stem) do inner[#inner + 1] = b end
  if is_kprim and list then
    inner[#inner + 1] = build_kprim(list, cfg.strings.submit,
      cfg.strings.kprim_true, cfg.strings.kprim_false)
  elseif answer ~= nil then
    inner[#inner + 1] = build_input(answer, tolerance, cfg.strings.submit,
      cfg.strings.placeholder)
  elseif list then
    inner[#inner + 1] = build_choice(list, cfg.strings.submit)
  end
  return pandoc.Div(inner, pandoc.Attr("", { "puzzle-box" }))
end

function Div(el)
  if not el.classes:includes("quiz") then return nil end
  if not quarto.doc.is_format("html") then return nil end  -- stripping added in a later task
  ensure_deps()
  local cfg = { strings = {
    submit = "Check", kprim_true = "true", kprim_false = "false",
    placeholder = "Your answer…",
  } }
  local out = {}
  for _, blk in ipairs(el.content) do
    if blk.t == "Div" and blk.classes:includes("question") then
      out[#out + 1] = compile_question(blk, cfg)
    else
      out[#out + 1] = blk
    end
  end
  return pandoc.Div(out, pandoc.Attr("", { "scenario-block" }))
end
