/**
 * web-tools-core — the machinery behind `web_search` and `web_fetch`.
 *
 * Split out of `web-tools.ts` so the parts that are pure (HTML reduction,
 * DuckDuckGo parsing, URL safety, charset decoding) can be unit-tested with
 * `node --test` without loading pi or typebox. It has **no imports at all**:
 * everything here runs on globals, so the tests and the extension see exactly
 * the same code.
 *
 * Invariants worth keeping:
 *   - Failures are values, not exceptions, at the tool boundary: the tool turns
 *     them into readable text the model can route around.
 *   - `web_fetch` never touches loopback/private addresses (prompt-injected
 *     pages must not turn the tool into a local-network scanner).
 *   - Zero dependencies, keyless: a fresh clone works with nothing installed.
 */

export const USER_AGENT =
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";
export const TIMEOUT_MS = 20_000;
export const MAX_BYTES = 3_000_000;

export interface SearchHit {
	title: string;
	url: string;
	snippet?: string;
}

export interface Fetched {
	url: string;
	status: number;
	contentType: string;
	body: string;
	truncated: boolean;
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
	minus: "−",
	rsquo: "'",
	lsquo: "'",
	rdquo: '"',
	ldquo: '"',
	sbquo: "‚",
	bdquo: "„",
	rarr: "→",
	larr: "←",
	uarr: "↑",
	darr: "↓",
	harr: "↔",
	trade: "™",
	reg: "®",
	copy: "©",
	deg: "°",
	bull: "•",
	middot: "·",
	laquo: "«",
	raquo: "»",
	laq: "«",
	raq: "»",
	times: "×",
	divide: "÷",
	plusmn: "±",
	frac12: "½",
	frac14: "¼",
	frac34: "¾",
	sect: "§",
	para: "¶",
	dagger: "†",
	Dagger: "‡",
	permil: "‰",
	euro: "€",
	pound: "£",
	yen: "¥",
	cent: "¢",
	szlig: "ß",
	agrave: "à",
	aacute: "á",
	acirc: "â",
	atilde: "ã",
	auml: "ä",
	aring: "å",
	ccedil: "ç",
	egrave: "è",
	eacute: "é",
	ecirc: "ê",
	euml: "ë",
	iacute: "í",
	ntilde: "ñ",
	oacute: "ó",
	ocirc: "ô",
	otilde: "õ",
	ouml: "ö",
	ugrave: "ù",
	uacute: "ú",
	uuml: "ü",
	iquest: "¿",
	iexcl: "¡",
};

export function decodeEntities(input: string): string {
	return input
		.replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeFromCodePoint(Number.parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_, dec) => safeFromCodePoint(Number(dec)))
		.replace(/&([a-z][a-z0-9]*);/gi, (whole, name: string) => ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? whole);
}

function safeFromCodePoint(code: number): string {
	if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
	if (code >= 0xd800 && code <= 0xdfff) return ""; // lone surrogate
	try {
		return String.fromCodePoint(code);
	} catch {
		return "";
	}
}

/**
 * Regions that are chrome, not content. Removing them before conversion is
 * what keeps a docs page from spending the whole `max_chars` budget on its
 * sidebar (the original complaint that motivated this pass).
 */
const DROPPED_BLOCKS =
	/<(script|style|noscript|template|svg|iframe|canvas|video|audio|object|embed|select|button|form|nav|footer|aside|dialog)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

const BLOCK_CLOSE = /<\/(p|div|li|tr|section|article|main|blockquote|pre|dd|dt|figcaption|h[1-6]|ul|ol|dl|table|thead|tbody|tfoot)\s*>/gi;
const BLOCK_OPEN = /<(p|div|li|tr|section|article|main|blockquote|pre|dd|dt|figcaption|h[1-6]|ul|ol|dl|table|thead|tbody|tfoot|br|hr)\b[^>]*>/gi;

function stripCommentsAndChrome(html: string): string {
	let out = html.replace(/<!--[\s\S]*?-->/g, " ");
	// Twice, so a dropped block nested in another dropped block goes too.
	out = out.replace(DROPPED_BLOCKS, " ").replace(DROPPED_BLOCKS, " ");
	out = out.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, " ");
	return out;
}

