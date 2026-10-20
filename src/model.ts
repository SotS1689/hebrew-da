// Data model for a Hebrew discourse-analysis (.hda) file.
//
// Each clause has a level (its label) and an indent (its layout), set
// independently. The level is a speech depth plus a line:
//
//   depth 0 (Hx, narrative):     M  O1 O2 O3
//   depth 1 (Dx, speech):        M  M2 O1 O2 O3
//   depth 2 (Dx², speech in speech), depth 3 (Dx³): same as depth 1
//
// That covers the spreadsheet's nine columns (Hx M1/O1/O2/O3, Dx
// M1/M2/O1/O2/O3) as depths 0-1, and lets quotations nest further. The
// indent is a number of steps from the margin (right in the Hebrew column,
// left in the English), changed with Tab / Shift+Tab.

export type Line = "M" | "M2" | "O1" | "O2" | "O3";

export interface Clause {
	id: string;
	// Verse number this clause starts (e.g. "3" or "2:1"); absent when the
	// clause continues the previous verse. Labels (3a, 3b...) are computed.
	verse?: string;
	he: string;
	en: string;
	depth: number;
	line: Line;
	indent: number;
	conj: string;
	pattern: string;
	notes: string;
}

export interface HdaColumns {
	conj: boolean;
	pattern: boolean;
	notes: boolean;
	english: boolean;
}

export interface HdaData {
	version: 1;
	passage: string;
	clauses: Clause[];
	zoomLevel: number;
	story: StoryData;
	// The tab the file was last left on.
	tab: HdaTab;
	timestamp?: string;
}

export type HdaTab = "prose" | "story";

// ---------- story analysis (the Story tab's flow chart) ----------

// One block of the story's plot. x/y/w are in unzoomed pixels.
export interface StoryBlock {
	id: string;
	x: number;
	y: number;
	w: number;
	verses: string;
	title: string;
	// The teaching point of the block, under its title.
	point: string;
	fn: string;
	characters: string;
	location: string;
	time: string;
	imagery: string;
}

// An arrow from one block to another, with an optional label.
export interface StoryLink {
	id: string;
	from: string;
	to: string;
	label: string;
}

export interface StoryData {
	blocks: StoryBlock[];
	links: StoryLink[];
	zoom: number;
	// Where the canvas has been dragged to (screen pixels): the view, not
	// part of the analysis, so it isn't undone.
	panX: number;
	panY: number;
}

export const STORY_BLOCK_WIDTH = 240;
export const STORY_FIELDS = ["characters", "location", "time", "imagery"] as const;
export type StoryField = typeof STORY_FIELDS[number];
export const STORY_FIELD_NAMES: Record<StoryField, string> = {
	characters: "Characters", location: "Location", time: "Time", imagery: "Imagery",
};

// Suggested plot functions; the box accepts anything typed. Each has a
// color (index into the --hds-fn-N palette) that tints the block.
export const STORY_FUNCTIONS: { value: string; hint: string }[] = [
	{ value: "Exposition", hint: "setting, characters and situation introduced" },
	{ value: "Inciting incident", hint: "the event that sets the plot moving" },
	{ value: "Rising action", hint: "complication; tension builds" },
	{ value: "Climax", hint: "turning point; tension at its height" },
	{ value: "Falling action", hint: "consequences of the turning point" },
	{ value: "Resolution", hint: "the tension is resolved" },
	{ value: "Conclusion", hint: "final situation, summary or comment" },
	{ value: "Interlude", hint: "pause, aside or narrator's comment" },
];

export function storyFunctionIndex(fn: string): number {
	const f = fn.trim().toLowerCase();
	if (!f) return -1;
	const exact = STORY_FUNCTIONS.findIndex(o => o.value.toLowerCase() === f);
	if (exact >= 0) return exact;
	const tests: [RegExp, number][] = [
		[/expos|setting|introduc|background/, 0], [/incit|initiat|complication begins/, 1], [/ris|complicat|tension/, 2],
		[/climax|peak|turning/, 3], [/fall/, 4], [/resol|denou|unravel/, 5], [/conclu|final|coda|epilog/, 6], [/interlude|aside|comment|pause/, 7],
	];
	for (const [re, i] of tests) if (re.test(f)) return i;
	return -1;
}

export function emptyStory(): StoryData {
	return { blocks: [], links: [], zoom: 1, panX: 0, panY: 0 };
}

export function newStoryBlock(init: Partial<StoryBlock> = {}): StoryBlock {
	return { id: newId(), x: 40, y: 40, w: STORY_BLOCK_WIDTH, verses: "", title: "", point: "", fn: "", characters: "", location: "", time: "", imagery: "", ...init };
}

