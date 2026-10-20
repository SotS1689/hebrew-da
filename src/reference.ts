// Reference content shown in the view's modals.
//
// FUNCTION_SECTIONS is the "Function of Communication" sheet from the DA
// Template workbook (OTHT I), which the spreadsheet's "?" links jumped into;
// spelling slips in the sheet are corrected. The method steps are a summary
// of J. Gibson's "Discourse Analysis of Hebrew Prose" notes, not a copy.

export interface FunctionGroup {
	kind: string;
	items: string[];
}

export interface FunctionSection {
	id: string;
	textType: "Hx" | "Dx";
	pattern: string;
	groups: FunctionGroup[];
}

export const FUNCTION_SECTIONS: FunctionSection[] = [
	// ---------- Historical narrative ----------
	{
		id: "wayyiqtol-hx", textType: "Hx", pattern: "Wayyiqtol",
		groups: [
			{ kind: "Mainline information", items: ["Begins/continues/concludes mainline narrative", "MSM: introduces protasis", "Apodosis (mainline related to preceding protasis)"] },
			{ kind: "Background information", items: ["Continues antecedent or background information"] },
		],
	},
	{
		id: "xqatal-hx", textType: "Hx", pattern: "[We][X]-qatal",
		groups: [
			{ kind: "Before wayyiqtol = Antecedent information", items: ["Past action (generally at beginning of narrative, thus marking paragraph boundary)"] },
			{ kind: "After wayyiqtol = Background information", items: ["Circumstantial comparison", "Circumstantial contrast", "Circumstantial focus", "Cause/Grounds", "Consequence", "Climactic marker (thus, the end of a paragraph boundary)", "Description/Activity (in a relative clause)"] },
		],
	},
	{
		id: "weqatal-hx", textType: "Hx", pattern: "Weqatal / We-לא-qatal",
		groups: [
			{ kind: "After wayyiqtol = Background information", items: ["Negated action to the mainline; habitual"] },
		],
	},
	{
		id: "xyiqtol-hx", textType: "Hx", pattern: "[We][X]-yiqtol (indicative)",
		groups: [
			{ kind: "Before wayyiqtol = Antecedent information", items: ["Repetitive action/habit (generally at the beginning of narrative, thus marks beginning of paragraph boundary)"] },
			{ kind: "After wayyiqtol = Background information", items: ["Repetitive action/habit"] },
			{ kind: "After wayyiqtol + IC = Background information", items: ["Complementary (following IC)"] },
		],
	},
	{
		id: "snc-hx", textType: "Hx", pattern: "[We]SNC",
		groups: [
			{ kind: "Before wayyiqtol = Antecedent information", items: ["Description (verbless: implied “to be”); action (ptc)", "Circumstance (comparison; contrast)"] },
			{ kind: "After wayyiqtol = Background information", items: ["Description (verbless: implied “to be”); action (ptc)", "Circumstance (identification/description)", "Circumstantial action (comparison; contrast)"] },
		],
	},
	// ---------- Direct speech ----------
	{
		id: "wayyiqtol-dx", textType: "Dx", pattern: "Wayyiqtol",
		groups: [
			{ kind: "Mainline information (after initial [X]-qatal)", items: ["Continues mainline of oral report"] },
		],
	},
	{
		id: "xqatal-dx", textType: "Dx", pattern: "[We][X]-qatal",
		groups: [
			{ kind: "Initial [X]-qatal = Mainline information", items: ["Begins oral report (thus marks beginning of paragraph boundary; usually follows a narrative wayyiqtol, followed by wayyiqtol, not weqatal)"] },
			{ kind: "After wayyiqtol = Background information", items: ["Circumstance (comparison; contrast with emphasis)"] },
			{ kind: "After qetol (impv) = Background information", items: ["Cause/Grounds (in a subordinate clause)"] },
			{ kind: "After X-yiqtol = Mainline information", items: ["Consequence: positive; negative consequence", "Climactic marker (thus marks the end of a paragraph boundary)"] },
			{ kind: "After SNC = Mainline information", items: ["Description/Activity (in a relative clause)"] },
		],
	},
	{
		id: "weqatal-dx", textType: "Dx", pattern: "Weqatal / We-לא-qatal",
		groups: [
			{ kind: "After initial [X]-qatal/wayyiqtol (oral report) = Background information", items: ["Result/Consequence: positive or negative"] },
			{ kind: "After SNC/[X][לא]-yiqtol (indicative) = Mainline information", items: ["Continues initial future prediction/possibility/promise/directive"] },
			{ kind: "After qetol/[X]-yiqtol (cohort/juss) = Mainline information", items: ["Continues command, exhortation, prohibition, or admonition", "Simultaneous/synonymous action", "Result/Consequence"] },
		],
	},
	{
		id: "jussive-dx", textType: "Dx", pattern: "[We][X]-yiqtol (cohort/juss)",
		groups: [
			{ kind: "Initial [X]-yiqtol (cohort/juss) = Mainline information", items: ["Initiates command, exhortation, prohibition, or admonition (marks beginning of paragraph boundary)", "Comparison/contrast (emphasis)", "Purpose weyiqtol (cohort/juss)"] },
			{ kind: "After weyiqtol = Background information", items: ["Circumstance (repeated action/habit)"] },
		],
	},
	{
		id: "weyiqtol-dx", textType: "Dx", pattern: "Weyiqtol / We-לא-yiqtol (indicative/cohort/juss)",
		groups: [
			{ kind: "After qetol (imperative), weyiqtol (cohort/juss) or weqatal = Mainline information", items: ["Continues mainline prediction, possibility, promise, directive, or permission", "Continues command, exhortation, prohibition, or admonition", "Purpose weyiqtol (indicative): positive or negative (We-לא-yiqtol)", "Purpose weyiqtol (cohort/juss)"] },
			{ kind: "After [X]-yiqtol = Mainline information", items: ["Purpose"] },
		],
	},
	{
		id: "xyiqtol-dx", textType: "Dx", pattern: "[We][X]-yiqtol (indicative)",
		groups: [
			{ kind: "Initial [X]- or [לא]-yiqtol = Mainline or Background information", items: ["Future prediction, possibility, promise, directive, or permission", "Question (we-X-yiqtol)", "Purpose: positive or negative", "Protasis (X-yiqtol)"] },
			{ kind: "After wayyiqtol (oral report) = Background information", items: ["Circumstance (repeated action/habit)", "Climactic marker"] },
			{ kind: "After weqatal or [X]-qetol = Background information", items: ["Circumstance (repeated action/habit)", "Comparative/contrastive prediction or promise", "Circumstantial specification", "Future prediction, possibility, promise, or directive", "Climactic marker"] },
		],
	},
	{
		id: "qetol-dx", textType: "Dx", pattern: "[We]qetol (imperative)",
		groups: [
			{ kind: "Initial qetol = Mainline information", items: ["Initiates command, exhortation, prohibition, or admonition (marks beginning of paragraph boundary)"] },
			{ kind: "Qetol chain (qetol + weqetol) = Mainline information", items: ["Continues command, exhortation, prohibition, or admonition", "Result/consequence"] },
			{ kind: "After weyiqtol", items: ["Result/consequence"] },
		],
	},
	{
		id: "xqetol-dx", textType: "Dx", pattern: "[We][X]-qetol",
		groups: [
			{ kind: "After [X]-yiqtol (cohort/juss) or initial qetol = Background information", items: ["Comparison/contrast (emphasis)"] },
		],
	},
	{
		id: "snc-dx", textType: "Dx", pattern: "[We]SNC",
		groups: [
			{ kind: "Initial SNC and continuation SNC (present) = Mainline information", items: ["Begins/continues mainline description (verbless: implied “to be”); action (ptc)"] },
			{ kind: "After wayyiqtol (past) = Background information", items: ["Description (verbless: implied “to be”); action (ptc)", "Circumstantial action/description (comparison; contrast)"] },
			{ kind: "Initial SNC (future) (if followed by weqatal) = Mainline information", items: ["Future prediction, possibility or promise"] },
			{ kind: "After mainline SNC (present) = Background information", items: ["Description (verbless: implied “to be”); action (ptc)", "Comparison/contrast"] },
			{ kind: "After qetol/weyiqtol, or after weqatal = Background information", items: ["Complement (with verbs of perception)"] },
		],
	},
];