/** A page's own `<article>`/`<main>` if it carries real content; else whole html. */
function pickMainRegion(html: string): string {
	const candidates = [
		/<article\b[^>]*>([\s\S]*)<\/article\s*>/i,
		/<main\b[^>]*>([\s\S]*)<\/main\s*>/i,
		/role=["']main["'][^>]*>([\s\S]*?)<\/div\s*>/i,
	];
	for (const pattern of candidates) {
		const match = pattern.exec(html);
		if (!match) continue;
		const region = match[1];
		const text = collapseWhitespace(convertTagsToText(region));
		if (text.length >= 300) return region;
	}
	return html;
}

function convertTagsToText(html: string): string {
	let out = html;
	// An empty list item must not become a bare "-" line. Tag soup from real
	// pages (icon `<li>`s, menu placeholders) makes those lines pure noise.
	out = out.replace(/<li\b[^>]*>\s*(?=<\/(?:li|ul|ol)\s*>)/gi, "\n");
	out = out.replace(/<li\b[^>]*>/gi, "\n- ");
	out = out.replace(/<t[dh]\b[^>]*>/gi, "\t");
	out = out.replace(BLOCK_CLOSE, "\n");
	out = out.replace(BLOCK_OPEN, "\n");
	out = out.replace(/<[^>]+>/g, " ");
	out = decodeEntities(out);
	out = out.replace(/\u00a0/g, " ").replace(/[\u200b\u200c\u200d\ufeff]/g, "");
	return out;
}

/** Per-line cleanup shared by every caller: no chrome lines, no ragged space. */
function collapseWhitespace(text: string): string {
	const lines: string[] = [];
	for (const raw of text.split("\n")) {
		let line = raw.replace(/[ \t]+/g, " ").trim();
		// Whole line is punctuation only ("-", "|", "- - -"): scaffolding.
		if (/^[-–—•·|,;:.·\s]+$/.test(line)) continue;
		// A tag boundary inserted a space before punctuation: "word ." → "word."
		line = line.replace(/ +([.,;:!?%)\]])/g, "$1").replace(/([(\[]) +/g, "$1");
		if (line) lines.push(line);
	}
	return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** HTML → readable text. Keeps block boundaries, drops chrome, no empty bullets. */
export function htmlToText(html: string): string {
	const stripped = stripCommentsAndChrome(html);
	return collapseWhitespace(convertTagsToText(pickMainRegion(stripped)));
}

export function extractTitle(html: string): string | undefined {
	const match = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
	const title = match?.[1] ? collapseWhitespace(decodeEntities(match[1])) : "";
	if (!title) return undefined;
	return title.replace(/\s*\n\s*/g, " ").trim() || undefined;
}

export function clipText(text: string, maxChars: number): { text: string; truncated: boolean } {
	if (text.length <= maxChars) return { text, truncated: false };
	return {
		text: `${text.slice(0, maxChars)}\n\n[truncated: showing ${maxChars} of ${text.length} characters]`,
		truncated: true,
	};
}

// ── URL safety ──────────────────────────────────────────────────────────────

export function isPrivateHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
	if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
	if (host === "::" || host === "::1") return true;
	if (host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;
	// NAT64 and IPv4-mapped loopback.
	if (host === "64:ff9b::1" || host === "::ffff:127.0.0.1") return true;
	const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
	if (!v4) return false;
	const octets = v4.slice(1).map(Number);
	if (octets.some((n) => n > 255)) return true;
	const [a, b] = octets;
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 100 && b >= 64 && b <= 127) || // CGNAT
		(a === 192 && b === 0) // 192.0.0.0/24, 192.0.2.0/24 test-net
	);
}

export function parseHttpUrl(raw: string): URL {
	let candidate = raw.trim();
	if (!candidate) throw new Error("empty URL");
	if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) candidate = `https://${candidate}`;
	let url: URL;
	try {
		url = new URL(candidate);
	} catch {
		throw new Error(`not a valid URL: "${raw.trim()}"`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`unsupported scheme "${url.protocol}" — only http and https are allowed`);
	}
	if (isPrivateHost(url.hostname)) {
		throw new Error(`refusing to fetch local or private address "${url.hostname}"`);
	}
	return url;
}

