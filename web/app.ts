// The web version: the same view as the Obsidian plugin, on a plain page.
// One analysis at a time, kept in the browser (localStorage) as you type;
// New / Open / Import / 💾 Download move .hda files in and out.

import { TFile, WorkspaceLeaf } from "obsidian";
import { COLOR_THEMES, DEFAULT_HEBREW_FONT, HDAView, HdaSettings, UI_SCALE_STEPS, defaultSettings } from "../src/HDAView";
import { HdaData, emptyData } from "../src/model";
import { importWorkbook } from "../src/xlsmImport";
import { Modal, Notice, download } from "./obsidian-web";
import example from "../dev/sample.json";

const SETTINGS_KEY = "hda-web-settings";
const DOC_KEY = "hda-web-doc";
const NAME_KEY = "hda-web-name";
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|]/g;

function load(key: string): string | null {
	try { return localStorage.getItem(key); } catch { return null; }
}
function store(key: string, value: string): void {
	try { localStorage.setItem(key, value); } catch { /* private window: nothing kept */ }
}

// "Theme" follows Obsidian's own colors, which don't exist here.
const adopt = COLOR_THEMES.findIndex(t => t.id === "obsidian");
if (adopt >= 0) COLOR_THEMES.splice(adopt, 1);

// Prefer a Hebrew web font (loaded in index.html) when SBL Hebrew isn't installed.
const WEB_HEBREW_FONT = DEFAULT_HEBREW_FONT.replace(`"Times New Roman"`, `"Noto Serif Hebrew", "Times New Roman"`);

const settings: HdaSettings = (() => {
	const defaults = defaultSettings();
	defaults.hebrewFont = WEB_HEBREW_FONT;
	let saved: Partial<HdaSettings> = {};
	try { saved = JSON.parse(load(SETTINGS_KEY) || "{}"); } catch { /* defaults */ }
	const s = Object.assign(defaults, saved, { columns: Object.assign({}, defaults.columns, saved.columns) });
	if (!COLOR_THEMES.some(t => t.id === s.colorTheme)) s.colorTheme = "standard";
	if (!UI_SCALE_STEPS.includes(s.uiScale)) s.uiScale = 1;
	if (!["auto", "light", "dark"].includes(s.mode)) s.mode = "auto";
	return s;
})();

// "Auto" mode follows the system setting; the view reads it from the body.
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const syncBody = () => {
	document.body.classList.toggle("theme-dark", darkQuery.matches);
	document.body.classList.toggle("theme-light", !darkQuery.matches);
};
syncBody();

const hostApp = {
	app: null as any,
	settings,
	saveSettings: async () => store(SETTINGS_KEY, JSON.stringify(settings)),
	refreshAllViews: () => { view.refreshTheming(); paintPage(); },
	saveButton: () => downloadCurrent(),
};

const view = new HDAView(new WorkspaceLeaf(), hostApp as any);
const file = new TFile();
(view as any).file = file;
(view as any).onSaved = (text: string) => store(DOC_KEY, text);
document.getElementById("app")!.appendChild(view.contentEl);

darkQuery.addEventListener("change", () => { syncBody(); view.refreshTheming(); paintPage(); });

// The page behind the view (overscroll, notices) matches the view's background.
function paintPage(): void {
	const bg = getComputedStyle(view.contentEl).getPropertyValue("--da-bg").trim();
	if (bg) document.body.style.background = bg;
}

function setName(name: string): void {
	file.basename = name;
	file.name = `${name}.hda`;
	document.title = name && name !== "Untitled" ? `${name} – Hebrew Discourse Analysis` : "Hebrew Discourse Analysis";
	store(NAME_KEY, name);
}

function openData(text: string, name: string): void {
	setName(name);
	view.setViewData(text, true);
	store(DOC_KEY, view.getViewData());
}

function fileNameFor(): string {
	const passage = ((view as any).doc as HdaData)?.passage?.trim();
	if (file.basename && file.basename !== "Untitled") return file.basename;
	return passage ? `DA of ${passage.replace(/:/g, ".")}`.replace(ILLEGAL_FILENAME_CHARS, "").trim() : "Untitled";
}

function downloadCurrent(): void {
	const name = fileNameFor();
	setName(name);
	download(`${name}.hda`, view.getViewData(), "application/json");
	new Notice(`Downloaded ${name}.hda`);
}

function pickFiles(accept: string, multiple: boolean, onPick: (files: File[]) => void): void {
	const input = document.createElement("input");
	input.type = "file";
	input.accept = accept;
	input.multiple = multiple;
	input.addEventListener("change", () => onPick(Array.from(input.files ?? [])));
	input.click();
}

async function openFiles(files: File[]): Promise<void> {
	const f = files[0];
	if (!f) return;
	const base = f.name.replace(/\.[^.]+$/, "");
	try {
		if (/\.(xlsm|xlsx)$/i.test(f.name)) {
			const data = await importWorkbook(await f.arrayBuffer(), f.name);
			openData(JSON.stringify(data), base);
			new Notice(`Imported ${f.name}. Use 💾 to download it as a .hda file.`);
		} else {
			openData(await f.text(), base);
		}
		if (files.length > 1) new Notice("Only the first file was opened; the web version holds one analysis at a time.", 8000);
	} catch (err) {
		console.error("Hebrew DA: couldn't open", f.name, err);
		new Notice(`Couldn't open ${f.name}: ${err instanceof Error ? err.message : err}`, 10000);
	}
}

