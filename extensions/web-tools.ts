/**
 * web-tools
 *
 * Two model-callable tools that give the `researcher` subagent (and any normal
 * session) real web access without API keys, MCP servers or extra npm deps:
 *
 *   • web_search — DuckDuckGo's HTML endpoint, parsed into title / URL / snippet.
 *   • web_fetch  — downloads one URL and reduces it to readable text.
 *
 * Design notes:
 *   - Zero dependencies: Node's built-in `fetch` does the network work, so the
 *     tools work on a fresh machine with nothing installed but pi.
 *   - Keyless on purpose. A search API key would make the package unusable for
 *     anyone who clones it, which is exactly the failure mode this replaces.
 *   - `web_fetch` only accepts http(s) and refuses loopback / private hosts, so
 *     a prompt-injected page cannot turn the tool into a local-network scanner.
 *   - Failures come back as text the model can read and route around (try a
 *     different query, drop a source), not as thrown errors that end the tool.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { fileURLToPath } from "node:url";

const USER_AGENT =
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 3_000_000;

interface SearchHit {
	title: string;
	url: string;
	snippet?: string;
}

// ── text helpers ────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	hellip: "…",
	mdash: "—",
	ndash: "–",
	rsquo: "'",
	lsquo: "'",
	rdquo: '"',
	ldquo: '"',
};

function decodeEntities(input: string): string {
	return input
		.replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeFromCodePoint(parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_, dec) => safeFromCodePoint(Number(dec)))
		.replace(/&([a-z][a-z0-9]*);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole);
}

function safeFromCodePoint(code: number): string {
	if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
	try {
		return String.fromCodePoint(code);
	} catch {
		return "";
	}
}

/** HTML → readable text. Removes scripts/styles, keeps block boundaries. */
function htmlToText(html: string): string {
	let out = html
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
		.replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article)>/gi, "\n")
		.replace(/<li[^>]*>/gi, "\n- ")
		.replace(/<[^>]+>/g, " ");

	out = decodeEntities(out);
	out = out.replace(/[ \t\u00a0]+/g, " ").replace(/ *\n */g, "\n");
	out = out.replace(/\n{3,}/g, "\n\n");
	return out.trim();
}

function firstMatch(html: string, pattern: RegExp): string | undefined {
	const m = pattern.exec(html);
	return m?.[1] ? htmlToText(m[1]) : undefined;
}

// ── network helpers ─────────────────────────────────────────────────────────

function isPrivateHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
	if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;
	const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
	if (!v4) return false;
	const octets = v4.slice(1).map(Number);
	if (octets.some((n) => n > 255)) return true;
	const [a, b] = octets;
	return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function parseHttpUrl(raw: string): URL {
	let candidate = raw.trim();
	if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) candidate = `https://${candidate}`;
	const url = new URL(candidate);
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`unsupported scheme "${url.protocol}" — only http and https are allowed`);
	}
	if (isPrivateHost(url.hostname)) {
		throw new Error(`refusing to fetch local or private address "${url.hostname}"`);
	}
	return url;
}

interface Fetched {
	url: string;
	status: number;
	contentType: string;
	body: string;
	truncated: boolean;
}

async function fetchPage(url: URL, signal?: AbortSignal): Promise<Fetched> {
	const timeout = AbortSignal.timeout(TIMEOUT_MS);
	const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
	const response = await fetch(url, {
		redirect: "follow",
		signal: combined,
		headers: {
			"user-agent": USER_AGENT,
			accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
			"accept-language": "es,en;q=0.8",
		},
	});

	const contentType = response.headers.get("content-type") ?? "";
	const reader = response.body?.getReader();
	if (!reader) return { url: response.url, status: response.status, contentType, body: "", truncated: false };

	const chunks: Uint8Array[] = [];
	let total = 0;
	let truncated = false;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		total += value.byteLength;
		if (total > MAX_BYTES) {
			chunks.push(value.subarray(0, Math.max(0, value.byteLength - (total - MAX_BYTES))));
			truncated = true;
			await reader.cancel().catch(() => undefined);
			break;
		}
		chunks.push(value);
	}

	const body = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
	return { url: response.url || url.toString(), status: response.status, contentType, body, truncated };
}

// ── DuckDuckGo parsing ──────────────────────────────────────────────────────