// ── network ─────────────────────────────────────────────────────────────────

interface FetchOptions {
	signal?: AbortSignal;
	fetchImpl?: typeof fetch;
	/** Network-level retries (timeouts, resets). HTTP statuses are not retried. */
	retries?: number;
}

function charsetFrom(headers: Headers, bytes: Uint8Array): string | undefined {
	const header = headers.get("content-type") ?? "";
	const fromHeader = /charset\s*=\s*["']?([\w.:-]+)/i.exec(header)?.[1];
	if (fromHeader) return fromHeader;
	// Sniff `<meta charset>` / `<meta http-equiv>` in the first 4 KB.
	const head = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
	return (
		/<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head)?.[1] ??
		/<\?xml[^>]+encoding\s*=\s*["']([\w.:-]+)/i.exec(head)?.[1]
	);
}

function decodeBytes(bytes: Uint8Array, label?: string): string {
	const candidates = [label, "utf-8"].filter(Boolean) as string[];
	for (const candidate of candidates) {
		try {
			return new TextDecoder(candidate, { fatal: false }).decode(bytes);
		} catch {
			// Unknown label — fall through to the next candidate.
		}
	}
	return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

async function fetchOnce(url: URL, options: FetchOptions, signal: AbortSignal): Promise<Fetched> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const response = await fetchImpl(url, {
		redirect: "follow",
		signal,
		headers: {
			"user-agent": USER_AGENT,
			accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
			"accept-language": "es,en;q=0.8",
		},
	});

	const contentType = response.headers.get("content-type") ?? "";
	const reader = response.body?.getReader();
	if (!reader) return { url: response.url || url.toString(), status: response.status, contentType, body: "", truncated: false };

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

	const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
	return {
		url: response.url || url.toString(),
		status: response.status,
		contentType,
		body: decodeBytes(bytes, charsetFrom(response.headers, bytes)),
		truncated,
	};
}

export async function fetchPage(url: URL, options: FetchOptions = {}): Promise<Fetched> {
	const retries = Math.max(0, options.retries ?? 1);
	let lastError: unknown;
	for (let attempt = 0; attempt <= retries; attempt++) {
		const timeout = AbortSignal.timeout(TIMEOUT_MS);
		const combined = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
		try {
			return await fetchOnce(url, options, combined);
		} catch (error) {
			lastError = error;
			if (options.signal?.aborted) break; // the caller cancelled: do not retry
			if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
		}
	}
	throw new Error(describeNetworkError(lastError, url));
}

export function describeNetworkError(error: unknown, url: URL): string {
	const name = (error as { name?: string } | undefined)?.name ?? "";
	const raw = error instanceof Error ? error.message : String(error);
	const host = url.hostname;
	if (name === "TimeoutError" || name === "AbortError" || /timed? ?out/i.test(raw)) {
		return `timeout after ${Math.round(TIMEOUT_MS / 1000)}s fetching ${host} — the host is slow or blocking`;
	}
	if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(raw)) return `DNS lookup failed for ${host}`;
	if (/ECONNREFUSED/i.test(raw)) return `connection refused by ${host}`;
	if (/ECONNRESET|socket hang up/i.test(raw)) return `connection reset by ${host}`;
	if (/CERT|SSL|TLS/i.test(raw)) return `TLS/certificate error for ${host}`;
	return raw || `unknown network error fetching ${host}`;
}

// ── DuckDuckGo parsing ──────────────────────────────────────────────────────

