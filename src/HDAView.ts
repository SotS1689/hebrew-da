import { addIcon, App, Menu, Modal, Notice, TextFileView, TFile, WorkspaceLeaf } from "obsidian";
import html2canvas from "html2canvas";
import {
	Clause, DEPTH_NAMES, HdaColumns, HdaData, HdaTab, STORY_FUNCTIONS, LINE_NAMES, Line, MAX_DEPTH, MAX_INDENT, PREDICATE_PATTERNS,
	computeLabels, depthLabel, emptyData, normalizeStory, inferVerses, levelLabel, linesFor, newClause, normalizeData,
	referenceSectionFor, splitPasted, startVerseOf, textType, toHebrewConj,
} from "./model";
import { StoryBoard } from "./StoryBoard";
import { FUNCTION_SECTIONS, InstructionBlock, METHOD_INSTRUCTIONS, TOOL_HELP } from "./reference";

export const VIEW_TYPE_HDA = "hebrew-da-view";
export const SUPPORT_URL = "https://buymeacoffee.com/reformedretrieval";

// Ribbon / tab icon: a bold vav, the clause connector the method starts from.
export const HDA_ICON = "hebrew-da-vav";
addIcon(HDA_ICON, `<text x="50" y="52" text-anchor="middle" dominant-baseline="central" font-size="90" font-weight="bold" font-family="SBL Hebrew, Times New Roman, serif" fill="currentColor">ו</text>`);

// ---------- settings shared with main.ts ----------

export const COLOR_THEMES: { id: string; label: string }[] = [
	{ id: "standard", label: "Standard" },
	{ id: "obsidian", label: "Theme" },
	{ id: "blue", label: "Blue" },
	{ id: "yellow", label: "Yellow" },
	{ id: "red", label: "Red" },
	{ id: "green", label: "Green" },
	{ id: "purple", label: "Purple" },
	{ id: "cream", label: "Cream" },
];

export function colorThemeClasses(theme: string): string[] {
	if (theme === "obsidian") return ["hda-theme-adopt"];
	if (theme !== "standard" && COLOR_THEMES.some(t => t.id === theme)) return [`hda-scheme-${theme}`];
	return [];
}
const ALL_COLOR_THEME_CLASSES = COLOR_THEMES.flatMap(t => colorThemeClasses(t.id));

export const UI_SCALE_STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5];

export type ColorMode = "auto" | "light" | "dark";

export interface HdaSettings {
	colorTheme: string;
	// Light/dark: "auto" follows Obsidian's own mode.
	mode: ColorMode;
	uiScale: number;
	hebrewFont: string;
	// Hebrew text size relative to the English (1 = same size).
	hebrewScale: number;
	// Width of one indent level, in em of the worksheet's base font.
	indentStep: number;
	showGuides: boolean;
	columns: HdaColumns;
	sidebarHidden: boolean;
}

export const DEFAULT_HEBREW_FONT = `"SBL Hebrew", "SBL BibLit", "Ezra SIL", "Taamey Frank CLM", "Times New Roman", serif`;

export function defaultSettings(): HdaSettings {
	return {
		colorTheme: "standard",
		mode: "auto",
		uiScale: 1,
		hebrewFont: DEFAULT_HEBREW_FONT,
		hebrewScale: 1.35,
		indentStep: 1.6,
		showGuides: true,
		columns: { conj: true, pattern: true, notes: true, english: true },
		sidebarHidden: false,
	};
}

export interface HdaPluginHost {
	app: App;
	settings: HdaSettings;
	saveSettings(): Promise<void>;
	refreshAllViews(): void;
	// The web version downloads the file instead of saving into a vault.
	saveButton?(view: HDAView): void;
}

// ---------- small helpers ----------

class ConfirmModal extends Modal {
	constructor(app: App, private message: string, private onConfirm: () => void) { super(app); }
	onOpen(): void {
		this.contentEl.createEl("p", { text: this.message });
		const row = this.contentEl.createDiv({ cls: "hda-prompt-buttons hda-prompt-buttons-gap" });
		row.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		const ok = row.createEl("button", { text: "Confirm", cls: "mod-warning" });
		ok.addEventListener("click", () => { this.close(); this.onConfirm(); });
	}
	onClose(): void { this.contentEl.empty(); }
}

// Caret position inside a plain-text contenteditable, as text offsets.
function caretRange(el: HTMLElement): { start: number; end: number } | null {
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return null;
	const range = sel.getRangeAt(0);
	const pre = document.createRange();
	pre.selectNodeContents(el);
	pre.setEnd(range.startContainer, range.startOffset);
	const start = pre.toString().length;
	pre.setEnd(range.endContainer, range.endOffset);
	return { start, end: pre.toString().length };
}

function setCaret(el: HTMLElement, offset: number): void {
	const sel = window.getSelection();
	if (!sel) return;
	const range = document.createRange();
	let remaining = offset;
	const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
	let node: Node | null = walker.nextNode();
	while (node) {
		const len = node.textContent?.length ?? 0;
		if (remaining <= len) {
			range.setStart(node, remaining);
			range.collapse(true);
			sel.removeAllRanges();
			sel.addRange(range);
			return;
		}
		remaining -= len;
		node = walker.nextNode();
	}
	range.selectNodeContents(el);
	range.collapse(false);
	sel.removeAllRanges();
	sel.addRange(range);
}

function cellText(el: HTMLElement): string {
	return (el.textContent || "").replace(/\n/g, " ");
}

// Renders the help strings' <b>…</b> and <kbd>…</kbd> markup.
function appendMarkup(parent: HTMLElement, text: string): void {
	const re = /<(b|kbd)>(.*?)<\/\1>/g;
	let last = 0;
	for (const m of text.matchAll(re)) {
		if (m.index! > last) parent.appendText(text.slice(last, m.index));
		parent.createEl(m[1] as "b" | "kbd", { text: m[2] });
		last = m.index! + m[0].length;
	}
	if (last < text.length) parent.appendText(text.slice(last));
}

// html2canvas can't read the color(srgb ...) values Chromium now reports
// for color-mix(); before a capture, the copy's colors are rewritten as rgba.
const COLOR_PROPS = ["color", "background-color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "outline-color", "box-shadow", "fill", "stroke"];
function srgbToRgba(value: string): string {
	return value.replace(/color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.e-]+%?))?\)/g, (_m, r, g, b, a) => {
		const c = (v: string) => Math.round(Math.min(1, Math.max(0, Number(v))) * 255);
		const alpha = a === undefined ? 1 : a.endsWith("%") ? Number(a.slice(0, -1)) / 100 : Number(a);
		return `rgba(${c(r)}, ${c(g)}, ${c(b)}, ${alpha})`;
	});
}
function plainColors(root: HTMLElement): void {
	const view = root.ownerDocument.defaultView;
	if (!view) return;
	for (const el of [root, ...Array.from(root.querySelectorAll<HTMLElement | SVGElement>("*"))]) {
		const cs = view.getComputedStyle(el);
		for (const prop of COLOR_PROPS) {
			const v = cs.getPropertyValue(prop);
			if (v.includes("color(")) el.style.setProperty(prop, srgbToRgba(v));
		}
	}
}

type Field = "he" | "en" | "notes" | "conj" | "pattern";
const TEXT_FIELDS: Field[] = ["he", "conj", "pattern", "notes", "en"];

const HISTORY_LIMIT = 200;
const TYPING_IDLE_MS = 1000;
const BASE_FONT_PX = 15;

interface SuggestState {
	input: HTMLTextAreaElement;
	clauseId: string;
	options: { value: string; hint?: string }[];
	active: number;
	typed: boolean;
}

export class HDAView extends TextFileView {
	plugin: HdaPluginHost;
	private doc: HdaData = emptyData();
	private unreadableData: string | null = null;
	private loaded = false;
	private domBuilt = false;

	private selected = new Set<string>();
	private anchorId: string | null = null;

	private history: string[] = [];
	private redoStack: string[] = [];
	private snapshot = "";
	private typingTimer: number | null = null;

