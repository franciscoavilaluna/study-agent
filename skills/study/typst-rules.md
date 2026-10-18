# Typst rules for exercises and math

Typst only. Never LaTeX. All snippets below were compiled and checked.

## Where Typst appears

- Inline math: `$ ... $` with no space after the opening `$`, e.g. `$x^2$`.
- Display math: `$$ ... $$` on its own lines in Obsidian.
- Exercise blocks: a fenced code block with the language `typst`.

## Helpers (defined by the preamble `study.typ`)

```typst
#exercise(1, level: 2)[
  Compute $integral_0^pi sin(x) dif x$ and explain why the result is positive.
  #hint[Sketch the curve first.]
]

#mcq(2, [What is $lim_(x -> 0) (sin x)/x$?], [$0$], [$1$], [$infinity$], [It does not exist])

#predict[If you double the frequency, does the period double or halve?]
```

- `#exercise(n, level: 1..5)[body]` a numbered card. `level` is optional.
- `#hint[...]` a hint inside an exercise.
- `#mcq(n, [question], [opt], [opt], ...)` a multiple-choice card.
- `#predict[...]` a "predict before you compute" prompt.

Do not redefine these inside a block. If `#exercise` is "unknown variable", the preamble is not installed (see Setup).

## LaTeX to Typst

| Meaning | Typst |
|---|---|
| fraction | `a/b`, `(a+b)/(c+d)` |
| square root, cube root | `sqrt(x)`, `root(3, x)` |
| powers, subscripts | `x^2`, `x_i`, `x_(i+1)`, `e^(-j omega t)` |
| sum, product | `sum_(i=1)^n i`, `product_(k=1)^n k` |
| integral | `integral_a^b f(x) dif x`, `integral.double` |
| limit | `lim_(x -> 0) f(x)` |
| Greek | `alpha beta gamma pi theta omega Omega Delta` (no backslash) |
| infinity, partial, nabla | `infinity`, `partial`, `nabla` |
| relations | `<= >= != approx equiv => <=>` |
| sets and logic | `in`, `forall`, `exists`, `inter`, `union` |
| operators | `times`, `dot.c`, `plus.minus` |
| vector, matrix | `vec(1, 2)`, `mat(1, 2; 3, 4)` |
| cases | `cases(1 "if" x > 0, 0 "otherwise")` |
| accents | `hat(x)`, `overline(x)`, `arrow(v)`, `dot(x)` |
| fonts | `bold(A)`, `bb(R)`, `cal(F)` |
| absolute value, norm | `abs(x)`, `norm(v)` |
| derivative | `f'(x)` |
| text in math | `"Var"(X)`, `"if"` (use quotes) |
| probability | `P(A | B) = P(A inter B)/P(B)` |

## Pitfalls

- **Letters stuck together are one name.** `xy` is an unknown variable. Write `x y`. A digit followed by a letter (`2x`) is fine.
- **Words need quotes.** `"if"`, `"otherwise"`, `"Var"`. Without quotes they are read as variables.
- **Group with parentheses.** `e^(-j omega t)`, not `e^-j omega t`.
- **A semicolon ends a matrix row.** `mat(1, 2; 3, 4)`.
- **The differential is `dif`.** Write `integral f(x) dif x`.
- **Intersection is `inter`**, not `sect`.
- Every ` ```typst ` block compiles on its own. It can only use what the preamble defines.

## Setup in Obsidian (one time)

1. Settings, Community plugins, install **Typst Renderer** (or **Typst Mate**, which also replaces MathJax).
2. In the plugin settings, paste the contents of `study.typ` into the **shared** preamble.
3. Turn on the math block override (Typst Renderer: "Override Math Blocks") so `$...$` is read as Typst.
4. Restart Obsidian and test with the example above.

Note: a rendered Typst block is an image. It cannot take input. Type your answers as plain text (or `$...$` Typst math) in the **My answer** area below it.