function attrValue(tag: string, name: string): string | undefined {
	const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
	const match = pattern.exec(tag);
	return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

function classList(tag: string): string[] {
	return (attrValue(tag, "class") ?? "").split(/\s+/).filter(Boolean);
}

export function resolveDdgHref(href: string): string | undefined {
	const absolute = href.startsWith("//") ? `https:${href}` : href;
	try {
		const url = new URL(absolute, "https://duckduckgo.com");
		const target = url.searchParams.get("uddg");
		if (target) return safeDecode(target);
		// Ad/tracking redirects resolve to duckduckgo.com itself: drop them.
		if (/(^|\.)duckduckgo\.com$/i.test(url.hostname)) return undefined;
		if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
		return undefined;
	} catch {
		return undefined;
	}
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

/** Tracking parameters and fragments add nothing to "is this the same source?". */
export function normalizeUrl(raw: string): string {
	try {
		const url = new URL(raw);
		url.hash = "";
		for (const key of [...url.searchParams.keys()]) {
			if (/^(utm_|fbclid$|gclid$|ref$|mc_cid$|mc_eid$|igshid$)/i.test(key)) url.searchParams.delete(key);
		}
		let out = url.toString();
		if (out.endsWith("/") && url.pathname !== "/") out = out.slice(0, -1);
		return out;
	} catch {
		return raw;
	}
}

/** Parse `html.duckduckgo.com` results: ordered attributes, ads dropped. */
export function parseDdgHtml(html: string): SearchHit[] {
	const hits: SearchHit[] = [];
	const anchors: Array<{ end: number; title: string; url: string }> = [];

	const anchor = /<a\b[^>]*>[\s\S]*?<\/a\s*>/gi;
	for (let m = anchor.exec(html); m; m = anchor.exec(html)) {
		const tag = m[0].slice(0, m[0].indexOf(">") + 1);
		if (!classList(tag).some((name) => name.startsWith("result__a"))) continue;
		const href = attrValue(tag, "href");
		if (!href) continue;
		const url = resolveDdgHref(decodeEntities(href));
		if (!url) continue;
		anchors.push({ end: m.index + m[0].length, title: collapseWhitespace(convertTagsToText(m[0])), url });
	}

	for (const [index, entry] of anchors.entries()) {
		const windowEnd = anchors[index + 1]?.end ?? html.length;
		const slice = html.slice(entry.end, windowEnd);
		const snippetTag = /<(a|div|span)\b[^>]*>/gi;
		let snippet: string | undefined;
		for (let m = snippetTag.exec(slice); m; m = snippetTag.exec(slice)) {
			if (!classList(m[0]).some((name) => name.startsWith("result__snippet"))) continue;
			const close = new RegExp(`</${m[1]}\\s*>`, "i");
			const rest = slice.slice(m.index + m[0].length);
			const end = close.exec(rest);
			snippet = collapseWhitespace(convertTagsToText(end ? rest.slice(0, end.index) : rest));
			break;
		}
		hits.push({ title: entry.title, url: entry.url, snippet: snippet || undefined });
	}
	return hits;
}

/** Parse `lite.duckduckgo.com` results, including its snippets. */
export function parseDdgLite(html: string): SearchHit[] {
	const hits: SearchHit[] = [];
	const row = /<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi;
	let current: SearchHit | undefined;

	for (let m = row.exec(html); m; m = row.exec(html)) {
		const text = m[0];
		const link = /<a\b[^>]*>[\s\S]*?<\/a\s*>/i.exec(text);
		if (link) {
			const tag = link[0].slice(0, link[0].indexOf(">") + 1);
			const classes = classList(tag);
			const href = attrValue(tag, "href");
			const isResult = classes.includes("result-link") || /result-link/.test(tag);
			if (href && (isResult || !current)) {
				const url = resolveDdgHref(decodeEntities(href));
				const title = collapseWhitespace(convertTagsToText(link[0]));
				if (url && title.length > 1) {
					current = { title, url };
					hits.push(current);
				}
			}
		}
		if (current && /result-snippet/.test(text)) {
			const snippet = collapseWhitespace(convertTagsToText(text.replace(/<a\b[^>]*>[\s\S]*?<\/a\s*>/i, " ")));
			if (snippet && !current.snippet) current.snippet = snippet;
		}
	}

	if (hits.length === 0) {
		// Last resort: bare links that are not DuckDuckGo's own navigation.
		const plain = /<a\b[^>]*href\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]{3,200}?)<\/a\s*>/gi;
		for (let m = plain.exec(html); m; m = plain.exec(html)) {
			const url = decodeEntities(m[1]);
			if (/duckduckgo\.com/i.test(url)) continue;
			const title = collapseWhitespace(convertTagsToText(m[2]));
			if (title) hits.push({ title, url });
		}
	}
	return hits;
}

