/**
 * web-tools
 *
 * Two model-callable tools that give the `researcher` subagent (and any normal
 * session) real web access without API keys, MCP servers or extra npm deps:
 *
 *   • web_search — DuckDuckGo's HTML endpoint, parsed into title / URL / snippet.
 *   • web_fetch  — downloads one URL and reduces it to readable text.
 *
 * The machinery lives in `web-tools-core.ts` (no imports, unit-tested by
 * `tests/web-tools.test.ts`); this file is only the pi-facing shell: schemas,
 * prompts, and the response shape.
 *
 * Design notes:
 *   - Zero dependencies apart from typebox, which pi already provides. Node's
 *     built-in `fetch` does the network work, so the tools run on a fresh
 *     machine with nothing installed but pi.
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
import {
	clipText,
	extractTitle,
	fetchPage,
	formatHits,
	htmlToText,
	MAX_BYTES,
	normalizeQuery,
	parseHttpUrl,
	searchWeb,
} from "./web-tools-core.ts";

const FAILURE_HINT = "Report that the fetch failed and why; do not invent the page's contents.";

function isHtml(contentType: string, body: string): boolean {
	return /html|xml/i.test(contentType) || /^\s*<(!doctype|html)/i.test(body.slice(0, 512));
}

function looksLikePdf(contentType: string, body: string): boolean {
	return /application\/pdf/i.test(contentType) || body.slice(0, 5) === "%PDF-";
}

function statusMessage(url: string, status: number): string {
	if (status === 401 || status === 403) return `HTTP ${status} for ${url} — the site blocks non-browser clients. Drop this source or find a mirror.`;
	if (status === 429) return `HTTP 429 for ${url} — rate limited. Wait, or drop this source.`;
	if (status === 404 || status === 410) return `HTTP ${status} for ${url} — the page does not exist. Check the URL; do not cite it.`;
	if (status >= 500) return `HTTP ${status} for ${url} — the site is failing. Drop this source or try again later.`;
	return `HTTP ${status} for ${url} — the page is not readable. Drop this source.`;
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
			const query = normalizeQuery(params.query);
			if (!query) {
				return { content: [{ type: "text", text: "ERROR: empty query." }], details: { query, results: 0 } };
			}
			const limit = Math.min(Math.max(Math.round(params.max_results ?? 8), 1), 20);
			try {
				const hits = await searchWeb(query, limit, { signal });
				return {
					content: [{ type: "text", text: formatHits(hits, query) }],
					details: { query, results: hits.length, hits },
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [
						{
							type: "text",
							text: `ERROR: ${message}\nReport that the search failed; do not invent sources. Try a shorter or differently phrased query once.`,
						},
					],
					details: { query, results: 0, error: message },
				};
			}
		},
	});

	pi.registerTool({
		name: "web_fetch",
		label: "Web Fetch",
		description:
			"Download one URL and return its readable text (HTML is stripped to plain text, page chrome removed). Only http and https; local and private addresses are refused.",
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
				const page = await fetchPage(url, { signal });
				if (page.status >= 400) {
					return {
						content: [{ type: "text", text: `ERROR: ${statusMessage(page.url, page.status)}` }],
						details: { url: page.url, ok: false, status: page.status },
					};
				}
				if (looksLikePdf(page.contentType, page.body)) {
					return {
						content: [
							{
								type: "text",
								text: `ERROR: ${page.url} is a PDF, which this tool cannot read. Find an HTML version (arXiv papers: try arxiv.org/abs/... or ar5iv.labs.arxiv.org/html/...).`,
							},
						],
						details: { url: page.url, ok: false, pdf: true },
					};
				}

				const html = isHtml(page.contentType, page.body);
				const title = html ? extractTitle(page.body) : undefined;
				const text = (html ? htmlToText(page.body) : page.body.trim()).replace(/\n{3,}/g, "\n\n");
				if (!text) {
					return {
						content: [
							{
								type: "text",
								text: `ERROR: ${page.url} returned no readable text (${page.contentType || "unknown type"}). The page probably needs JavaScript; drop this source. ${FAILURE_HINT}`,
							},
						],
						details: { url: page.url, ok: false, empty: true },
					};
				}

				const clip = clipText(text, maxChars);
				const header = [
					`URL: ${page.url}`,
					title ? `TITLE: ${title}` : undefined,
					`TYPE: ${page.contentType || "unknown"}`,
					page.truncated ? `NOTE: response body capped at ${Math.round(MAX_BYTES / 1_000_000)} MB while downloading` : undefined,
				]
					.filter(Boolean)
					.join("\n");
				return {
					content: [{ type: "text", text: `${header}\n\n${clip.text}` }],
					details: {
						url: page.url,
						ok: true,
						status: page.status,
						title,
						chars: text.length,
						truncated: clip.truncated,
					},
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
