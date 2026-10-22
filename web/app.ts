// The web version: the same view as the Obsidian plugin, on a plain page.
// One analysis at a time, kept in the browser (localStorage) as you type;
// 📄 New / 📂 Open / Import / 💾 Download move .hda files in and out.

import { TFile, WorkspaceLeaf } from "obsidian";
import { COLOR_THEMES, DEFAULT_HEBREW_FONT, HDAView, HdaSettings, UI_SCALE_STEPS, defaultSettings } from "../src/HDAView";
import { HdaData, emptyData } from "../src/model";
import { importWorkbook } from "../src/xlsmImport";
import { Modal, Notice, download } from "./obsidian-web";

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
	defaultHebrewFont: WEB_HEBREW_FONT,
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
		b.setAttribute("aria-label", title);
		b.addEventListener("click", onClick);
		right.insertBefore(b, saveBtn);
		return b;
	};
	// Same icons as DA-Tool's New / Open, next to Save.
	btn("📄", "New analysis", () => replacing(() => openData(JSON.stringify(emptyData()), "Untitled")));
	btn("📂", "Open a .hda file, or import an Excel DA workbook (.xlsm)", () =>
		pickFiles(".hda,.json,.xlsm,.xlsx", false, files => replacing(() => void openFiles(files))));
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
	// Start empty. (Early visitors were shown an example; drop that too.)
	const saved = load(DOC_KEY);
	const name = load(NAME_KEY) || "Untitled";
	if (saved && !name.startsWith("Example – ")) openData(saved, name);
	else openData(JSON.stringify(emptyData()), "Untitled");
})();