export function normalizeStory(raw: unknown): StoryData {
	const d = (raw && typeof raw === "object" ? raw : {}) as Partial<StoryData>;
	const num = (v: unknown, def: number) => (typeof v === "number" && Number.isFinite(v) ? v : def);
	const blocks = (Array.isArray(d.blocks) ? d.blocks : []).map(b => newStoryBlock({
		id: typeof b?.id === "string" && b.id ? b.id : newId(),
		x: num(b?.x, 40), y: num(b?.y, 40), w: Math.max(160, num(b?.w, STORY_BLOCK_WIDTH)),
		verses: str(b?.verses), title: str(b?.title), point: str(b?.point), fn: str(b?.fn),
		characters: str(b?.characters), location: str(b?.location), time: str(b?.time), imagery: str(b?.imagery),
	}));
	const ids = new Set(blocks.map(b => b.id));
	const links = (Array.isArray(d.links) ? d.links : [])
		.filter(l => l && ids.has(l.from) && ids.has(l.to) && l.from !== l.to)
		.map(l => ({ id: typeof l.id === "string" && l.id ? l.id : newId(), from: l.from, to: l.to, label: str(l.label) }));
	return { blocks, links, zoom: num(d.zoom, 1) > 0 ? num(d.zoom, 1) : 1, panX: num(d.panX, 0), panY: num(d.panY, 0) };
}

export const MAX_DEPTH = 3;
export const MAX_INDENT = 20;

export function emptyData(): HdaData {
	return { version: 1, passage: "", clauses: [], zoomLevel: 1, story: emptyStory(), tab: "prose" };
}

let idCounter = 0;
export function newId(): string {
	idCounter = (idCounter + 1) % 1e6;
	return Date.now().toString(36) + "-" + idCounter.toString(36) + Math.random().toString(36).slice(2, 6);
}

export function newClause(init: Partial<Clause> = {}): Clause {
	return { id: newId(), he: "", en: "", depth: 0, line: "M", indent: 0, conj: "", pattern: "", notes: "", ...init };
}

// Coerces whatever was read from disk into valid clauses.
export function normalizeData(raw: unknown): HdaData {
	const d = (raw && typeof raw === "object" ? raw : {}) as Partial<HdaData>;
	const clauses = Array.isArray(d.clauses) ? d.clauses : [];
	return {
		version: 1,
		passage: typeof d.passage === "string" ? d.passage : "",
		zoomLevel: typeof d.zoomLevel === "number" && d.zoomLevel > 0 ? d.zoomLevel : 1,
		story: normalizeStory(d.story),
		tab: d.tab === "story" ? "story" : "prose",
		clauses: clauses.map(c => {
			const cl = newClause({
				id: typeof c?.id === "string" ? c.id : undefined,
				he: str(c?.he), en: str(c?.en), conj: str(c?.conj), pattern: str(c?.pattern), notes: str(c?.notes),
				depth: Math.min(MAX_DEPTH, Math.max(0, Math.floor(Number(c?.depth) || 0))),
				line: isLine(c?.line) ? c.line : "M",
			});
			if (!cl.id) cl.id = newId();
			if (typeof c?.verse === "string" && c.verse.trim()) cl.verse = c.verse.trim();
			if (cl.depth === 0 && cl.line === "M2") cl.line = "M";
			// Files saved before indents were separate from levels took their
			// indent from the level.
			const indent = Number(c?.indent);
			cl.indent = Number.isFinite(indent) ? Math.min(MAX_INDENT, Math.max(0, Math.round(indent))) : indentOf(cl);
			return cl;
		}),
	};
}

function str(v: unknown): string { return typeof v === "string" ? v : ""; }
function isLine(v: unknown): v is Line { return v === "M" || v === "M2" || v === "O1" || v === "O2" || v === "O3"; }

// ---------- levels ----------

export function linesFor(depth: number): Line[] {
	return depth === 0 ? ["M", "O1", "O2", "O3"] : ["M", "M2", "O1", "O2", "O3"];
}

// The indent the spreadsheet gave a level (0 = Hx mainline); used for
// imports and older files.
export function indentOf(c: { depth: number; line: Line }): number {
	let base = 0;
	for (let d = 0; d < c.depth; d++) base += linesFor(d).length;
	return base + Math.max(0, linesFor(c.depth).indexOf(c.line));
}

export function textType(depth: number): "Hx" | "Dx" {
	return depth === 0 ? "Hx" : "Dx";
}

const SUPERSCRIPT = ["", "", "²", "³"];
export function depthLabel(depth: number): string {
	return depth === 0 ? "Hx" : "Dx" + (SUPERSCRIPT[depth] || "");
}