// ---------- Instructions (method) ----------

export interface InstructionBlock {
	h?: string;
	p?: string;
	steps?: { title: string; sub?: string[] }[];
	table?: string[][];
}

export const METHOD_SOURCE = "Summarized from J. Gibson, “Discourse Analysis of Hebrew Prose” (OTHT I notes).";

export const METHOD_INSTRUCTIONS: InstructionBlock[] = [
	{ h: "What this is for" },
	{ p: "Text-linguistic discourse analysis works bottom-up: from the form of each clause to how clauses relate, then to units of clauses and the phases of a narrative. The key question is how verb-first (V-X) clauses relate to clauses where something comes before the verb (X-V), within the two text types: historical narrative (Hx) and direct speech (Dx)." },
	{ h: "Steps" },
	{
		steps: [
			{ title: "Divide the text into clauses.", sub: ["Put purpose or appositional phrases on their own line when it helps. Press Enter in a Hebrew cell to split a clause there."] },
			{ title: "Record the conjunction (or Ø for asyndeton) at the start of each clause." },
			{ title: "Identify the predicate pattern.", sub: ["e.g. wayyiqtol, weyiqtol, weqatal, we(X)-qatal, we(X)-yiqtol, SNC."] },
			{ title: "Identify the text type: Hx or Dx.", sub: ["Set it with the clause's level badge: Hx levels are narrative, Dx levels are speech, Dx² is speech quoted inside speech."] },
			{ title: "Describe each clause's function relative to its neighbours.", sub: ["Unmarked = mainline; marked = antecedent or offline/background information. The 📖 button opens the matching part of the Function of Communication chart."] },
			{ title: "Note discourse markers.", sub: ["הנה, ועתה, casus pendens, embedded direct speech (primary/secondary), and the macro-syntactic markers ויהי / והיה introducing a protasis–apodosis."] },
			{ title: "Define the external and internal boundaries of the unit." },
		],
	},
	{ h: "Predicate pattern key" },
	{
		table: [
			["Wayyiqtol", "waw consecutive + imperfect"],
			["Qatal", "perfect"],
			["X-qatal", "non-verbal element + perfect"],
			["Weqatal", "waw consecutive + perfect"],
			["We-X-qatal", "waw + non-verbal element + perfect"],
			["Yiqtol (indic)", "imperfect (indicative)"],
			["Yiqtol (jsv/chrt)", "jussive/cohortative"],
			["X-yiqtol", "non-verbal element + imperfect"],
			["Weyiqtol", "waw + imperfect (not consecutive)"],
			["Qetol", "imperative"],
			["SNC", "simple noun clause (implied היה, or a participle conveys the action)"],
			["Ptc / IC", "participle / infinitive construct (not finite verbs)"],
		],
	},
];