class ConfirmReplace extends Modal {
	constructor(private message: string, private onOk: () => void) { super(null as any); }
	onOpen(): void {
		this.contentEl.createEl("p", { text: this.message });
		const row = this.contentEl.createDiv({ cls: "hda-prompt-buttons" });
		row.createEl("button", { cls: "da-btn", text: "Cancel" }).addEventListener("click", () => this.close());
		const dl = row.createEl("button", { cls: "da-btn", text: "Download it first" });
		dl.addEventListener("click", () => { downloadCurrent(); this.close(); this.onOk(); });
		const ok = row.createEl("button", { cls: "da-btn da-btn-danger", text: "Replace" });
		ok.addEventListener("click", () => { this.close(); this.onOk(); });
	}
	onClose(): void { this.contentEl.empty(); }
}

// Replacing the analysis in the browser: ask first unless it's empty.
function replacing(action: () => void): void {
	const doc = (view as any).doc as HdaData;
	const empty = !doc.clauses.length && !doc.story?.blocks?.length && !doc.passage;
	if (empty) { action(); return; }
	new ConfirmReplace("This replaces the analysis open here. It isn't kept anywhere else unless you've downloaded it.", action).open();
}

class SettingsModal extends Modal {
	constructor() { super(null as any); }
	onOpen(): void {
		const c = this.contentEl;
		c.addClass("web-settings");
		c.createEl("h2", { cls: "da-modal-title", text: "Settings" });
		const save = () => { void hostApp.saveSettings(); hostApp.refreshAllViews(); };
		const row = (label: string, desc: string) => {
			const r = c.createDiv({ cls: "web-setting" });
			const t = r.createDiv({ cls: "web-setting-text" });
			t.createDiv({ cls: "web-setting-name", text: label });
			t.createDiv({ cls: "web-setting-desc", text: desc });
			return r.createDiv({ cls: "web-setting-control" });
		};

		const ui = row("UI size", "Header, toolbar, sidebar and dialogs. The worksheet has its own zoom.").createEl("select");
		for (const step of UI_SCALE_STEPS) ui.createEl("option", { text: `${Math.round(step * 100)}%`, attr: { value: String(step) } });
		ui.value = String(settings.uiScale);
		ui.addEventListener("change", () => { settings.uiScale = Number(ui.value); save(); });

		const fontCtl = row("Hebrew font", "A CSS font list; the first one your computer has is used.");
		const font = fontCtl.createEl("input", { type: "text", value: settings.hebrewFont });
		font.addEventListener("change", () => { settings.hebrewFont = font.value.trim() || WEB_HEBREW_FONT; save(); });
		fontCtl.createEl("button", { cls: "da-btn da-btn-icon-only", text: "↺", attr: { title: "Reset" } }).addEventListener("click", () => {
			settings.hebrewFont = WEB_HEBREW_FONT; font.value = WEB_HEBREW_FONT; save();
		});

		const slider = (label: string, desc: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void) => {
			const ctl = row(label, desc);
			const input = ctl.createEl("input", { type: "range", attr: { min: String(min), max: String(max), step: String(step) } });
			const out = ctl.createSpan({ cls: "web-setting-value" });
			input.value = String(get());
			out.setText(input.value);
			input.addEventListener("input", () => { set(Number(input.value)); out.setText(input.value); save(); });
		};
		slider("Hebrew size", "Size of the Hebrew relative to the English.", 1, 2, 0.05, () => settings.hebrewScale, v => { settings.hebrewScale = v; });
		slider("Indent width", "Width of one mainline/offline level, in em.", 0.8, 3, 0.1, () => settings.indentStep, v => { settings.indentStep = v; });

		const foot = c.createDiv({ cls: "hda-prompt-buttons hda-prompt-buttons-gap" });
		foot.createEl("button", { cls: "da-btn da-btn-primary", text: "Done" }).addEventListener("click", () => this.close());
	}
	onClose(): void { this.contentEl.empty(); }
}

function addWebButtons(): void {
	const right = view.contentEl.querySelector<HTMLElement>(".da-header-right");
	if (!right) return;
	const saveBtn = right.firstElementChild as HTMLElement | null;
	saveBtn?.setAttribute("title", "Download as a .hda file");
	const btn = (text: string, title: string, onClick: () => void) => {
		const b = document.createElement("button");
		b.className = "da-btn";
		b.textContent = text;
		b.title = title;
		b.addEventListener("click", onClick);
		right.insertBefore(b, saveBtn);
		return b;
	};
	btn("New", "Start a new, empty analysis", () => replacing(() => openData(JSON.stringify(emptyData()), "Untitled")));
	btn("Open", "Open a .hda file, or import an Excel DA workbook (.xlsm)", () =>
		pickFiles(".hda,.json,.xlsm,.xlsx", false, files => replacing(() => void openFiles(files))));
	btn("⚙", "Settings", () => new SettingsModal().open());
}

// Drop a .hda or .xlsm anywhere on the page to open it.
document.addEventListener("dragover", e => { e.preventDefault(); });
document.addEventListener("drop", e => {
	const files = Array.from(e.dataTransfer?.files ?? []).filter(f => /\.(hda|json|xlsm|xlsx)$/i.test(f.name));
	if (!files.length) return;
	e.preventDefault();
	replacing(() => void openFiles(files));
});

(async () => {
	await view.onOpen();
	addWebButtons();
	paintPage();
	const saved = load(DOC_KEY);
	if (saved) openData(saved, load(NAME_KEY) || "Untitled");
	else openData(JSON.stringify(example), "Example – Genesis 3.1-6");
})();