export function formatHits(hits: SearchHit[], query: string): string {
	if (hits.length === 0) return `No results for "${query}".`;
	const lines = hits.map((hit, index) => {
		const head = `${index + 1}. ${hit.title}`;
		const snippet = hit.snippet ? `\n   ${hit.snippet}` : "";
		return `${head}\n   ${hit.url}${snippet}`;
	});
	return `${hits.length} result(s) for "${query}":\n\n${lines.join("\n\n")}`;
}

// ── search ──────────────────────────────────────────────────────────────────

export function normalizeQuery(query: string): string {
	return query.replace(/\s+/g, " ").trim().slice(0, 400);
}

function looksBlocked(status: number, body: string): boolean {
	if (status === 202 || status === 403 || status === 429) return true;
	return /anomaly-modal|challenge-form|detect_bot|unusual traffic/i.test(body);
}

export interface SearchAttempt {
	label: string;
	url: string;
	method: "GET" | "POST";
	body?: string;
	parse: (html: string) => SearchHit[];
}

export interface SearchOptions extends FetchOptions {
	/** Injected endpoint list in tests; defaults to the three real DuckDuckGo paths. */
	attempts?: SearchAttempt[];
}

/**
 * DuckDuckGo, three ways. GET html → GET lite → POST html. DuckDuckGo answers a
 * plain GET with a 202 anti-bot page under load; the POST form is the fallback
 * that usually still works, so a rate-limit degrades instead of failing.
 */
export function defaultSearchAttempts(encoded: string): SearchAttempt[] {
	return [
		{ label: "html.duckduckgo.com", url: `https://html.duckduckgo.com/html/?q=${encoded}`, method: "GET", parse: parseDdgHtml },
		{ label: "lite.duckduckgo.com", url: `https://lite.duckduckgo.com/lite/?q=${encoded}`, method: "GET", parse: parseDdgLite },
		{
			label: "html.duckduckgo.com (POST)",
			url: "https://html.duckduckgo.com/html/",
			method: "POST",
			body: `q=${encoded}&b=&kl=wt-wt`,
			parse: parseDdgHtml,
		},
	];
}

export async function searchWeb(query: string, limit: number, options: SearchOptions = {}): Promise<SearchHit[]> {
	const clean = normalizeQuery(query);
	if (!clean) throw new Error("empty query");
	const encoded = encodeURIComponent(clean);
	const attempts = options.attempts ?? defaultSearchAttempts(encoded);
	const reasons: string[] = [];

	for (const attempt of attempts) {
		try {
			const page = await fetchPageWithMethod(attempt, options);
			if (page.status !== 200) {
				reasons.push(`${attempt.label}: HTTP ${page.status}`);
				continue;
			}
			if (looksBlocked(page.status, page.body)) {
				reasons.push(`${attempt.label}: anti-bot page`);
				continue;
			}
			const hits = attempt
				.parse(page.body)
				.filter((hit) => hit.url && hit.title)
				.filter((hit, index, all) => all.findIndex((other) => normalizeUrl(other.url) === normalizeUrl(hit.url)) === index);
			if (hits.length > 0) return hits.slice(0, limit);
			reasons.push(`${attempt.label}: no results parsed (markup may have changed)`);
		} catch (error) {
			reasons.push(`${attempt.label}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	throw new Error(`search failed — ${reasons.join("; ")}`);
}

async function fetchPageWithMethod(attempt: SearchAttempt, options: FetchOptions): Promise<Fetched> {
	if (attempt.method === "GET") return fetchPage(new URL(attempt.url), options);

	const fetchImpl = options.fetchImpl ?? fetch;
	const timeout = AbortSignal.timeout(TIMEOUT_MS);
	const combined = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
	const url = new URL(attempt.url);
	let response: Response;
	try {
		response = await fetchImpl(url, {
			method: "POST",
			redirect: "follow",
			signal: combined,
			headers: {
				"user-agent": USER_AGENT,
				accept: "text/html,application/xhtml+xml",
				"accept-language": "es,en;q=0.8",
				"content-type": "application/x-www-form-urlencoded",
			},
			body: attempt.body ?? "",
		});
	} catch (error) {
		throw new Error(describeNetworkError(error, url));
	}
	const body = await response.text().catch(() => "");
	return { url: response.url || url.toString(), status: response.status, contentType: response.headers.get("content-type") ?? "", body, truncated: false };
}