// ---------- "?" help: using the tool ----------

export const TOOL_HELP: { h: string; items: string[] }[] = [
	{ h: "Getting text in", items: [
		"Paste the Hebrew into the sidebar and click <b>Insert</b>: one clause per line. Leading verse numbers are picked up; if the passage has a reference (e.g. Genesis 3:1-6), verses are numbered from the sof pasuq (׃).",
		"To fill in the English, paste several lines into a clause's English cell: they fill that clause and the ones below it, one line each.",
		"<b>Import Excel workbook</b> (command palette) converts your old .xlsm DA worksheets.",
	] },
	{ h: "Editing clauses", items: [
		"<kbd>Enter</kbd> in a Hebrew cell splits the clause at the cursor; <kbd>Backspace</kbd> at the start of a clause joins it to the one above.",
		"<kbd>Tab</kbd> / <kbd>Shift+Tab</kbd> indent / outdent a clause (the Hebrew from the right, the English from the left). With several clauses selected, all of them move.",
		"Click a clause's level badge to set its level (Hx or Dx, mainline or offline). The level is a label only; it doesn't change the indent.",
		"<kbd>Ctrl+↑</kbd> / <kbd>Ctrl+↓</kbd> go to the clause above/below; <kbd>Alt+↑</kbd> / <kbd>Alt+↓</kbd> move the clause up/down.",
		"Click a verse label to select a clause (<kbd>Shift</kbd>/<kbd>Ctrl</kbd>-click for several); double-click it to set the verse number. <kbd>Delete</kbd> removes the selected clauses.",
	] },
	{ h: "Analysis columns", items: [
		"Conj is a plain text box that types Hebrew phonetically: <kbd>a</kbd>א <kbd>b</kbd>ב <kbd>g</kbd>ג <kbd>d</kbd>ד <kbd>h</kbd>ה <kbd>w</kbd>/<kbd>v</kbd>ו <kbd>z</kbd>ז <kbd>x</kbd>ח <kbd>T</kbd>ט <kbd>y</kbd>/<kbd>i</kbd>י <kbd>k</kbd>כ <kbd>l</kbd>ל <kbd>m</kbd>מ <kbd>n</kbd>נ <kbd>S</kbd>ס <kbd>e</kbd>/<kbd>o</kbd>ע <kbd>p</kbd>/<kbd>f</kbd>פ <kbd>c</kbd>צ <kbd>q</kbd>ק <kbd>r</kbd>ר <kbd>s</kbd>ש <kbd>t</kbd>ת, <kbd>0</kbd> = Ø (asyndeton), <kbd>-</kbd> = maqaf. Final forms (ך ם ן ף ץ) are added automatically at the end of a word. e.g. <kbd>asr</kbd> → אשר, <kbd>ky</kbd> → כי, <kbd>pn</kbd> → פן.",
		"Predicate Pattern offers the standard patterns as you type, but accepts anything you write.",
		"📖 (top right) opens the Function of Communication chart at the section for the clause you last clicked in, using its pattern and text type. Click a function there to add it to that clause's Discourse Analysis.",
	] },
	{ h: "Story tab", items: [
		"The <b>Story</b> tab lays the passage's plot out as blocks on a canvas. Each block has its verses, a title, a teaching point under the title, its function (rising action, climax…), and boxes for characters, location, time and imagery.",
		"<b>+ Block</b> adds a block to the right of the selected one; double-clicking the canvas adds one there. Drag a block by its header to move it, and its bottom-right corner to make it wider.",
		"Drag from one of the dots on a block's edges to another block to draw an arrow. Click an arrow to select it, double-click it to give it a label, right-click to reverse or delete it. <kbd>Delete</kbd> removes the selected block or arrow.",
		"Function: type your own, or pick one from the block's ▾ menu; the block is colored by its function. <kbd>Enter</kbd> moves from verses to function to title; in the teaching point and the boxes below it, <kbd>Enter</kbd> starts a new line and <kbd>Ctrl+Enter</kbd> moves on.",
		"Drag the empty canvas to move the view (it has no edges, so the blocks can be brought anywhere at any zoom); the mouse wheel moves it too, <kbd>Shift</kbd>+wheel sideways. <kbd>Ctrl</kbd>+scroll zooms around the pointer; <b>Fit</b> shows every block. 📷 on this tab saves a PNG of the whole story chart.",
	] },
	{ h: "View", items: [
		"Zoom with the toolbar or <kbd>Ctrl</kbd>+scroll. <b>Guides</b> shows the indent columns; <b>Columns</b> hides or shows Conj, Pattern, Analysis and English.",
		"<kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Y</kbd> undo and redo. 📷 saves a PNG of the worksheet next to the file.",
	] },
];