function resolveDdgHref(href: string): string | undefined {
	const absolute = href.startsWith("//") ? `https:${href}` : href;
	try {
		const url = new URL(absolute, "https://duckduckgo.com");
		const target = url.searchParams.get("uddg");
		if (target) return decodeURIComponent(target);
		if (/^https?:\/\//i.test(url.toString()) && !/(^|\.)duckduckgo\.com$/i.test(url.hostname)) return url.toString();
		return undefined;
	} catch {
		return undefined;
	}
}

function parseDdgHtml(html: string): SearchHit[] {
	const hits: SearchHit[] = [];
	const linkPattern = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
	const positions: Array<{ end: number; title: string; url: string }> = [];

	for (let m = linkPattern.exec(html); m; m = linkPattern.exec(html)) {
		const url = resolveDdgHref(decodeEntities(m[1]));
		if (!url) continue;
		positions.push({ end: m.index + m[0].length, title: htmlToText(m[2]), url });
	}

	for (const [i, entry] of positions.entries()) {
		const windowEnd = positions[i + 1]?.end ?? html.length;
		const slice = html.slice(entry.end, windowEnd);
		const snippetHtml = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(slice)?.[1]
			?? /<div[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(slice)?.[1];
		hits.push({ title: entry.title, url: entry.url, snippet: snippetHtml ? htmlToText(snippetHtml) : undefined });
	}
	return hits;
}

function parseDdgLite(html: string): SearchHit[] {
	const hits: SearchHit[] = [];
	const pattern = /<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
	for (let m = pattern.exec(html); m; m = pattern.exec(html)) {
		const url = resolveDdgHref(decodeEntities(m[1]));
		if (!url) continue;
		hits.push({ title: htmlToText(m[2]), url, snippet: undefined });
	}
	if (hits.length === 0) {
		const plain = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([^<]{3,120})<\/a>/gi;
		for (let m = plain.exec(html); m; m = plain.exec(html)) {
			const url = decodeEntities(m[1]);
			if (/duckduckgo\.com/i.test(url)) continue;
			hits.push({ title: htmlToText(m[2]), url });
		}
	}
	return hits;
}

async function search(query: string, limit: number, signal?: AbortSignal): Promise<SearchHit[]> {
	const encoded = encodeURIComponent(query);
	const attempts: Array<{ url: string; parse: (html: string) => SearchHit[] }> = [
		{ url: `https://html.duckduckgo.com/html/?q=${encoded}`, parse: parseDdgHtml },
		{ url: `https://lite.duckduckgo.com/lite/?q=${encoded}`, parse: parseDdgLite },
	];

	let lastError = "";
	for (const attempt of attempts) {
		try {
			const page = await fetchPage(new URL(attempt.url), signal);
			if (page.status !== 200) {
				lastError = `HTTP ${page.status} from ${new URL(attempt.url).hostname}`;
				continue;
			}
			const hits = attempt.parse(page.body).filter((hit, index, all) => all.findIndex((other) => other.url === hit.url) === index);
			if (hits.length > 0) return hits.slice(0, limit);
			lastError = `no results parsed from ${new URL(attempt.url).hostname} (the markup may have changed)`;
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
		}
	}
	throw new Error(`search failed: ${lastError}`);
}

function formatHits(hits: SearchHit[], query: string): string {
	if (hits.length === 0) return `No results for "${query}".`;
	const lines = hits.map((hit, index) => {
		const head = `${index + 1}. ${hit.title}`;
		const snippet = hit.snippet ? `\n   ${hit.snippet}` : "";
		return `${head}\n   ${hit.url}${snippet}`;
	});
	return `${hits.length} result(s) for "${query}":\n\n${lines.join("\n\n")}`;
}

// ── extension ───────────────────────────────────────────────────────────────

/**
 * A child subagent is launched with `--no-extensions` plus one `-e <path>` per
 * tool named in its `tools:` frontmatter, so interactive-subagents needs to know
 * which file backs `web_search` and `web_fetch`. It exposes that mapping hook on
 * a process global; the extension is loaded after this one's factory runs, so
 * registration is deferred to `session_start`.
 */
function registerWithSubagents(): void {
	const api = (globalThis as any).__pi_interactive_subagents as
		| { registerToolExtension: (name: string, extensionPath: string) => void }
		| undefined;
	if (!api?.registerToolExtension) return;

	let self: string;
	try {
		self = fileURLToPath(import.meta.url);
	} catch {
		return;
	}

	for (const name of ["web_search", "web_fetch"] as const) {
		try {
			api.registerToolExtension(name, self);
		} catch {
			// Already registered under a different path, or reloaded — ignore.
		}
	}
}

export default function webToolsExtension(pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		registerWithSubagents();
	});

	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web and return titles, URLs and snippets. Keyless (DuckDuckGo). Use it to find sources, then read the promising ones with web_fetch.",
		promptSnippet: "Search the web when a claim, definition, date or formula needs an outside source",
		promptGuidelines: [
			"Use web_search before web_fetch: search, read the titles and URLs, then fetch only the 2-3 most promising sources.",
			"Vary the query angle across searches (direct answer, authoritative source, practical experience, recent developments).",
			"Never cite a URL you did not open with web_fetch. A snippet is not a source.",
			"If a search returns nothing, say so instead of inventing a source.",
		],
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			max_results: Type.Optional(
				Type.Number({ description: "How many results to return (1-20, default 8)", minimum: 1, maximum: 20 }),
			),
		}),
		async execute(_toolCallId, params, signal) {
			const query = params.query.trim();
			if (!query) {
				return { content: [{ type: "text", text: "ERROR: empty query." }], details: { query, results: 0 } };
			}
			const limit = Math.min(Math.max(Math.round(params.max_results ?? 8), 1), 20);
			try {
				const hits = await search(query, limit, signal);
				return {
					content: [{ type: "text", text: formatHits(hits, query) }],
					details: { query, results: hits.length, hits },
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `ERROR: ${message}\nReport that the search failed; do not invent sources.` }],
					details: { query, results: 0, error: message },
				};
			}
		},
	});

	pi.registerTool({
		name: "web_fetch",
		label: "Web Fetch",
		description:
			"Download one URL and return its readable text (HTML is stripped to plain text). Only http and https; local and private addresses are refused.",
		promptSnippet: "Read the actual text of a page so a citation is backed by what the page says",
		promptGuidelines: [
			"Open a source with web_fetch before citing it.",
			"If a page is paywalled, empty or unreadable, drop it and say the source was unreachable.",
			"Long pages are truncated; if the answer is not in the returned text, fetch a more specific URL or search again.",
		],
		parameters: Type.Object({
			url: Type.String({ description: "Absolute http(s) URL to read" }),
			max_chars: Type.Optional(
				Type.Number({ description: "Maximum characters of text to return (default 6000)", minimum: 500, maximum: 40_000 }),
			),
		}),
		async execute(_toolCallId, params, signal) {
			let url: URL;
			try {
				url = parseHttpUrl(params.url);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { content: [{ type: "text", text: `ERROR: ${message}` }], details: { url: params.url, ok: false } };
			}

			const maxChars = Math.min(Math.max(Math.round(params.max_chars ?? 6000), 500), 40_000);
			try {
				const page = await fetchPage(url, signal);
				if (page.status >= 400) {
					return {
						content: [{ type: "text", text: `ERROR: HTTP ${page.status} for ${page.url}. The page is not readable; drop this source.` }],
						details: { url: page.url, ok: false, status: page.status },
					};
				}

				const isHtml = /html|xml/i.test(page.contentType) || /^\s*<(!doctype|html)/i.test(page.body);
				if (/application\/pdf/i.test(page.contentType)) {
					return {
						content: [{ type: "text", text: `ERROR: ${page.url} is a PDF, which this tool cannot read. Find an HTML version of the information.` }],
						details: { url: page.url, ok: false, pdf: true },
					};
				}

				const title = isHtml ? firstMatch(page.body, /<title[^>]*>([\s\S]*?)<\/title>/i) : undefined;
				const text = (isHtml ? htmlToText(page.body) : page.body.trim()).replace(/\n{3,}/g, "\n\n");
				if (!text) {
					return {
						content: [{ type: "text", text: `ERROR: ${page.url} returned no readable text (${page.contentType || "unknown type"}).` }],
						details: { url: page.url, ok: false, empty: true },
					};
				}

				const clipped = text.length > maxChars ? `${text.slice(0, maxChars)}\n\n[truncated: showing ${maxChars} of ${text.length} characters]` : text;
				const header = [`URL: ${page.url}`, title ? `TITLE: ${title}` : undefined, `TYPE: ${page.contentType || "unknown"}`]
					.filter(Boolean)
					.join("\n");
				return {
					content: [{ type: "text", text: `${header}\n\n${clipped}` }],
					details: { url: page.url, ok: true, status: page.status, title, chars: text.length, truncated: clipped !== text },
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `ERROR: ${message} (${url.toString()}). Drop this source or try another URL.` }],
					details: { url: url.toString(), ok: false, error: message },
				};
			}
		},
	});
}