export function levelLabel(c: { depth: number; line: Line }): string {
	return `${depthLabel(c.depth)} ${c.line}`;
}

export const LINE_NAMES: Record<Line, string> = {
	M: "Mainline",
	M2: "Mainline 2",
	O1: "Offline 1",
	O2: "Offline 2",
	O3: "Offline 3",
};

export const DEPTH_NAMES = ["Narrative (Hx)", "Direct speech (Dx)", "Speech within speech (Dx²)", "Third-level speech (Dx³)"];

// The spreadsheet's radio-button value (1-9, 'Don't Touch' column L).
export function levelFromSpreadsheet(n: number): { depth: number; line: Line } {
	const map: Record<number, { depth: number; line: Line }> = {
		1: { depth: 0, line: "M" }, 2: { depth: 0, line: "O1" }, 3: { depth: 0, line: "O2" }, 4: { depth: 0, line: "O3" },
		5: { depth: 1, line: "M" }, 6: { depth: 1, line: "M2" }, 7: { depth: 1, line: "O1" }, 8: { depth: 1, line: "O2" }, 9: { depth: 1, line: "O3" },
	};
	return map[n] || map[1];
}

// ---------- verse labels ----------

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
function letterFor(i: number): string {
	return i < 26 ? LETTERS[i] : LETTERS[Math.floor(i / 26) - 1] + LETTERS[i % 26];
}

// "3a", "3b"... for clauses of a verse with several clauses; just "4" for a
// one-clause verse; blank before the first verse number.
export function computeLabels(clauses: Clause[]): string[] {
	const labels: string[] = new Array(clauses.length).fill("");
	let i = 0;
	while (i < clauses.length) {
		const verse = clauses[i].verse;
		let j = i + 1;
		while (j < clauses.length && !clauses[j].verse) j++;
		if (verse) {
			const n = j - i;
			for (let k = i; k < j; k++) labels[k] = n === 1 ? verse : verse + letterFor(k - i);
		}
		i = j;
	}
	return labels;
}

// Verse numbers for clauses that don't have one, from the passage's first
// verse and the sof pasuq (׃) that ends each verse.
export function inferVerses(clauses: Clause[], startVerse: number | null): void {
	if (startVerse === null || clauses.some(c => c.verse)) return;
	let v = startVerse;
	let atStart = true;
	for (const c of clauses) {
		if (atStart) c.verse = String(v);
		atStart = /׃\s*[פס]?\s*$/.test(c.he.trim());
		if (atStart) v++;
	}
}

// First verse of a passage reference like "Genesis 3:1-6" or "Gen 2.18-25".
export function startVerseOf(passage: string): number | null {
	const m = passage.match(/\d+\s*[:.]\s*(\d+)/);
	return m ? Number(m[1]) : null;
}

// ---------- pasting ----------

// Splits pasted text into clause texts, pulling off leading verse numbers
// ("3 ...", "3. ...", "Gen 3:3 ...", or a verse number glued to Hebrew).
export function splitPasted(raw: string): { text: string; verse?: string }[] {
	const text = raw.replace(/\r\n?/g, "\n").replace(/[‎‏‪-‮]/g, "");
	let lines = text.split("\n").map(l => l.trim()).filter(Boolean);
	// One long paragraph with embedded verse numbers: break before each.
	if (lines.length === 1) {
		const pieces = lines[0].split(/(?=(?:^|\s)\d{1,3}(?=\s?[֐-׿]))/).map(s => s.trim()).filter(Boolean);
		if (pieces.length > 1) lines = pieces;
	}
	return lines.map(line => {
		const m = line.match(/^(?:[1-3]?\s?[A-Za-z]+\.?\s+)?(\d{1,3}(?:[:.]\d{1,3})?)[.)]?\s*(?=\S)/);
		if (m) {
			const rest = line.slice(m[0].length).trim();
			const ref = m[1];
			const verse = ref.includes(":") || ref.includes(".") ? ref.split(/[:.]/)[1] : ref;
			if (rest) return { text: collapse(rest), verse };
		}
		return { text: collapse(line) };
	});
}

export function collapse(s: string): string {
	return s.replace(/[ \t ]+/g, " ").trim();
}

// ---------- conjunctions and predicate patterns ----------

// ---------- Conj box: phonetic Hebrew typing ----------