	private suggest: SuggestState | null = null;
	private wheelAccum = 0;
	// Body classes copied onto the view for the Theme palette's other mode.
	private mirroredClasses: string[] = [];
	// The clause last clicked or typed in, for the 📖 button.
	private currentClauseId: string | null = null;

	private rowsEl!: HTMLElement;
	private gridEl!: HTMLElement;
	private canvasEl!: HTMLElement;
	private suggestEl!: HTMLElement;
	private passageInput!: HTMLInputElement;
	private zoomLabel!: HTMLElement;
	private storyZoomLabel!: HTMLElement;
	private story!: StoryBoard;

	constructor(leaf: WorkspaceLeaf, plugin: HdaPluginHost) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return VIEW_TYPE_HDA; }
	getDisplayText(): string { return this.file?.basename ?? "Hebrew DA"; }
	getIcon(): string { return HDA_ICON; }

	// ---------- TextFileView contract ----------

	getViewData(): string {
		if (this.unreadableData !== null) return this.unreadableData;
		return JSON.stringify({ ...this.doc, timestamp: new Date().toISOString() }, null, 2);
	}

	setViewData(text: string, clear: boolean): void {
		this.unreadableData = null;
		let parsed: unknown = {};
		if (text && text.trim()) {
			try {
				parsed = JSON.parse(text);
			} catch (e) {
				console.error("Hebrew DA: failed to parse file contents.", e);
				// Keep the damaged text untouched rather than overwrite it.
				this.unreadableData = text;
				new Notice(`Hebrew DA couldn't read "${this.file?.name ?? "this file"}". It has been left unchanged; edits made here won't be saved until it's fixed.`, 12000);
			}
		}
		this.doc = normalizeData(parsed);
		this.selected.clear();
		this.anchorId = null;
		this.history = [];
		this.redoStack = [];
		this.snapshot = this.serializeState();
		this.loaded = true;
		if (this.domBuilt) this.renderAll();
	}

	clear(): void {
		this.doc = emptyData();
		this.selected.clear();
		this.history = [];
		this.redoStack = [];
		this.unreadableData = null;
	}

	async onOpen(): Promise<void> {
		this.buildDom();
		this.refreshTheming();
		if (this.loaded) this.renderAll();
		this.registerEvent(this.app.workspace.on("quit", tasks => { tasks.addPromise(this.save()); }));
	}

	async onClose(): Promise<void> {
		this.flushTyping();
		this.domBuilt = false;
		this.contentEl.empty();
	}

	// ---------- theming ----------

	refreshTheming(): void {
		const s = this.plugin.settings;
		const root = this.contentEl;
		root.classList.remove(...ALL_COLOR_THEME_CLASSES, ...this.mirroredClasses, "hda-standard", "hda-dark", "theme-dark", "theme-light");
		this.mirroredClasses = [];
		root.classList.add(...colorThemeClasses(s.colorTheme));
		const dark = this.isDark();
		root.toggleClass("hda-dark", dark);
		if (s.colorTheme === "standard" || !COLOR_THEMES.some(t => t.id === s.colorTheme)) root.addClass("hda-standard");
		// Theme colors come from Obsidian's variables, which the view inherits
		// as-is while it's in Obsidian's own mode. Only when the switch picks
		// the other mode does the view get that mode's class, plus copies of
		// the body's classes: themes key their palettes on body classes
		// (e.g. AnuPpuccin's ".theme-dark.ctp-frappe", set by Style
		// Settings), so the bare mode class alone would give the theme's
		// default colors instead of the chosen ones.
		const bodyDark = document.body.classList.contains("theme-dark");
		if (s.colorTheme === "obsidian" && dark !== bodyDark) {
			this.mirroredClasses = Array.from(document.body.classList).filter(c => c !== "theme-dark" && c !== "theme-light" && !root.classList.contains(c));
			root.classList.add(...this.mirroredClasses, dark ? "theme-dark" : "theme-light");
		}
		const sw = root.querySelector<HTMLElement>(".hda-mode-switch .da-switch");
		if (sw) {
			sw.toggleClass("da-switch-on", !dark);
			sw.setAttr("aria-checked", String(!dark));
		}
		root.style.setProperty("--da-ui-scale", String(s.uiScale || 1));
		root.style.setProperty("--hda-font-he", s.hebrewFont || DEFAULT_HEBREW_FONT);
		root.style.setProperty("--hda-he-scale", String(s.hebrewScale || 1.35));
		root.toggleClass("hda-sidebar-hidden", !!s.sidebarHidden);
		const sel = root.querySelector<HTMLSelectElement>(".da-theme-select");
		if (sel) sel.value = s.colorTheme;
		if (this.domBuilt) this.renderAll();
	}

	private isDark(): boolean {
		const mode = this.plugin.settings.mode;
		return mode === "dark" || (mode !== "light" && document.body.classList.contains("theme-dark"));
	}

	// ---------- DOM construction ----------

	private buildDom(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("hda-view");
		this.domBuilt = true;

		// Header
		const header = root.createDiv({ cls: "da-header da-ui-scaled" });
		const left = header.createDiv({ cls: "da-header-left" });
		left.createDiv({ cls: "da-logo hda-logo", text: "ו" });
		left.createEl("h1", { cls: "da-title", text: "Hebrew Discourse Analysis" });
		const right = header.createDiv({ cls: "da-header-right" });
		this.button(right, "💾", "da-btn da-btn-primary", "Save", () => {
			if (this.plugin.saveButton) { this.plugin.saveButton(this); return; }
			void this.save();
			new Notice("Saved");
		});
		this.button(right, "📖", "da-btn", "Function of Communication (opens at the section for the clause you're working in)", () => this.openReferenceForCurrent());
		this.button(right, "📷", "da-btn", "Export PNG of the current tab", () => { void this.exportPng(); });
		const themeSel = right.createEl("select", { cls: "da-theme-select", attr: { title: "Color theme", "aria-label": "Color theme" } });
		for (const t of COLOR_THEMES) themeSel.createEl("option", { text: t.label, attr: { value: t.id } });
		themeSel.value = this.plugin.settings.colorTheme;
		themeSel.addEventListener("change", async () => {
			this.plugin.settings.colorTheme = themeSel.value;
			await this.plugin.saveSettings();
			this.plugin.refreshAllViews();
		});
		// Light/dark switch, as in DA-Tool's web version (on = light).
		const modeWrap = right.createDiv({ cls: "hda-mode-switch", attr: { title: "Light / dark mode" } });
		modeWrap.createSpan({ cls: "hda-mode-icon", text: "🌙" });
		const modeBtn = modeWrap.createEl("button", { cls: "da-switch", attr: { role: "switch", "aria-label": "Light mode" } });
		modeBtn.createSpan({ cls: "da-switch-thumb" });
		modeWrap.createSpan({ cls: "hda-mode-icon", text: "☀️" });
		modeBtn.addEventListener("click", async () => {
			this.plugin.settings.mode = this.isDark() ? "light" : "dark";
			await this.plugin.saveSettings();
			this.plugin.refreshAllViews();
		});
		const support = right.createEl("button", { cls: "da-btn da-btn-support", attr: { title: "Support this tool (Buy Me a Coffee)" } });
		// Coffee mug icon, same as DA-Tool's and BibleSearch's Support button.
		support.createSvg("svg", { cls: "da-support-icon", attr: { viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": "true" } }, svg => {
			svg.createSvg("path", { attr: { d: "M2 21h18a1 1 0 0 1 0 2H2a1 1 0 0 1 0-2zM20.242 11.022a1 1 0 0 0-.242-.688 2.99 2.99 0 0 0-2-.734H16V6a3 3 0 0 0-3-3H5a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-2.022h2a3 3 0 0 0 3-3V11.02a1 1 0 0 0-.758-.998zM14 16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v10zm4-4.022V11.6h-2v-2h2a1 1 0 0 1 1 1v1.378a1 1 0 0 1-1 1z" } });
		});
		support.createSpan({ text: "Support" });
		support.addEventListener("click", () => window.open(SUPPORT_URL, "_blank"));

		// Tab strip + toolbar
		const strip = root.createDiv({ cls: "da-tab-strip da-ui-scaled" });
		const tabs = strip.createDiv({ cls: "da-tab-strip-tabs" });
		const sideBtn = tabs.createEl("button", { cls: "da-sidebar-toggle", attr: { title: "Show/hide sidebar", "aria-label": "Show/hide sidebar" } });
		sideBtn.createSvg("svg", { cls: "da-btn-icon", attr: { viewBox: "0 0 22 22", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round" } }, svg => {
			svg.createSvg("rect", { attr: { x: "3", y: "4", width: "16", height: "14", rx: "2" } });
			svg.createSvg("line", { attr: { x1: "8.5", y1: "4", x2: "8.5", y2: "18" } });
		});
		sideBtn.addEventListener("click", () => this.toggleSidebar());
		for (const [tab, name, title] of [["prose", "Analysis", "Clause worksheet"], ["story", "Story", "Story analysis: plot blocks on a canvas"]] as [HdaTab, string, string][]) {
			const b = this.button(tabs, name, "da-tab-btn", title, () => this.setTab(tab));
			b.dataset.tab = tab;
		}

		const toolbar = strip.createDiv({ cls: "da-tab-toolbar hda-toolbar-prose" });
		this.button(toolbar, "+ Clause", "da-btn da-btn-primary da-btn-icon-only", "Add a clause after the selection (or at the end)", () => this.addClause());
		this.button(toolbar, "↶", "da-btn da-btn-icon-only", "Undo (Ctrl+Z)", () => this.undo());
		this.button(toolbar, "↷", "da-btn da-btn-icon-only", "Redo (Ctrl+Y)", () => this.redo());
		const zoomRow = toolbar.createDiv({ cls: "da-zoom-row" });
		this.button(zoomRow, "−", "da-btn da-btn-icon-only", "Zoom out", () => this.setZoom(this.doc.zoomLevel - 0.1));
		this.zoomLabel = zoomRow.createSpan({ cls: "da-zoom-label", text: "100%" });
		this.button(zoomRow, "+", "da-btn da-btn-icon-only", "Zoom in", () => this.setZoom(this.doc.zoomLevel + 0.1));
		this.button(zoomRow, "↺", "da-btn da-btn-icon-only", "Reset zoom", () => this.setZoom(1));
		const guidesBtn = this.button(toolbar, "Guides", "da-btn da-btn-icon-only hda-toggle-btn", "Show the indent columns", async () => {
			this.plugin.settings.showGuides = !this.plugin.settings.showGuides;
			await this.plugin.saveSettings();
			this.plugin.refreshAllViews();
		});
		guidesBtn.addClass("hda-guides-btn");
		this.button(toolbar, "Columns ▾", "da-btn da-btn-icon-only", "Show or hide columns", (e) => this.openColumnsMenu(e as MouseEvent));
		this.button(toolbar, "Clear All", "da-btn da-btn-danger", "Remove every clause", () => {
			new ConfirmModal(this.app, "Remove every clause from this analysis? (You can undo this.)", () => {
				this.change(() => { this.doc.clauses = []; this.selected.clear(); });
			}).open();
		});
		this.button(toolbar, "Instructions", "da-btn", "Discourse analysis of Hebrew prose: the method", () => this.openInstructions());
		this.button(toolbar, "?", "da-btn da-btn-icon-only", "Using this tool", () => this.openHelp());

		const storyBar = strip.createDiv({ cls: "da-tab-toolbar hda-toolbar-story" });
		this.button(storyBar, "+ Block", "da-btn da-btn-primary da-btn-icon-only", "Add a story block (to the right of the selected one)", () => this.story.addBlock());
		this.button(storyBar, "↶", "da-btn da-btn-icon-only", "Undo (Ctrl+Z)", () => this.undo());
		this.button(storyBar, "↷", "da-btn da-btn-icon-only", "Redo (Ctrl+Y)", () => this.redo());
		const storyZoom = storyBar.createDiv({ cls: "da-zoom-row" });
		this.button(storyZoom, "−", "da-btn da-btn-icon-only", "Zoom out", () => this.setStoryZoom(this.doc.story.zoom - 0.1));
		this.storyZoomLabel = storyZoom.createSpan({ cls: "da-zoom-label", text: "100%" });
		this.button(storyZoom, "+", "da-btn da-btn-icon-only", "Zoom in", () => this.setStoryZoom(this.doc.story.zoom + 0.1));
		this.button(storyZoom, "↺", "da-btn da-btn-icon-only", "Reset zoom", () => this.setStoryZoom(1));
		this.button(storyZoom, "Fit", "da-btn da-btn-icon-only", "Zoom and move the view to show every block", () => {
			this.story.fit();
			this.storyZoomLabel.setText(`${Math.round(this.doc.story.zoom * 100)}%`);
		});
		this.button(storyBar, "Clear All", "da-btn da-btn-danger", "Remove every story block", () => {
			new ConfirmModal(this.app, "Remove every story block and connection? (You can undo this.)", () => this.story.clearAll()).open();
		});
		this.button(storyBar, "?", "da-btn da-btn-icon-only", "Using this tool", () => this.openHelp());

		// Body: sidebar + canvas
		const body = root.createDiv({ cls: "da-body" });
		const side = body.createDiv({ cls: "da-sidebar da-sidebar-left hda-sidebar da-ui-scaled" });
		const sideHead = side.createDiv({ cls: "da-sidebar-header hda-side-prose" });

		sideHead.createEl("h2", { cls: "da-section-title", text: "Passage" });
		this.passageInput = sideHead.createEl("input", { cls: "hda-passage-input", attr: { type: "text", placeholder: "e.g. Genesis 3:1-6" } });
		this.passageInput.addEventListener("input", () => {
			this.beginTyping();
			this.doc.passage = this.passageInput.value;
			this.renderPassageTitle();
			this.typed();
		});

		sideHead.createEl("h2", { cls: "da-section-title hda-section-gap", text: "Hebrew" });
		const heArea = sideHead.createEl("textarea", { cls: "da-textarea hda-paste-he", attr: { rows: "4", dir: "auto", lang: "he", placeholder: "Paste the Hebrew passage (one clause or verse per line)…" } });
		const heRow = sideHead.createDiv({ cls: "da-row-gap" });
		this.button(heRow, "Insert", "da-btn da-btn-primary da-flex1", "Add these lines as clauses", () => {
			if (this.insertHebrew(heArea.value)) heArea.value = "";
		});
		this.button(heRow, "+", "da-btn-square", "Add an empty clause", () => this.addClause());

		const legend = side.createDiv({ cls: "hda-legend hda-side-prose" });
		legend.createEl("h2", { cls: "da-section-title", text: "Levels" });
		for (let d = 0; d <= MAX_DEPTH; d++) {
			const item = legend.createDiv({ cls: "hda-legend-item" });
			item.createSpan({ cls: `hda-level hda-d${d}`, text: depthLabel(d) });
			item.createSpan({ text: DEPTH_NAMES[d] });
		}
		const lines = legend.createDiv({ cls: "hda-legend-lines" });
		lines.setText("M = mainline · M2 = second mainline (Dx) · O1–O3 = offline. Click a clause's badge to set its level; Tab / Shift+Tab indents it.");

		const storySide = side.createDiv({ cls: "hda-legend hda-side-story" });
		storySide.createEl("h2", { cls: "da-section-title", text: "Functions" });
		STORY_FUNCTIONS.forEach((f, i) => {
			const item = storySide.createDiv({ cls: "hda-legend-item", attr: { title: f.hint } });
			item.createSpan({ cls: "hds-swatch", attr: { style: `background: var(--hds-fn-${i})` } });
			item.createSpan({ text: f.value });
		});
		storySide.createDiv({ cls: "hda-legend-lines", text: "Type any function, or pick one from a block's ▾. The block's color follows it." });
		storySide.createEl("h2", { cls: "da-section-title hda-section-gap", text: "Canvas" });
		const tips = storySide.createEl("ul", { cls: "hds-tips" });
		for (const t of [
			"Double-click the canvas to add a block there.",
			"Drag a block by its header; drag the corner to resize it.",
			"Drag from a dot on a block's edge to another block to connect them.",
			"Click an arrow to select it; double-click to label it; right-click for more.",
			"Delete removes the selected block or arrow. Drag the background to pan.",
		]) tips.createEl("li", { text: t });

		this.canvasEl = body.createDiv({ cls: "hda-canvas" });
		this.gridEl = this.canvasEl.createDiv({ cls: "hda-grid" });
		this.rowsEl = this.gridEl;

		this.story = new StoryBoard(body, {
			story: () => this.doc.story,
			change: fn => this.change(fn),
			beginTyping: () => this.beginTyping(),
			typed: () => this.typed(),
			viewChanged: () => this.requestSave(),
		});

		this.suggestEl = root.createDiv({ cls: "hda-suggest" });
		this.suggestEl.hide();

		this.wireEvents();
	}

	private button(parent: HTMLElement, text: string, cls: string, title: string, onClick: (e: Event) => void): HTMLButtonElement {
		const b = parent.createEl("button", { cls, text, attr: { title, "aria-label": title } });
		b.addEventListener("click", onClick);
		return b;
	}

	private setTab(tab: HdaTab): void {
		if (this.doc.tab === tab) return;
		this.flushTyping();
		this.hideSuggest();
		this.doc.tab = tab;
		this.requestSave();
		this.renderAll();
	}

	private setStoryZoom(z: number, at?: { clientX: number; clientY: number }): void {
		this.story.setZoom(z, at);
		this.storyZoomLabel.setText(`${Math.round(this.doc.story.zoom * 100)}%`);
	}

	toggleSidebar(): void {
		this.plugin.settings.sidebarHidden = !this.plugin.settings.sidebarHidden;
		void this.plugin.saveSettings();
		this.plugin.refreshAllViews();
	}

	// ---------- rendering ----------

	private renderAll(): void {
		if (!this.domBuilt) return;
		const tab = this.doc.tab;
		this.contentEl.toggleClass("hda-tab-story", tab === "story");
		this.contentEl.toggleClass("hda-tab-prose", tab !== "story");
		this.contentEl.querySelectorAll<HTMLElement>(".da-tab-btn").forEach(b => b.toggleClass("da-tab-btn-active", b.dataset.tab === tab));
		if (tab === "story") {
			this.storyZoomLabel.setText(`${Math.round((this.doc.story.zoom || 1) * 100)}%`);
			this.story.render();
			return;
		}
		const focus = this.captureFocus();
		const s = this.plugin.settings;
		const cols = s.columns;
		const zoom = this.doc.zoomLevel || 1;
		const grid = this.gridEl;
		grid.empty();
		grid.toggleClass("hda-show-guides", !!s.showGuides);
		this.contentEl.querySelector(".hda-guides-btn")?.toggleClass("hda-toggle-on", !!s.showGuides);
		this.zoomLabel.setText(`${Math.round(zoom * 100)}%`);
		if (document.activeElement !== this.passageInput) this.passageInput.value = this.doc.passage;

		const basePx = BASE_FONT_PX * zoom;
		grid.style.setProperty("--hda-base", `${basePx}px`);
		grid.style.setProperty("--hda-step", `${(s.indentStep || 1.6) * basePx}px`);
		// The English column is narrower, so its indents are scaled down.
		grid.style.setProperty("--hda-step-en", `${(s.indentStep || 1.6) * basePx * 0.75}px`);
		grid.style.setProperty("--hda-pad", `${0.5 * basePx}px`);

		const template = [
			"2.8em",
			"minmax(24em, 3fr)",
			"4.2em",
			cols.conj ? "2.6em" : "",
			cols.pattern ? "6.8em" : "",
			cols.notes ? "minmax(6.5em, 0.45fr)" : "",
			cols.english ? "minmax(20em, 2.3fr)" : "",
			"1.4em",
		].filter(Boolean).join(" ");
		grid.style.setProperty("--hda-cols", template);

		grid.createDiv({ cls: "hda-passage-title", text: this.doc.passage });

		const head = grid.createDiv({ cls: "hda-row hda-head" });
		head.createDiv({ text: "Ref" });
		head.createDiv({ cls: "hda-head-he", text: "Hebrew Text" });
		head.createDiv({ cls: "hda-head-center", text: "Level" });
		if (cols.conj) head.createDiv({ cls: "hda-head-center", text: "Conj" });
		if (cols.pattern) head.createDiv({ cls: "hda-head-center", text: "Pattern", attr: { title: "Predicate Pattern" } });
		if (cols.notes) head.createDiv({ cls: "hda-head-center", text: "Analysis", attr: { title: "Discourse Analysis" } });
		if (cols.english) head.createDiv({ text: "English Translation" });
		head.createDiv({ text: "" });

		if (this.doc.clauses.length === 0) {
			const empty = grid.createDiv({ cls: "da-empty-hint da-empty-hint-main" });
			empty.createDiv({ text: "No clauses yet." });
			empty.createDiv({ text: "Paste the Hebrew passage in the sidebar and click Insert, or use + Clause." });
			return;
		}

		// Clauses of one verse are banded together (alternate verses shaded,
		// a rule between verses, none between a verse's clauses).
		const labels = computeLabels(this.doc.clauses);
		let verseIndex = 0;
		this.doc.clauses.forEach((c, i) => {
			const verseStart = i === 0 || !!c.verse;
			if (verseStart && i > 0) verseIndex++;
			this.renderRow(grid, c, labels[i], verseStart, verseIndex % 2 === 1);
		});
		this.restoreFocus(focus);
	}

	private renderPassageTitle(): void {
		const t = this.gridEl.querySelector(".hda-passage-title");
		if (t) t.setText(this.doc.passage);
	}

	private renderRow(grid: HTMLElement, c: Clause, label: string, verseStart: boolean, verseShaded: boolean): void {
		const cols = this.plugin.settings.columns;
		const indent = c.indent;
		const row = grid.createDiv({ cls: `hda-row hda-clause hda-d${c.depth}`, attr: { "data-id": c.id } });
		row.style.setProperty("--hda-indent", String(indent));
		if (this.selected.has(c.id)) row.addClass("hda-selected");
		if (c.line === "M" || c.line === "M2") row.addClass("hda-mainline");
		if (verseStart) row.addClass("hda-verse-start");
		if (verseShaded) row.addClass("hda-verse-shaded");

		const ref = row.createDiv({ cls: "hda-ref", text: label, attr: { title: "Click to select; double-click to set the verse number" } });
		ref.addEventListener("click", e => this.onRefClick(c.id, e));
		ref.addEventListener("dblclick", e => { e.preventDefault(); this.editVerse(c.id, ref); });

		const he = this.editable(row, "hda-he", c, "he", "Hebrew clause");
		he.dir = "rtl";
		he.lang = "he";
		he.style.paddingRight = `calc(var(--hda-pad) + ${indent} * var(--hda-step))`;

		const lvl = row.createEl("button", { cls: `hda-level hda-d${c.depth}`, text: levelLabel(c), attr: { title: `${DEPTH_NAMES[c.depth]} · ${LINE_NAMES[c.line]} (click to change)` } });
		if (c.line.startsWith("O")) lvl.addClass("hda-level-offline");
		lvl.addEventListener("click", e => this.openLevelMenu(c.id, e));

		if (cols.conj) this.conjInput(row, c);
		if (cols.pattern) this.patternInput(row, c);

		if (cols.notes) this.editable(row, "hda-notes", c, "notes", "Discourse analysis");
		if (cols.english) {
			const en = this.editable(row, "hda-en", c, "en", "English");
			en.dir = "ltr";
			en.style.paddingLeft = `calc(var(--hda-pad) + ${indent} * var(--hda-step-en))`;
		}

		const del = row.createEl("button", { cls: "hda-del", text: "×", attr: { title: "Delete clause", "aria-label": "Delete clause" } });
		del.addEventListener("click", () => this.deleteClauses([c.id]));
	}

	private editable(row: HTMLElement, cls: string, c: Clause, field: "he" | "en" | "notes", placeholder: string): HTMLElement {
		const el = row.createDiv({ cls: `hda-cell ${cls}`, attr: { "data-field": field, "data-placeholder": placeholder, spellcheck: field === "he" ? "false" : "true" } });
		el.contentEditable = "plaintext-only";
		// Older engines without plaintext-only fall back to "true".
		if (el.contentEditable !== "plaintext-only") el.contentEditable = "true";
		el.setText(c[field]);
		el.addEventListener("input", () => {
			this.beginTyping();
			c[field] = cellText(el);
			el.toggleClass("hda-empty", !c[field]);
			this.typed();
		});
		el.addEventListener("keydown", e => this.onCellKey(e, c.id, field, el));
		el.addEventListener("paste", e => this.onCellPaste(e, c.id, field, el));
		el.toggleClass("hda-empty", !c[field]);
		return el;
	}

	// Conj: a plain type-in box (the connectors are too many to list).
	private conjInput(row: HTMLElement, c: Clause): void {
		const input = row.createEl("input", { cls: "hda-input hda-conj", attr: { type: "text", dir: "rtl", lang: "he", "data-field": "conj", spellcheck: "false", autocomplete: "off", title: "Type phonetically: w=ו b=ב k=כ s=ש a=א e/o=ע 0=Ø (see ? for the full list)" } });
		input.value = c.conj;
		input.addEventListener("input", () => {
			// Latin keys become Hebrew letters as you type (see CONJ_KEYMAP).
			const hebrew = toHebrewConj(input.value);
			if (hebrew !== input.value) {
				const start = input.selectionStart, end = input.selectionEnd;
				input.value = hebrew;
				input.setSelectionRange(start, end);
			}
			this.beginTyping();
			c.conj = input.value;
			this.typed();
		});
		input.addEventListener("keydown", e => {
			if (e.key === "Enter") {
				e.preventDefault();
				this.focusCell(c.id, this.plugin.settings.columns.pattern ? "pattern" : "he");
				return;
			}
			this.onCommonKey(e, c.id, "conj");
		});
	}

	private patternInput(row: HTMLElement, c: Clause): void {
		const options = PREDICATE_PATTERNS;
		// A two-line textarea so long patterns wrap within the row's height
		// (the Hebrew line sets the height); the full pattern shows on hover.
		const input = row.createEl("textarea", { cls: "hda-input hda-pattern", attr: { rows: "2", dir: "ltr", "data-field": "pattern", spellcheck: "false" } });
		input.value = c.pattern;
		input.title = c.pattern;
		input.addEventListener("focus", () => this.showSuggest(input, c.id, options, false));
		input.addEventListener("blur", () => window.setTimeout(() => { if (this.suggest?.input === input) this.hideSuggest(); }, 120));
		input.addEventListener("input", () => {
			this.beginTyping();
			// Single-line value: drop any pasted line breaks.
			if (/\n/.test(input.value)) {
				const pos = input.selectionStart;
				input.value = input.value.replace(/\s*\n\s*/g, " ");
				input.setSelectionRange(pos, pos);
			}
			c.pattern = input.value;
			input.title = input.value;
			this.typed();
			this.showSuggest(input, c.id, options, true);
		});
		input.addEventListener("keydown", e => this.onPatternKey(e, c.id, input));
	}

	private rowEl(id: string): HTMLElement | null {
		return this.gridEl.querySelector<HTMLElement>(`.hda-clause[data-id="${CSS.escape(id)}"]`);
	}

	private cellEl(id: string, field: Field): HTMLElement | null {
		return this.rowEl(id)?.querySelector<HTMLElement>(`[data-field="${field}"]`) ?? null;
	}

	// ---------- focus bookkeeping across re-renders ----------

	private captureFocus(): { id: string; field: Field; caret: number } | null {
		const active = document.activeElement as HTMLElement | null;
		if (!active || !this.gridEl.contains(active)) return null;
		const id = active.closest<HTMLElement>(".hda-clause")?.dataset.id;
		const field = active.dataset.field as Field | undefined;
		if (!id || !field) return null;
		const caret = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active.selectionStart ?? 0 : caretRange(active)?.start ?? 0;
		return { id, field, caret };
	}

	private restoreFocus(f: { id: string; field: Field; caret: number } | null): void {
		if (f) this.focusCell(f.id, f.field, f.caret);
	}

	private focusCell(id: string, field: Field, caret: number | "end" = "end"): void {
		const el = this.cellEl(id, field);
		if (!el) return;
		el.focus();
		if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
			const pos = caret === "end" ? el.value.length : caret;
			el.setSelectionRange(pos, pos);
		} else {
			setCaret(el, caret === "end" ? Number.MAX_SAFE_INTEGER : caret);
		}
	}

	// ---------- history ----------

	private serializeState(): string {
		const { blocks, links } = this.doc.story;
		return JSON.stringify({ passage: this.doc.passage, clauses: this.doc.clauses, blocks, links });
	}

	private restoreState(s: string): void {
		const parsed = JSON.parse(s);
		this.doc.passage = parsed.passage;
		this.doc.clauses = normalizeData({ clauses: parsed.clauses }).clauses;
		const story = normalizeStory({ blocks: parsed.blocks, links: parsed.links });
		this.doc.story.blocks = story.blocks;
		this.doc.story.links = story.links;
		const ids = new Set(this.doc.clauses.map(c => c.id));
		for (const id of [...this.selected]) if (!ids.has(id)) this.selected.delete(id);
	}

	private pushHistory(): void {
		this.history.push(this.snapshot);
		if (this.history.length > HISTORY_LIMIT) this.history.shift();
		this.redoStack = [];
	}

	// A structural edit: one undo step, then re-render and save.
	private change(fn: () => void, rerender = true): void {
		this.flushTyping();
		this.pushHistory();
		fn();
		this.snapshot = this.serializeState();
		this.requestSave();
		if (rerender) this.renderAll();
	}

	// Typing: the first keystroke of a burst records the undo step.
	private beginTyping(): void {
		if (this.typingTimer === null) this.pushHistory();
		else window.clearTimeout(this.typingTimer);
		this.typingTimer = window.setTimeout(() => this.flushTyping(), TYPING_IDLE_MS);
	}

	private typed(): void {
		this.requestSave();
	}

	private flushTyping(): void {
		if (this.typingTimer === null) return;
		window.clearTimeout(this.typingTimer);
		this.typingTimer = null;
		this.snapshot = this.serializeState();
	}

	undo(): void {
		this.flushTyping();
		const prev = this.history.pop();
		if (prev === undefined) return;
		this.redoStack.push(this.serializeState());
		this.restoreState(prev);
		this.snapshot = prev;
		this.requestSave();
		this.renderAll();
	}

	redo(): void {
		this.flushTyping();
		const next = this.redoStack.pop();
		if (next === undefined) return;
		this.history.push(this.serializeState());
		this.restoreState(next);
		this.snapshot = next;
		this.requestSave();
		this.renderAll();
	}

	// ---------- clause operations ----------

	private indexOf(id: string): number {
		return this.doc.clauses.findIndex(c => c.id === id);
	}

	private insertionIndex(): number {
		const idx = this.doc.clauses.map((c, i) => (this.selected.has(c.id) ? i : -1)).filter(i => i >= 0);
		return idx.length ? Math.max(...idx) + 1 : this.doc.clauses.length;
	}

	addClause(): void {
		const at = this.insertionIndex();
		const prev = this.doc.clauses[at - 1];
		const c = newClause(prev ? { depth: prev.depth, line: prev.line, indent: prev.indent } : {});
		this.change(() => {
			this.doc.clauses.splice(at, 0, c);
			this.selected.clear();
		});
		this.focusCell(c.id, "he");
	}

	private insertHebrew(text: string): boolean {
		const pieces = splitPasted(text);
		if (!pieces.length) return false;
		const at = this.insertionIndex();
		const prev = this.doc.clauses[at - 1];
		const wasEmpty = this.doc.clauses.length === 0;
		const added = pieces.map(p => newClause({ he: p.text, verse: p.verse, depth: prev?.depth ?? 0, line: prev?.line ?? "M", indent: prev?.indent ?? 0 }));
		this.change(() => {
			this.doc.clauses.splice(at, 0, ...added);
			if (wasEmpty) inferVerses(this.doc.clauses, startVerseOf(this.doc.passage));
			this.selected.clear();
		});
		new Notice(`Added ${added.length} clause${added.length === 1 ? "" : "s"}.`);
		return true;
	}

	private deleteClauses(ids: string[]): void {
		if (!ids.length) return;
		const set = new Set(ids);
		this.change(() => {
			this.doc.clauses = this.doc.clauses.filter(c => !set.has(c.id));
			ids.forEach(id => this.selected.delete(id));
		});
	}

	// The clauses a level/move command applies to: the selection when the
	// focused clause is part of it, otherwise just the focused clause.
	private targetIds(focusId: string | null): string[] {
		if (focusId && (!this.selected.has(focusId) || this.selected.size < 2)) return [focusId];
		return this.doc.clauses.filter(c => this.selected.has(c.id)).map(c => c.id);
	}

	// Tab / Shift+Tab: layout only; the level is set from the badge.
	private stepIndent(ids: string[], dir: 1 | -1): void {
		const targets = ids.map(id => this.doc.clauses[this.indexOf(id)]).filter(c => c && c.indent + dir >= 0 && c.indent + dir <= MAX_INDENT);
		if (!targets.length) return;
		this.change(() => { for (const c of targets) c.indent += dir; });
	}

	private setLevel(ids: string[], depth: number, line: Line): void {
		this.change(() => {
			for (const id of ids) {
				const c = this.doc.clauses[this.indexOf(id)];
				if (c) { c.depth = depth; c.line = line; }
			}
		});
	}

	private moveClauses(ids: string[], dir: 1 | -1): void {
		const list = this.doc.clauses;
		const set = new Set(ids);
		const idx = list.map((c, i) => (set.has(c.id) ? i : -1)).filter(i => i >= 0);
		if (!idx.length) return;
		if (dir < 0 ? idx[0] === 0 : idx[idx.length - 1] === list.length - 1) return;
		this.change(() => {
			const order = dir < 0 ? idx : [...idx].reverse();
			for (const i of order) {
				const j = i + dir;
				[list[i], list[j]] = [list[j], list[i]];
			}
		});
	}

	private splitClause(id: string, el: HTMLElement): void {
		const i = this.indexOf(id);
		const c = this.doc.clauses[i];
		if (!c) return;
		const text = cellText(el);
		const r = caretRange(el) ?? { start: text.length, end: text.length };
		const before = text.slice(0, r.start).trimEnd();
		const after = text.slice(r.end).trimStart();
		const next = newClause({ he: after, depth: c.depth, line: c.line, indent: c.indent });
		this.change(() => {
			c.he = before;
			this.doc.clauses.splice(i + 1, 0, next);
		});
		this.focusCell(next.id, "he", 0);
	}

	private mergeWithPrevious(id: string): void {
		const i = this.indexOf(id);
		if (i <= 0) return;
		const prev = this.doc.clauses[i - 1];
		const cur = this.doc.clauses[i];
		const joinAt = prev.he.length + (prev.he && cur.he ? 1 : 0);
		const join = (a: string, b: string) => [a, b].filter(s => s.trim()).join(" ");
		this.change(() => {
			prev.he = join(prev.he, cur.he);
			prev.en = join(prev.en, cur.en);
			prev.notes = join(prev.notes, cur.notes);
			this.doc.clauses.splice(i, 1);
			this.selected.delete(cur.id);
		});
		this.focusCell(prev.id, "he", joinAt);
	}

	private editVerse(id: string, refEl: HTMLElement): void {
		const c = this.doc.clauses[this.indexOf(id)];
		if (!c) return;
		refEl.empty();
		const input = refEl.createEl("input", { cls: "hda-verse-input", attr: { type: "text", placeholder: "v." } });
		input.value = c.verse ?? "";
		input.focus();
		input.select();
		let done = false;
		const finish = (commit: boolean) => {
			if (done) return;
			done = true;
			const v = input.value.trim();
			if (commit && v !== (c.verse ?? "")) this.change(() => { if (v) c.verse = v; else delete c.verse; });
			else this.renderAll();
		};
		input.addEventListener("keydown", e => {
			if (e.key === "Enter") { e.preventDefault(); finish(true); }
			else if (e.key === "Escape") { e.preventDefault(); finish(false); }
			e.stopPropagation();
		});
		input.addEventListener("blur", () => finish(true));
	}

	private setZoom(z: number): void {
		const zoom = Math.round(Math.min(2.5, Math.max(0.5, z)) * 10) / 10;
		if (zoom === this.doc.zoomLevel) return;
		this.doc.zoomLevel = zoom;
		this.requestSave();
		this.renderAll();
	}

	// ---------- selection ----------

	private onRefClick(id: string, e: MouseEvent): void {
		this.currentClauseId = id;
		if (e.shiftKey && this.anchorId) {
			const a = this.indexOf(this.anchorId);
			const b = this.indexOf(id);
			if (!(e.ctrlKey || e.metaKey)) this.selected.clear();
			for (let i = Math.min(a, b); i <= Math.max(a, b); i++) this.selected.add(this.doc.clauses[i].id);
		} else if (e.ctrlKey || e.metaKey) {
			if (this.selected.has(id)) this.selected.delete(id); else this.selected.add(id);
			this.anchorId = id;
		} else {
			const only = this.selected.size === 1 && this.selected.has(id);
			this.selected.clear();
			if (!only) this.selected.add(id);
			this.anchorId = id;
		}
		(document.activeElement as HTMLElement | null)?.blur();
		this.canvasEl.focus({ preventScroll: true });
		this.syncSelectionClasses();
	}

	private syncSelectionClasses(): void {
		this.gridEl.querySelectorAll<HTMLElement>(".hda-clause").forEach(r => r.toggleClass("hda-selected", this.selected.has(r.dataset.id || "")));
	}

	// ---------- menus ----------

	private openLevelMenu(id: string, e: MouseEvent): void {
		const ids = this.targetIds(id);
		const c = this.doc.clauses[this.indexOf(id)];
		const menu = new Menu();
		for (let d = 0; d <= MAX_DEPTH; d++) {
			if (d > 0) menu.addSeparator();
			for (const line of linesFor(d)) {
				const current = c && c.depth === d && c.line === line;
				menu.addItem(item => {
					item.setTitle(`${levelLabel({ depth: d, line })}  —  ${d === 0 ? "Narrative" : d === 1 ? "Speech" : "Speech in speech"} ${LINE_NAMES[line].toLowerCase()}`);
					if (current) item.setIcon("check");
					item.onClick(() => this.setLevel(ids, d, line));
				});
			}
		}
		menu.showAtMouseEvent(e);
	}

	private openColumnsMenu(e: MouseEvent): void {
		const cols = this.plugin.settings.columns;
		const menu = new Menu();
		const names: [keyof HdaColumns, string][] = [["conj", "Conj"], ["pattern", "Predicate Pattern"], ["notes", "Discourse Analysis"], ["english", "English Translation"]];
		for (const [key, name] of names) {
			menu.addItem(item => {
				item.setTitle(name);
				if (cols[key]) item.setIcon("check");
				item.onClick(async () => {
					cols[key] = !cols[key];
					await this.plugin.saveSettings();
					this.plugin.refreshAllViews();
				});
			});
		}
		menu.showAtMouseEvent(e);
	}

	// ---------- suggestions for Conj / Pattern ----------

	private showSuggest(input: HTMLTextAreaElement, clauseId: string, all: { value: string; hint?: string; keys?: string[] }[], typed: boolean): void {
		const q = input.value.trim().toLowerCase();
		let options = all;
		if (typed && q) {
			const keyStart = (o: { keys?: string[] }) => (o.keys ?? []).some(k => k.startsWith(q));
			const keySegment = (o: { keys?: string[] }) => !keyStart(o) && (o.keys ?? []).some(k => k.includes("-" + q));
			const rest = all.filter(o => !keyStart(o) && !keySegment(o) && (o.value.toLowerCase().includes(q) || (o.hint ?? "").toLowerCase().includes(q)));
			options = [...all.filter(keyStart), ...all.filter(keySegment), ...rest];
		}
		if (!options.length) { this.hideSuggest(); return; }
		const exact = options.findIndex(o => o.value === input.value);
		this.suggest = { input, clauseId, options, active: typed && q ? 0 : exact, typed };
		this.renderSuggest();
	}

	private renderSuggest(): void {
		const s = this.suggest;
		const el = this.suggestEl;
		if (!s) return;
		el.empty();
		s.options.forEach((o, i) => {
			const item = el.createDiv({ cls: "hda-suggest-item" + (i === s.active ? " is-active" : "") });
			item.createSpan({ cls: "hda-suggest-value", text: o.value, attr: { dir: "ltr" } });
			if (o.hint) item.createSpan({ cls: "hda-suggest-hint", text: o.hint });
			item.addEventListener("mousedown", e => { e.preventDefault(); this.pickSuggestion(i); });
		});
		const r = s.input.getBoundingClientRect();
		const host = this.contentEl.getBoundingClientRect();
		el.style.left = `${r.left - host.left}px`;
		el.style.top = `${r.bottom - host.top + 2}px`;
		el.style.minWidth = `${Math.max(r.width, 180)}px`;
		el.show();
		el.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
	}

	private hideSuggest(): void {
		this.suggest = null;
		this.suggestEl?.hide();
	}

	private pickSuggestion(i: number): void {
		const s = this.suggest;
		if (!s) return;
		const value = s.options[i]?.value;
		const c = this.doc.clauses[this.indexOf(s.clauseId)];
		this.hideSuggest();
		if (!c || value === undefined) return;
		if (c.pattern !== value) this.change(() => { c.pattern = value; });
		this.focusCell(c.id, this.plugin.settings.columns.notes ? "notes" : "he");
	}

	private onPatternKey(e: KeyboardEvent, id: string, input: HTMLTextAreaElement): void {
		const s = this.suggest;
		if (s && s.input === input) {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				const n = s.options.length;
				s.active = s.active < 0 ? (e.key === "ArrowDown" ? 0 : n - 1) : (s.active + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
				this.renderSuggest();
				return;
			}
			if ((e.key === "Enter" || e.key === "Tab") && s.active >= 0 && !e.shiftKey) {
				e.preventDefault();
				this.pickSuggestion(s.active);
				return;
			}
			if (e.key === "Escape") { e.preventDefault(); this.hideSuggest(); return; }
		}
		if (e.key === "Enter") {
			e.preventDefault();
			this.focusCell(id, this.plugin.settings.columns.notes ? "notes" : "he");
			return;
		}
		this.onCommonKey(e, id, "pattern");
	}

	// ---------- keyboard ----------

	private onCellKey(e: KeyboardEvent, id: string, field: "he" | "en" | "notes", el: HTMLElement): void {
		if (e.key === "Tab" && (field === "he" || field === "en")) {
			e.preventDefault();
			this.stepIndent(this.targetIds(id), e.shiftKey ? -1 : 1);
			return;
		}
		if (e.key === "Enter") {
			e.preventDefault();
			if (field === "he" && !e.ctrlKey && !e.metaKey) this.splitClause(id, el);
			else this.focusNeighbour(id, field, 1);
			return;
		}
		if (e.key === "Backspace" && field === "he") {
			const r = caretRange(el);
			if (r && r.start === 0 && r.end === 0) { e.preventDefault(); this.mergeWithPrevious(id); return; }
		}
		this.onCommonKey(e, id, field);
	}

	private onCommonKey(e: KeyboardEvent, id: string, field: Field): void {
		if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
			e.preventDefault();
			this.focusNeighbour(id, field, e.key === "ArrowUp" ? -1 : 1);
		} else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
			e.preventDefault();
			this.moveClauses(this.targetIds(id), e.key === "ArrowUp" ? -1 : 1);
		}
	}

	private focusNeighbour(id: string, field: Field, dir: 1 | -1): void {
		const i = this.indexOf(id) + dir;
		const c = this.doc.clauses[i];
		if (c) this.focusCell(c.id, field);
	}

	private onCellPaste(e: ClipboardEvent, id: string, field: "he" | "en" | "notes", el: HTMLElement): void {
		const text = e.clipboardData?.getData("text/plain") ?? "";
		e.preventDefault();
		if (!text) return;
		const i = this.indexOf(id);
		const c = this.doc.clauses[i];
		const current = cellText(el);
		const r = caretRange(el) ?? { start: current.length, end: current.length };
		const before = current.slice(0, r.start);
		const after = current.slice(r.end);
		if (!/\n/.test(text.trim()) || field === "notes") {
			// Single line: insert it as plain text at the caret.
			const ins = text.replace(/\s*\n\s*/g, " ");
			this.change(() => { c[field] = before + ins + after; });
			this.focusCell(id, field, before.length + ins.length);
			return;
		}
		const pieces = splitPasted(text);
		if (field === "he" && before.trim() && !after.trim()) {
			// Several lines pasted after a clause's text: each line becomes a
			// new clause below it.
			const added = pieces.map(p => newClause({ he: p.text, verse: p.verse, depth: c.depth, line: c.line, indent: c.indent }));
			this.change(() => { this.doc.clauses.splice(i + 1, 0, ...added); });
		} else if (field === "he") {
			// Several lines into a Hebrew cell: one clause per line.
			const added = pieces.slice(1).map(p => newClause({ he: p.text, verse: p.verse, depth: c.depth, line: c.line, indent: c.indent }));
			this.change(() => {
				c.he = (before + pieces[0].text).trim();
				if (pieces[0].verse && !before.trim()) c.verse = pieces[0].verse;
				const last = added[added.length - 1];
				if (last) last.he = (last.he + after).trim(); else c.he = (c.he + after).trim();
				this.doc.clauses.splice(i + 1, 0, ...added);
			});
		} else {
			// Several lines into an English cell: fill this and the following clauses.
			this.change(() => {
				pieces.forEach((p, k) => {
					const t = this.doc.clauses[i + k];
					if (t) t.en = k === 0 ? (before + p.text).trim() : p.text;
				});
			});
		}
	}

	private wireEvents(): void {
		this.canvasEl.tabIndex = -1;
		this.registerDomEvent(this.contentEl, "keydown", (e: KeyboardEvent) => {
			const target = e.target as HTMLElement;
			const inSidebarField = target.closest(".hda-sidebar") && (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement);
			const mod = e.ctrlKey || e.metaKey;
			if (mod && !inSidebarField && !e.altKey) {
				const k = e.key.toLowerCase();
				if (k === "z" && !e.shiftKey) { e.preventDefault(); this.undo(); return; }
				if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); this.redo(); return; }
			}
			// Keys for selected clauses or story blocks (focus not in a text field).
			const editing = target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
			if (editing) return;
			if (this.doc.tab === "story") {
				if (!this.story.hasSelection()) return;
				if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); this.story.deleteSelection(); }
				else if (e.key === "Escape") this.story.clearSelection();
				return;
			}
			if (this.selected.size === 0) return;
			const ids = this.doc.clauses.filter(c => this.selected.has(c.id)).map(c => c.id);
			if (e.key === "Tab") { e.preventDefault(); this.stepIndent(ids, e.shiftKey ? -1 : 1); }
			else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); this.deleteClauses(ids); }
			else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); this.moveClauses(ids, e.key === "ArrowUp" ? -1 : 1); }
			else if (e.key === "Escape") { this.selected.clear(); this.syncSelectionClasses(); }
		});

		const trackClause = (e: Event) => {
			const id = (e.target as HTMLElement).closest<HTMLElement>(".hda-clause")?.dataset.id;
			if (id) this.currentClauseId = id;
		};
		this.registerDomEvent(this.gridEl, "focusin", trackClause);
		this.registerDomEvent(this.gridEl, "mousedown", trackClause);

		// Clicking empty canvas clears the selection.
		this.registerDomEvent(this.canvasEl, "mousedown", (e: MouseEvent) => {
			if (e.target === this.canvasEl || e.target === this.gridEl) {
				this.selected.clear();
				this.syncSelectionClasses();
			}
		});

		// Ctrl+scroll zoom: one wheel notch = one 10% step.
		this.registerDomEvent(this.canvasEl, "wheel", (e: WheelEvent) => {
			if (!e.ctrlKey && !e.metaKey) return;
			e.preventDefault();
			this.wheelAccum += e.deltaY;
			if (Math.abs(this.wheelAccum) < 50) return;
			this.setZoom(this.doc.zoomLevel + (this.wheelAccum < 0 ? 0.1 : -0.1));
			this.wheelAccum = 0;
		}, { passive: false });

		this.registerDomEvent(this.canvasEl, "scroll", () => this.hideSuggest());

		this.registerDomEvent(this.story.el, "wheel", (e: WheelEvent) => {
			if (!e.ctrlKey && !e.metaKey) return;
			e.preventDefault();
			this.wheelAccum += e.deltaY;
			if (Math.abs(this.wheelAccum) < 50) return;
			this.setStoryZoom(this.doc.story.zoom + (this.wheelAccum < 0 ? 0.1 : -0.1), e);
			this.wheelAccum = 0;
		}, { passive: false });
	}

	// ---------- modals (in-view, styled like DA-Tool's) ----------

	private openModal(title: string, sizeCls: string, build: (body: HTMLElement, close: () => void) => void): void {
		const backdrop = this.contentEl.createDiv({ cls: "da-modal-backdrop" });
		const modal = backdrop.createDiv({ cls: `da-modal da-ui-scaled ${sizeCls}` });
		const head = modal.createDiv({ cls: "da-modal-header" });
		head.createEl("h2", { cls: "da-modal-title", text: title });
		const closeBtn = head.createEl("button", { cls: "da-modal-close", text: "×", attr: { "aria-label": "Close" } });
		const body = modal.createDiv({ cls: "da-modal-body" });
		const close = () => { backdrop.remove(); document.removeEventListener("keydown", onKey, true); };
		const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
		document.addEventListener("keydown", onKey, true);
		closeBtn.addEventListener("click", close);
		backdrop.addEventListener("mousedown", e => { if (e.target === backdrop) close(); });
		build(body, close);
	}

	// Opens the chart at the section for the clause being worked on: the one
	// selected (if just one), else the one last clicked or typed in.
	openReferenceForCurrent(): void {
		const id = this.selected.size === 1 ? [...this.selected][0] : this.currentClauseId;
		const c = id ? this.doc.clauses[this.indexOf(id)] : null;
		if (c) this.openReference(referenceSectionFor(c.pattern, c.depth), c.id);
		else this.openReference(null, null);
	}

	openReference(sectionId: string | null, clauseId: string | null): void {
		const clause = clauseId ? this.doc.clauses[this.indexOf(clauseId)] : null;
		const label = clause ? computeLabels(this.doc.clauses)[this.indexOf(clause.id)] : "";
		this.openModal("Function of Communication", "hda-modal-ref", (body, close) => {
			if (clause) {
				const note = body.createDiv({ cls: "hda-ref-note" });
				note.createSpan({ text: `Clause ${label || this.indexOf(clause.id) + 1} · ${textType(clause.depth)} · ${clause.pattern || "no pattern yet"}. ` });
				note.createSpan({ cls: "hda-ref-note-hint", text: "Click a function to add it to this clause's Discourse Analysis." });
				if (sectionId && sectionId.endsWith("-dx") && clause.depth === 0) {
					note.createDiv({ cls: "hda-ref-note-hint", text: "This pattern has no narrative (Hx) section in the chart, so its direct-speech section is shown." });
				}
			}
			const cols = body.createDiv({ cls: "hda-ref-cols" });
			let target: HTMLElement | null = null;
			for (const tt of ["Hx", "Dx"] as const) {
				const col = cols.createDiv({ cls: "hda-ref-col" });
				col.createEl("h3", { cls: "hda-ref-col-title", text: tt === "Hx" ? "Historical narrative (Hx)" : "Direct speech (Dx)" });
				for (const sec of FUNCTION_SECTIONS.filter(s => s.textType === tt)) {
					const card = col.createDiv({ cls: "hda-ref-card" + (sec.id === sectionId ? " is-target" : "") });
					if (sec.id === sectionId) target = card;
					card.createDiv({ cls: "hda-ref-pattern", text: sec.pattern });
					for (const g of sec.groups) {
						card.createDiv({ cls: "hda-ref-kind", text: g.kind });
						const list = card.createEl("ol", { cls: "hda-ref-items" });
						for (const item of g.items) {
							const li = list.createEl("li", { text: item });
							if (clause) {
								li.addClass("is-clickable");
								li.setAttr("title", "Add to this clause's Discourse Analysis");
								li.addEventListener("click", () => {
									close();
									this.change(() => { clause.notes = clause.notes.trim() ? `${clause.notes.trim()}; ${item}` : item; });
									if (this.plugin.settings.columns.notes) this.focusCell(clause.id, "notes");
								});
							}
						}
					}
				}
			}
			if (target) window.setTimeout(() => (target as HTMLElement).scrollIntoView({ block: "center" }), 0);
		});
	}

	private openInstructions(): void {
		this.openModal("Discourse Analysis of Hebrew Prose", "da-modal-medium", body => {
			const wrap = body.createDiv({ cls: "da-instructions" });
			for (const block of METHOD_INSTRUCTIONS) this.renderInstructionBlock(wrap, block);
		});
	}

	private renderInstructionBlock(parent: HTMLElement, b: InstructionBlock): void {
		if (b.h) parent.createEl("h3", { text: b.h });
		if (b.p) parent.createEl("p", { text: b.p });
		if (b.steps) {
			const ol = parent.createEl("ol", { cls: "hda-steps" });
			for (const s of b.steps) {
				const li = ol.createEl("li");
				li.createEl("b", { text: s.title });
				if (s.sub?.length) {
					const ul = li.createEl("ul");
					for (const sub of s.sub) ul.createEl("li", { text: sub });
				}
			}
		}
		if (b.table) {
			const table = parent.createEl("table", { cls: "hda-key-table" });
			for (const [a, d] of b.table) {
				const tr = table.createEl("tr");
				tr.createEl("td", { cls: "hda-key-term", text: a });
				tr.createEl("td", { text: d });
			}
		}
	}

	private openHelp(): void {
		this.openModal("Using the Hebrew DA tool", "da-modal-medium", body => {
			const wrap = body.createDiv({ cls: "da-instructions" });
			for (const sec of TOOL_HELP) {
				wrap.createEl("h3", { text: sec.h });
				const ul = wrap.createEl("ul");
				for (const item of sec.items) appendMarkup(ul.createEl("li"), item);
			}
		});
	}

	// ---------- PNG export ----------

	private async exportPng(): Promise<void> {
		if (!this.file) return;
		this.flushTyping();
		const storyTab = this.doc.tab === "story";
		const grid = this.gridEl;
		grid.addClass("hda-exporting");
		const storyExport = storyTab ? this.story.prepareExport() : null;
		try {
			const bg = getComputedStyle(this.contentEl).getPropertyValue(storyTab ? "--da-bg" : "--da-surface").trim() || "#ffffff";
			const canvas = await html2canvas(storyExport?.el ?? grid, { backgroundColor: bg, scale: 2, logging: false, onclone: (_d, el) => plainColors(el) });
			const blob: Blob | null = await new Promise(res => canvas.toBlob(res, "image/png"));
			if (!blob) throw new Error("Could not encode the image.");
			const buf = await blob.arrayBuffer();
			const folder = this.file.parent?.path ?? "";
			const path = `${folder && folder !== "/" ? folder + "/" : ""}${this.file.basename}${storyTab ? " (story)" : ""}.png`;
			const existing = this.app.vault.getAbstractFileByPath(path);
			if (existing instanceof TFile) await this.app.vault.modifyBinary(existing, buf);
			else await this.app.vault.createBinary(path, buf);
			new Notice(`Saved ${path}`);
		} catch (err) {
			console.error("Hebrew DA: PNG export failed", err);
			new Notice("PNG export failed (see the developer console).");
		} finally {
			grid.removeClass("hda-exporting");
			storyExport?.restore();
		}
	}
}
