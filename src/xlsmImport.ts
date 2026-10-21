// Converts an OTHT "DA Template" Excel workbook (.xlsm/.xlsx) into .hda data.
//
// The workbook's layout:
//   'Distinguish Mainline'  A = Hebrew clause, K = English, rows 3+ (header
//                           rows repeat every page, e.g. 18-19)
//   'Don't Touch'           L = the radio-button level for that row (1-9)
//   'DA Worksheet'          A1 = "Ref Text <passage>", K = Conj,
//                           L = Predicate Pattern, N = Discourse Analysis
//
// Cached cell values are read (formulas aren't evaluated), which is what
// Excel last displayed. Plain-regex XML reading keeps this usable outside a
// browser (the import is tested from Node).

import { strFromU8, unzipSync } from "fflate";
import { Clause, HdaData, Line, collapse, emptyData, inferVerses, legacyIndent, levelFromSpreadsheet, newClause, startVerseOf } from "./model";

type Sheet = Map<string, string>; // "A3" -> text

function decodeXml(s: string): string {
	return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
		if (e[0] === "#") return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
		return ({ amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" } as Record<string, string>)[e];
	});
}

// Text of every <t> in a fragment, skipping phonetic runs (<rPh>).
function textOf(xml: string): string {
	const body = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
	let out = "";
	for (const m of body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += m[1] ? decodeXml(m[1]) : "";
	return out;
}

function parseSharedStrings(xml: string | null): string[] {
	if (!xml) return [];
	return [...xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map(m => (m[1] ? textOf(m[1]) : ""));
}

function parseSheet(xml: string, shared: string[]): Sheet {
	const cells: Sheet = new Map();
	for (const m of xml.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
		const attrs = m[1];
		const inner = m[2] || "";
		const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
		if (!ref) continue;
		const type = attrs.match(/\bt="(\w+)"/)?.[1];
		let value = "";
		if (type === "inlineStr") {
			value = textOf(inner.match(/<is>([\s\S]*?)<\/is>/)?.[1] || "");
		} else {
			// Text with leading/trailing spaces is stored as <v xml:space="preserve">.
			const v = inner.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1];
			if (v === undefined) continue;
			value = type === "s" ? shared[Number(v)] ?? "" : decodeXml(v);
		}
		if (value !== "") cells.set(ref, value);
	}
	return cells;
}

async function readSheets(zip: Record<string, Uint8Array>): Promise<Map<string, Sheet>> {
	const read = async (path: string) => (zip[path] ? strFromU8(zip[path]) : null);
	const workbook = await read("xl/workbook.xml");
	const rels = await read("xl/_rels/workbook.xml.rels");
	if (!workbook || !rels) throw new Error("This doesn't look like an Excel workbook.");
	const shared = parseSharedStrings(await read("xl/sharedStrings.xml"));

	const targets = new Map<string, string>();
	for (const m of rels.matchAll(/<Relationship\s([^>]*?)\/?>/g)) {
		const id = m[1].match(/\bId="([^"]+)"/)?.[1];
		const target = m[1].match(/\bTarget="([^"]+)"/)?.[1];
		if (id && target) targets.set(id, target.startsWith("/") ? target.slice(1) : "xl/" + target);
	}

	const sheets = new Map<string, Sheet>();
	for (const m of workbook.matchAll(/<sheet\s([^>]*?)\/?>/g)) {
		const name = decodeXml(m[1].match(/\bname="([^"]*)"/)?.[1] || "");
		const rid = m[1].match(/\br:id="([^"]+)"/)?.[1];
		const path = rid ? targets.get(rid) : undefined;
		const xml = path ? await read(path) : null;
		if (xml) sheets.set(name, parseSheet(xml, shared));
	}
	return sheets;
}

function maxRow(sheet: Sheet): number {
	let max = 0;
	for (const ref of sheet.keys()) max = Math.max(max, Number(ref.replace(/^[A-Z]+/, "")));
	return max;
}

function oldLevel(radio: number, leadingSpaces: number): { depth: number; line: Line; indent: number } {
	const base: Record<number, [number, number]> = { 1: [1, 2], 2: [1, 0], 3: [0, 1], 4: [0, 0] };
	const [depth, step] = base[radio] || base[4];
	// Steps within the text type, in the workbook's finer scheme
	// (Hx M O1 O2 O3; Dx M M2 O1 O2 O3).
	const last = depth === 0 ? 3 : 4;
	const idx = Math.min(last, step + Math.round(leadingSpaces / 5));
	const offline = depth === 0 ? idx > 0 : idx > 1;
	return { depth, line: offline ? "O" : "M", indent: legacyIndent(depth, "M") + idx };
}