// Latin keys typed in the Conj box become Hebrew letters; 0 is Ø
// (asyndeton) and - is maqaf. Final forms are applied automatically.
export const CONJ_KEYMAP: Record<string, string> = {
	a: "א", b: "ב", g: "ג", d: "ד", h: "ה", w: "ו", v: "ו", z: "ז", x: "ח", H: "ח", T: "ט",
	y: "י", i: "י", k: "כ", l: "ל", m: "מ", n: "נ", S: "ס", e: "ע", o: "ע", p: "פ", f: "פ",
	c: "צ", q: "ק", r: "ר", s: "ש", t: "ת", "0": "Ø", "-": "־",
};

const TO_FINAL: Record<string, string> = { "כ": "ך", "מ": "ם", "נ": "ן", "פ": "ף", "צ": "ץ" };
const FROM_FINAL: Record<string, string> = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };
const HEBREW_LETTER = /[א-ת]/;

// Same length in and out (one character per character), so the caret can
// stay where it was.
export function toHebrewConj(text: string): string {
	// Exact key first (S, H, T have their own letters), then the lowercase key.
	const mapped = Array.from(text, ch => CONJ_KEYMAP[ch] ?? CONJ_KEYMAP[ch.toLowerCase()] ?? ch);
	return mapped.map((ch, i) => {
		const nextIsLetter = i + 1 < mapped.length && HEBREW_LETTER.test(mapped[i + 1]);
		if (!nextIsLetter && TO_FINAL[ch]) return TO_FINAL[ch];
		if (nextIsLetter && FROM_FINAL[ch]) return FROM_FINAL[ch];
		return ch;
	}).join("");
}

export const PREDICATE_PATTERNS: { value: string; hint: string }[] = [
	{ value: "Wayyiqtol", hint: "waw consecutive + imperfect" },
	{ value: "Qatal", hint: "perfect" },
	{ value: "X-qatal", hint: "non-verbal + perfect" },
	{ value: "We-X-qatal", hint: "waw + non-verbal + perfect" },
	{ value: "Weqatal", hint: "waw consecutive + perfect" },
	{ value: "We-לא-qatal", hint: "waw + לא + perfect" },
	{ value: "Yiqtol (indic)", hint: "imperfect (indicative)" },
	{ value: "X-yiqtol (indic)", hint: "non-verbal + imperfect (indicative)" },
	{ value: "We-X-yiqtol", hint: "waw + non-verbal + imperfect" },
	{ value: "Weyiqtol", hint: "waw + imperfect" },
	{ value: "We-לא-yiqtol", hint: "waw + לא + imperfect/jussive/cohortative" },
	{ value: "Yiqtol (jsv/chrt)", hint: "jussive/cohortative" },
	{ value: "X-yiqtol (juss/cohrt)", hint: "non-verbal + jussive/cohortative" },
	{ value: "Qetol", hint: "imperative" },
	{ value: "X-qetol", hint: "non-verbal + imperative" },
	{ value: "Weqetol", hint: "waw + imperative" },
	{ value: "We-X-qetol", hint: "waw + non-verbal + imperative" },
	{ value: "SNC", hint: "simple noun clause (implied היה, or participle)" },
	{ value: "We-SNC", hint: "waw + simple noun clause" },
	{ value: "SNC (ptc)", hint: "noun clause with participle" },
	{ value: "Ptc", hint: "participle (not a finite verb)" },
	{ value: "IC", hint: "infinitive construct (not a finite verb)" },
];

// Which Function of Communication section the 📖 button opens, from the
// pattern text (dropdown value or typed by hand) and the clause's text type.
// Mirrors the spreadsheet's hyperlink formula (whose Hx/Dx test pointed at
// the wrong row); patterns that only have a Dx section open that one.
export function referenceSectionFor(pattern: string, depth: number): string | null {
	const p = pattern.toLowerCase().replace(/[\s.()[\]]/g, "").replace(/^-+/, "");
	const tt = textType(depth) === "Hx" ? "hx" : "dx";
	if (!p) return null;
	if (p.includes("wayyiqtol")) return `wayyiqtol-${tt}`;
	if (/^we-?(לא-?)?qatal/.test(p)) return `weqatal-${tt}`;
	if (p.includes("qatal")) return `xqatal-${tt}`;
	if (p.includes("qetol") || p.includes("impv") || p.includes("imperative")) {
		return /x-?qetol/.test(p) ? "xqetol-dx" : "qetol-dx";
	}
	if (p.includes("yiqtol")) {
		if (/^we-?(לא-?)?yiqtol/.test(p)) return "weyiqtol-dx";
		if (/juss|cohort|cohrt|jsv|chrt/.test(p)) return "jussive-dx";
		return tt === "hx" ? "xyiqtol-hx" : "xyiqtol-dx";
	}
	if (p.includes("snc") || p.includes("ptc") || p.includes("nominal")) return `snc-${tt}`;
	return null;
}
