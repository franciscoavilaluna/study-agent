/**
 * Unit tests for the web tools. Run with:
 *
 *   node --test tests/            (or: npm test)
 *
 * Only `web-tools-core.ts` is imported: it has no dependencies, so these run
 * with nothing installed. Network is injected as a fake `fetch`, which makes
 * the DuckDuckGo fallback chain testable without touching the internet.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	clipText,
	decodeEntities,
	extractTitle,
	fetchPage,
	formatHits,
	htmlToText,
	isPrivateHost,
	normalizeQuery,
	normalizeUrl,
	parseDdgHtml,
	parseDdgLite,
	parseHttpUrl,
	resolveDdgHref,
	searchWeb,
} from "../extensions/web-tools-core.ts";

const DDG_HTML = `
<div class="result results_links results_links_deep web-result">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Ftypst.app%2Fdocs%2Fchangelog%2F&amp;rut=abc">Changelog - Typst Documentation</a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Ftypst.app%2Fdocs%2Fchangelog%2F">Learn what has <b>changed</b> in the latest Typst releases.</a>
  </div>
</div>
<div class="result result--ad">
  <h2 class="result__title">
    <a class="result__a" href="//duckduckgo.com/y.js?ad_domain=ads.example&amp;u3=x">Buy something now</a>
  </h2>
</div>
<div class="result results_links web-result">
  <h2 class="result__title">
    <a href="https://github.com/typst/typst/releases/" class="result__a">Releases &middot; typst/typst</a>
  </h2>
</div>
`;

const DDG_LITE = `
<table>
  <tr><td><a rel="nofollow" class="result-link" href="https://example.com/a">Example A</a></td></tr>
  <tr><td class="result-snippet">Snippet for <b>A</b>.</td></tr>
  <tr><td><a rel="nofollow" class="result-link" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fb">Example B</a></td></tr>
  <tr><td class="result-snippet">Snippet for B.</td></tr>
</table>
`;

function fakeResponse(
	body: string | Uint8Array,
	init: { url?: string; status?: number; contentType?: string } = {},
): Response {
	const response = new Response(body as BodyInit, {
		status: init.status ?? 200,
		headers: init.contentType ? { "content-type": init.contentType } : undefined,
	});
	// `url` is a read-only getter on Response, so emulate the shape fetchPage uses.
	return {
		url: init.url ?? "",
		status: init.status ?? 200,
		headers: response.headers,
		body: response.body,
	} as unknown as Response;
}

function fakeFetch(responses: Array<Response | (() => never)>): typeof fetch {
	let index = 0;
	return (async () => {
		const next = responses[Math.min(index++, responses.length - 1)];
		if (typeof next === "function") next();
		// Each call needs its own unconsumed body.
		const clone = (next as Response).clone;
		return (typeof clone === "function" ? clone.call(next) : next) as Response;
	}) as unknown as typeof fetch;
}

describe("decodeEntities", () => {
	it("decodes named, decimal and hex entities", () => {
		assert.equal(decodeEntities("a &amp; b &lt;c&gt; &#65; &#x42; &mdash;"), "a & b <c> A B —");
	});

	it("decodes accented Spanish entities", () => {
		assert.equal(decodeEntities("a&ntilde;o, se&ntilde;al, &iquest;qu&eacute;?"), "año, señal, ¿qué?");
	});

	it("leaves unknown entities untouched", () => {
		assert.equal(decodeEntities("&notarealentity; y &amp;"), "&notarealentity; y &");
	});

	it("ignores out-of-range code points instead of throwing", () => {
		assert.equal(decodeEntities("x&#999999999;y"), "xy");
	});
});

describe("htmlToText", () => {
	it("does not turn empty list items into bare dashes", () => {
		const html = `<ul><li></li><li>  </li><li>real item</li></ul>`;
		const text = htmlToText(html);
		assert.equal(text, "- real item");
		assert.ok(!/^-\s*$/m.test(text), "no line may be a lone dash");
	});

	it("drops navigation, footer, aside, form and script noise", () => {
		const html = `
			<html><head><title>T</title><style>.x{color:red}</style></head>
			<body>
				<nav><a href="/a">Home</a><a href="/b">Pricing</a></nav>
				<main><p>The actual answer is 42.</p></main>
				<aside><p>Related junk</p></aside>
				<footer><p>Made in Berlin</p></footer>
				<form><input value="search"></form>
				<script>var leak = "nope";</script>
			</body></html>`;
		const text = htmlToText(html);
		assert.equal(text, "The actual answer is 42.");
	});

	it("prefers the article/main region when it has real content", () => {
		const filler = `<div>${"chrome ".repeat(200)}</div>`;
		const article = `Only this matters. ${"And this sentence is the content. ".repeat(20)}`;
		const html = `<body>${filler}<article><p>${article}</p></article></body>`;
		const text = htmlToText(html);
		assert.ok(text.startsWith("Only this matters."), "article body comes first");
		assert.ok(!text.includes("chrome"), "the div wrapper is dropped with it");
	});

	it("keeps the whole document when the main region is a stub", () => {
		const html = `<body><nav>menu menu menu</nav><main>ok</main><p>${"body text ".repeat(50)}</p></body>`;
		const text = htmlToText(html);
		assert.ok(text.includes("ok"), "stub main is not enough, whole body is used");
		assert.ok(text.includes("body text"));
	});

	it("separates table cells and rows", () => {
		const html = `<table><tr><th>Year</th><th>Event</th></tr><tr><td>2025</td><td>Release</td></tr></table>`;
		const text = htmlToText(html);
		assert.match(text, /Year\s+Event/);
		assert.match(text, /2025\s+Release/);
	});

	it("fixes a space inserted before punctuation by a tag boundary", () => {
		assert.equal(htmlToText("<p>Hello <b>world</b> .</p>"), "Hello world.");
	});

	it("removes zero-width characters and NBSP", () => {
		assert.equal(htmlToText("<p>a\u200bb&nbsp;c\ufeff</p>"), "ab c");
	});

	it("keeps list structure for real items", () => {
		assert.equal(htmlToText("<ul><li>one</li><li>two</li></ul>"), "- one\n- two");
	});
});

describe("extractTitle", () => {
	it("returns a clean title", () => {
		assert.equal(extractTitle("<title>  Announcing  TypeScript 5.9 &mdash; devblogs </title>"), "Announcing TypeScript 5.9 — devblogs");
	});

	it("returns undefined without a title", () => {
		assert.equal(extractTitle("<p>no title here</p>"), undefined);
	});
});

describe("clipText", () => {
	it("passes short text through", () => {
		assert.deepEqual(clipText("abc", 10), { text: "abc", truncated: false });
	});

	it("truncates with a visible trailer", () => {
		const result = clipText("x".repeat(50), 10);
		assert.ok(result.truncated);
		assert.ok(result.text.startsWith("xxxxxxxxxx"));
		assert.match(result.text, /truncated: showing 10 of 50 characters/);
	});
});

describe("isPrivateHost", () => {
	const blocked = [
		"localhost",
		"api.localhost",
		"printer.local",
		"127.0.0.1",
		"127.1.2.3",
		"0.0.0.0",
		"10.1.2.3",
		"172.16.0.1",
		"172.31.255.255",
		"192.168.1.1",
		"169.254.169.254",
		"100.64.0.1",
		"::1",
		"fd00::1",
		"fe80::1",
	];
	const allowed = ["8.8.8.8", "172.32.0.1", "1.1.1.1", "example.com", "2606:4700::1111"];

	it("refuses loopback, private and CGNAT ranges", () => {
		for (const host of blocked) assert.equal(isPrivateHost(host), true, host);
	});

	it("allows public hosts", () => {
		for (const host of allowed) assert.equal(isPrivateHost(host), false, host);
	});
});

describe("parseHttpUrl", () => {
	it("adds https to a bare host", () => {
		assert.equal(parseHttpUrl("example.com/x").toString(), "https://example.com/x");
	});

	it("refuses non-http schemes", () => {
		assert.throws(() => parseHttpUrl("ftp://example.com"), /unsupported scheme/);
		assert.throws(() => parseHttpUrl("file:///etc/passwd"), /unsupported scheme/);
	});

	it("refuses private targets", () => {
		assert.throws(() => parseHttpUrl("http://127.0.0.1:8080/admin"), /refusing to fetch local or private address/);
	});

	it("refuses empty and malformed input", () => {
		assert.throws(() => parseHttpUrl("   "), /empty URL/);
		assert.throws(() => parseHttpUrl("http://"), /not a valid URL/);
	});
});

describe("resolveDdgHref", () => {
	it("decodes the uddg redirect", () => {
		assert.equal(resolveDdgHref("//duckduckgo.com/l/?uddg=https%3A%2F%2Ftypst.app%2F&rut=x"), "https://typst.app/");
	});

	it("drops ad redirects that stay on duckduckgo.com", () => {
		assert.equal(resolveDdgHref("//duckduckgo.com/y.js?ad_domain=ads.example&u3=x"), undefined);
	});

	it("keeps direct https links", () => {
		assert.equal(resolveDdgHref("https://github.com/typst/typst"), "https://github.com/typst/typst");
	});
});

describe("normalizeUrl", () => {
	it("strips fragments and tracking parameters", () => {
		assert.equal(
			normalizeUrl("https://example.com/a/?utm_source=x&utm_medium=y&fbclid=z#top"),
			"https://example.com/a",
		);
	});

	it("keeps meaningful query parameters", () => {
		assert.equal(normalizeUrl("https://example.com/search?q=typst"), "https://example.com/search?q=typst");
	});
});

describe("parseDdgHtml", () => {
	const hits = parseDdgHtml(DDG_HTML);

	it("extracts real results and drops ads", () => {
		assert.deepEqual(
			hits.map((hit) => hit.url),
			["https://typst.app/docs/changelog/", "https://github.com/typst/typst/releases/"],
		);
	});

	it("keeps titles clean and decoded", () => {
		assert.equal(hits[0].title, "Changelog - Typst Documentation");
		assert.equal(hits[1].title, "Releases · typst/typst");
	});

	it("attaches the snippet to its own result", () => {
		assert.equal(hits[0].snippet, "Learn what has changed in the latest Typst releases.");
		assert.equal(hits[1].snippet, undefined);
	});

	it("does not depend on attribute order", () => {
		const reordered = `<a href="https://example.com/z" class="result__a">Z</a>`;
		assert.equal(parseDdgHtml(reordered)[0].url, "https://example.com/z");
	});

	it("finds nothing in a blocked page", () => {
		assert.deepEqual(parseDdgHtml("<html><body>anomaly-modal</body></html>"), []);
	});
});

describe("parseDdgLite", () => {
	const hits = parseDdgLite(DDG_LITE);

	it("extracts links and their snippets", () => {
		assert.deepEqual(
			hits.map((hit) => [hit.url, hit.snippet]),
			[
				["https://example.com/a", "Snippet for A."],
				["https://example.com/b", "Snippet for B."],
			],
		);
	});

	it("falls back to bare external links", () => {
		const hits = parseDdgLite(`<a href="https://example.com/q">A bare link</a>`);
		assert.equal(hits[0].url, "https://example.com/q");
		assert.equal(hits[0].title, "A bare link");
	});
});

describe("formatHits", () => {
	it("numbers results with URL and snippet", () => {
		const text = formatHits([{ title: "T", url: "https://e.com", snippet: "S" }], "q");
		assert.equal(text, '1 result(s) for "q":\n\n1. T\n   https://e.com\n   S');
	});

	it("says so when there is nothing", () => {
		assert.equal(formatHits([], "q"), 'No results for "q".');
	});
});

describe("normalizeQuery", () => {
	it("collapses whitespace and caps length", () => {
		assert.equal(normalizeQuery("  a   b \n c "), "a b c");
		assert.equal(normalizeQuery("x".repeat(500)).length, 400);
	});
});

describe("searchWeb", () => {
	const attempts = [
		{ label: "first", url: "https://search.test/one?q=q", method: "GET" as const, parse: parseDdgHtml },
		{ label: "second", url: "https://search.test/two?q=q", method: "GET" as const, parse: parseDdgLite },
	];

	it("returns parsed hits from the first working endpoint", async () => {
		const hits = await searchWeb("q", 5, {
			attempts,
			fetchImpl: fakeFetch([new Response(DDG_HTML, { headers: { "content-type": "text/html" } })]),
		});
		assert.equal(hits.length, 2);
		assert.equal(hits[0].url, "https://typst.app/docs/changelog/");
	});

	it("falls through to the next endpoint when the first is rate limited", async () => {
		const hits = await searchWeb("q", 5, {
			attempts,
			fetchImpl: fakeFetch([
				new Response("slow down", { status: 202 }),
				new Response(DDG_LITE, { headers: { "content-type": "text/html" } }),
			]),
		});
		assert.equal(hits.length, 2);
		assert.equal(hits[0].url, "https://example.com/a");
	});

	it("treats an anti-bot page served as 200 as a failure", async () => {
		const hits = await searchWeb("q", 5, {
			attempts,
			fetchImpl: fakeFetch([
				new Response("<div class='anomaly-modal'>challenge</div>", { headers: { "content-type": "text/html" } }),
				new Response(DDG_LITE, { headers: { "content-type": "text/html" } }),
			]),
		});
		assert.equal(hits.length, 2);
	});

	it("reports every endpoint it tried when all fail", async () => {
		await assert.rejects(
			searchWeb("q", 5, {
				attempts,
				fetchImpl: fakeFetch([new Response("no", { status: 403 })]),
			}),
			(error: Error) => {
				assert.match(error.message, /search failed/i);
				assert.match(error.message, /first: HTTP 403/);
				assert.match(error.message, /second: HTTP 403/);
				return true;
			},
		);
	});

	it("refuses an empty query", async () => {
		await assert.rejects(searchWeb("   ", 5, { attempts }), /empty query/);
	});

	it("deduplicates results that differ only in tracking parameters", async () => {
		const html = `
			<a class="result__a" href="https://example.com/a">A</a>
			<a class="result__a" href="https://example.com/a?utm_source=x">A again</a>`;
		const hits = await searchWeb("q", 5, {
			attempts: [attempts[0]],
			fetchImpl: fakeFetch([new Response(html, { headers: { "content-type": "text/html" } })]),
		});
		assert.equal(hits.length, 1);
	});
});

describe("fetchPage", () => {
	it("decodes a latin-1 page declared only in its meta tag", async () => {
		const body = new Uint8Array(Buffer.from(`<html><head><meta charset="iso-8859-1"><title>t</title></head><body><p>a\xf1o</p></body></html>`, "latin1"));
		const page = await fetchPage(new URL("https://example.com/"), {
			fetchImpl: fakeFetch([fakeResponse(body, { contentType: "text/html" })]),
		});
		assert.match(page.body, /año/);
	});

	it("honours a charset in the content-type header", async () => {
		const body = new Uint8Array(Buffer.from("<p>caf\xe9</p>", "latin1"));
		const page = await fetchPage(new URL("https://example.com/"), {
			fetchImpl: fakeFetch([fakeResponse(body, { contentType: "text/html; charset=iso-8859-1" })]),
		});
		assert.match(page.body, /café/);
	});

	it("follows the redirect and reports the final URL", async () => {
		const response = fakeResponse("<p>ok</p>", { contentType: "text/html", url: "https://example.com/final" });
		const page = await fetchPage(new URL("http://example.com/"), { fetchImpl: fakeFetch([response]) });
		assert.equal(page.url, "https://example.com/final");
	});

	it("retries once on a network error, then succeeds", async () => {
		let calls = 0;
		const impl = (async () => {
			calls++;
			if (calls === 1) throw new Error("ECONNRESET");
			return fakeResponse("<p>ok</p>", { contentType: "text/html" });
		}) as unknown as typeof fetch;
		const page = await fetchPage(new URL("https://example.com/"), { fetchImpl: impl });
		assert.equal(calls, 2);
		assert.match(page.body, /ok/);
	});

	it("describes DNS failures in plain language", async () => {
		const impl = (async () => {
			throw new Error("getaddrinfo ENOTFOUND nope.example");
		}) as unknown as typeof fetch;
		await assert.rejects(fetchPage(new URL("https://nope.example/"), { fetchImpl: impl, retries: 0 }), /DNS lookup failed for nope\.example/);
	});
});