export async function importWorkbook(buffer: ArrayBuffer | Uint8Array, fileName = ""): Promise<HdaData> {
	const zip = unzipSync(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer));
	const sheets = await readSheets(zip);
	const mainline = sheets.get("Distinguish Mainline");
	if (!mainline) throw new Error("No 'Distinguish Mainline' sheet found; is this a DA Template workbook?");
	const levels = sheets.get("Don't Touch") ?? new Map();
	const worksheet = sheets.get("DA Worksheet") ?? new Map();

	// The earlier template had four radio columns (Dx O, Dx M, Hx A/O, Hx M)
	// with English in F, stored each row's choice four rows down in
	// 'Don't Touch' L, and took deeper offline levels from spaces typed
	// before the Hebrew (about five per level).
	const oldTemplate = mainline.get("B2") === "O" && mainline.get("E2") === "M" && /^english/i.test(mainline.get("F1") || "");
	const englishCol = oldTemplate ? "F" : "K";

	const columnOf = (header: string, fallback: string): string => {
		for (const [ref, value] of worksheet) {
			if (/^[A-Z]+1$/.test(ref) && collapse(value).toLowerCase() === header) return ref.replace(/\d+$/, "");
		}
		return fallback;
	};
	const conjCol = columnOf("conj", "K");
	const patternCol = columnOf("predicate pattern", "L");
	const notesCol = columnOf("discourse analysis", "N");

	// Worksheet rows holding a clause (the old template double-spaces them),
	// matched to the clauses in order by their Hebrew text.
	const wsRows: { row: number; he: string }[] = [];
	for (let r = 3, last = maxRow(worksheet); r <= last; r++) {
		const he = collapse(worksheet.get(`A${r}`) || "");
		if (he) wsRows.push({ row: r, he });
	}
	let wsPointer = 0;
	const worksheetRowFor = (he: string): number | null => {
		for (let i = wsPointer; i < wsRows.length; i++) {
			if (wsRows[i].he.endsWith(he)) { wsPointer = i + 1; return wsRows[i].row; }
		}
		return null;
	};

	const clauses: Clause[] = [];
	const last = maxRow(mainline);
	for (let r = 3; r <= last; r++) {
		const rawHe = mainline.get(`A${r}`) || "";
		const he = collapse(rawHe);
		const en = collapse(mainline.get(`${englishCol}${r}`) || "");
		if (!he && !en) continue;
		const lvl = oldTemplate
			? oldLevel(Number(levels.get(`L${r + 4}`)) || 4, rawHe.length - rawHe.trimStart().length)
			: levelFromSpreadsheet(Number(levels.get(`L${r}`)) || 1);
		const wsRow = he ? worksheetRowFor(he) : null;
		const cell = (col: string) => (wsRow === null ? "" : collapse(worksheet.get(`${col}${wsRow}`) || ""));
		clauses.push(newClause({
			// The indent keeps the layout the workbook showed.
			he, en, ...lvl,
			conj: cell(conjCol),
			pattern: cell(patternCol),
			notes: cell(notesCol),
		}));
	}

	// "Ref Text Genesis 3:1-6", "Ref Text: Genesis 2:18-25", or just "MT";
	// then the file name ("DA of Genesis 3.1-6.xlsm"), then the old
	// template's A2 ("Gen. 1:1-5").
	const asPassage = (s: string): string => {
		const m = s.match(/([1-3]?\s?[A-Za-z]+)\.?\s+(\d+)[.:](\d+(?:\s*[-–]\s*\d+)?)/);
		return m ? `${m[1].trim()} ${m[2]}:${m[3].replace(/\s+/g, "")}` : "";
	};
	const refText = collapse((worksheet.get("A1") || "").replace(/^ref\s*text\s*:?/i, ""));
	const passage = (/\d/.test(refText) ? refText : "")
		|| asPassage(fileName.replace(/\.[^.]+$/, ""))
		|| asPassage(worksheet.get("A2") || "");
	inferVerses(clauses, startVerseOf(passage));

	return { ...emptyData(), passage, clauses };
}
