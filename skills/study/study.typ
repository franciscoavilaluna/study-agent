// study.typ — helpers for exercises and quizzes rendered inside Obsidian.
// Paste into the Typst plugin's "shared" preamble (or import it if your plugin allows).
#set page(width: 15cm, height: auto, margin: 0.5em)
#set text(size: 11pt)

#let accent = rgb("#4a6fa5")

// A numbered exercise card. level: 1 (easy) to 5 (hard), optional.
#let exercise(n, level: none, body) = block(
  width: 100%, inset: 10pt, radius: 4pt, stroke: 0.6pt + accent,
)[
  #text(weight: "bold", fill: accent)[Exercise #n]
  #if level != none [#h(1fr) #text(size: 0.8em, fill: gray)[level #level/5]]
  #v(2pt)
  #body
]

// A hint the learner can ignore.
#let hint(body) = block(inset: (left: 10pt))[
  #text(size: 0.9em, style: "italic", fill: gray)[Hint: #body]
]

// A multiple-choice question: question text, then the options.
#let mcq(n, question, ..options) = block(
  width: 100%, inset: 10pt, radius: 4pt, stroke: 0.6pt + accent,
)[
  #text(weight: "bold", fill: accent)[Question #n]
  #v(2pt)
  #question
  #v(2pt)
  #enum(numbering: "a)", ..options.pos())
]

// A "predict before you compute" prompt, to stop answer-guessing.
#let predict(body) = block(
  width: 100%, inset: 10pt, radius: 4pt, fill: rgb("#f3f0e6"),
)[
  #text(weight: "bold")[Predict first:] #body
]
