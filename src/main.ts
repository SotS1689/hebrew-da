import { AbstractInputSuggest, App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, normalizePath, setIcon } from "obsidian";
import {
	COLOR_THEMES, DEFAULT_HEBREW_FONT, HDA_ICON, HDAView, HdaSettings, UI_SCALE_STEPS, VIEW_TYPE_HDA, defaultSettings,
} from "./HDAView";
import { HdaData, emptyData } from "./model";
import { importWorkbook } from "./xlsmImport";

const EXTENSION = "hda";
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|]/g;

class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(app: App, inputEl: HTMLInputElement, private onPick: (path: string) => void) {
		super(app, inputEl);
	}

	protected getSuggestions(query: string): TFolder[] {
		const q = query.trim().toLowerCase().replace(/^\/+/, "");
		const folders: TFolder[] = [];
		const collect = (folder: TFolder) => {
			if (folder.path.toLowerCase().includes(q)) folders.push(folder);
			for (const child of folder.children) if (child instanceof TFolder) collect(child);
		};
		collect(this.app.vault.getRoot());
		return folders.sort((a, b) => a.path.localeCompare(b.path));
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path === "" || folder.path === "/" ? "/ (vault root)" : folder.path);
	}

	selectSuggestion(folder: TFolder): void {
		this.setValue(folder.path);
		this.onPick(folder.path);
		this.close();
	}
}

// Title + folder prompt for a new analysis (or the destination of imports).
class NewFileModal extends Modal {
	constructor(
		app: App,
		private heading: string,
		private titleValue: string | null,
		private folderValue: string,
		private onSubmit: (title: string, folder: string) => void,
	) { super(app); }

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: this.heading });
		let titleInput: HTMLInputElement | null = null;
		if (this.titleValue !== null) {
			contentEl.createEl("label", { cls: "hda-prompt-label", text: "Title" });
			titleInput = contentEl.createEl("input", { cls: "hda-prompt-input", type: "text", value: this.titleValue });
			titleInput.addEventListener("input", () => { this.titleValue = titleInput!.value; });
		}
		contentEl.createEl("label", { cls: "hda-prompt-label", text: "Folder" });
		const folderInput = contentEl.createEl("input", { cls: "hda-prompt-input", type: "text", value: this.folderValue, attr: { placeholder: "/ (vault root)" } });
		folderInput.addEventListener("input", () => { this.folderValue = folderInput.value; });
		new FolderSuggest(this.app, folderInput, path => { this.folderValue = path; });

		const row = contentEl.createDiv({ cls: "hda-prompt-buttons" });
		row.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		const ok = row.createEl("button", { text: this.titleValue !== null ? "Create" : "Choose files…", cls: "mod-cta" });
		const submit = () => {
			const title = (this.titleValue ?? "").replace(ILLEGAL_FILENAME_CHARS, "").trim() || "Untitled";
			const folder = this.folderValue.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
			this.close();
			this.onSubmit(title, folder);
		};
		ok.addEventListener("click", submit);
		(titleInput ?? folderInput).addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
		window.setTimeout(() => { (titleInput ?? folderInput).focus(); titleInput?.select(); }, 0);
	}

	onClose(): void { this.contentEl.empty(); }
}

export default class HebrewDAPlugin extends Plugin {
	settings: HdaSettings = defaultSettings();

	async onload() {
		const loaded = await this.loadData();
		const defaults = defaultSettings();
		this.settings = Object.assign(defaults, loaded, { columns: Object.assign({}, defaults.columns, loaded?.columns) });
		if (!COLOR_THEMES.some(t => t.id === this.settings.colorTheme)) this.settings.colorTheme = "standard";
		if (!UI_SCALE_STEPS.includes(this.settings.uiScale)) this.settings.uiScale = 1;

		if (!["auto", "light", "dark"].includes(this.settings.mode)) this.settings.mode = "auto";

		this.registerView(VIEW_TYPE_HDA, leaf => new HDAView(leaf, this));
		// Obsidian switched light/dark (or theme): views on "auto" follow it.
		this.registerEvent(this.app.workspace.on("css-change", () => this.refreshAllViews()));
		this.registerExtensions([EXTENSION], VIEW_TYPE_HDA);
		this.addSettingTab(new HdaSettingTab(this.app, this));

		this.addRibbonIcon(HDA_ICON, "Create new Hebrew Discourse Analysis", () => this.openCreateModal());
		this.app.workspace.onLayoutReady(() => this.watchFileExplorers());
		this.registerEvent(this.app.workspace.on("layout-change", () => this.watchFileExplorers()));

		this.addCommand({ id: "create-new", name: "Create new analysis", callback: () => this.openCreateModal() });
		this.addCommand({ id: "import-excel", name: "Import Excel DA workbooks (.xlsm)", callback: () => this.openImport() });
		this.addCommand({
			id: "toggle-sidebar",
			name: "Toggle sidebar",
			checkCallback: checking => {
				const view = this.app.workspace.getActiveViewOfType(HDAView);
				if (!view) return false;
				if (!checking) view.toggleSidebar();
				return true;
			},
		});
		this.addCommand({
			id: "open-function-reference",
			name: "Open Function of Communication chart",
			checkCallback: checking => {
				const view = this.app.workspace.getActiveViewOfType(HDAView);
				if (!view) return false;
				if (!checking) view.openReference(null, null);
				return true;
			},
		});
	}

	onunload(): void {
		document.querySelectorAll(".hda-file-icon").forEach(el => el.remove());
	}

	// File Explorer: give .hda files the same vav icon as the ribbon/command.
	// The explorer re-renders rows as folders open and the list scrolls, so
	// each explorer is watched and new rows are decorated as they appear.
	private watchedExplorers = new WeakSet<HTMLElement>();

	private watchFileExplorers(): void {
		this.app.workspace.getLeavesOfType("file-explorer").forEach(leaf => {
			const el = leaf.view.containerEl;
			this.decorateHdaFiles(el);
			if (this.watchedExplorers.has(el)) return;
			this.watchedExplorers.add(el);
			const observer = new MutationObserver(() => this.decorateHdaFiles(el));
			observer.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-path"] });
			this.register(() => observer.disconnect());
		});
	}

	private decorateHdaFiles(root: HTMLElement): void {
		root.querySelectorAll<HTMLElement>(".nav-file-title").forEach(title => {
			const isHda = (title.dataset.path ?? "").toLowerCase().endsWith(`.${EXTENSION}`);
			const icon = title.querySelector(":scope > .hda-file-icon");
			if (isHda && !icon) {
				const span = createSpan({ cls: "hda-file-icon" });
				setIcon(span, HDA_ICON);
				title.prepend(span);
			} else if (!isHda && icon) {
				icon.remove();
			}
		});
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	refreshAllViews(): void {
		this.app.workspace.getLeavesOfType(VIEW_TYPE_HDA).forEach(leaf => {
			if (leaf.view instanceof HDAView) leaf.view.refreshTheming();
		});
	}

	private defaultFolder(): string {
		return this.app.fileManager.getNewFileParent("").path;
	}

	private openCreateModal(): void {
		new NewFileModal(this.app, "New Hebrew Discourse Analysis", "Untitled", this.defaultFolder(), (title, folder) => {
			const data = emptyData();
			if (/\d/.test(title)) data.passage = title.replace(/^DA of\s+/i, "");
			void this.createFile(title, folder, data).then(file => file && this.app.workspace.getLeaf(true).openFile(file));
		}).open();
	}

	private openImport(): void {
		new NewFileModal(this.app, "Import Excel DA workbooks", null, this.defaultFolder(), (_title, folder) => {
			const input = document.createElement("input");
			input.type = "file";
			input.accept = ".xlsm,.xlsx";
			input.multiple = true;
			input.addEventListener("change", () => { void this.importFiles(Array.from(input.files ?? []), folder); });
			input.click();
		}).open();
	}

	private async importFiles(files: File[], folder: string): Promise<void> {
		let first: TFile | null = null;
		let count = 0;
		for (const f of files) {
			try {
				const data = await importWorkbook(await f.arrayBuffer(), f.name);
				const title = f.name.replace(/\.[^.]+$/, "").replace(ILLEGAL_FILENAME_CHARS, "").trim() || "Imported";
				const file = await this.createFile(title, folder, data);
				if (file) { count++; first ??= file; }
			} catch (err) {
				console.error(`Hebrew DA: import of ${f.name} failed`, err);
				new Notice(`Couldn't import ${f.name}: ${err instanceof Error ? err.message : err}`, 10000);
			}
		}
		if (count) new Notice(`Imported ${count} workbook${count === 1 ? "" : "s"}.`);
		if (first) await this.app.workspace.getLeaf(true).openFile(first);
	}

	private async createFile(title: string, folder: string, data: HdaData): Promise<TFile | null> {
		folder = folder ? normalizePath(folder) : "";
		if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
			try { await this.app.vault.createFolder(folder); } catch (err) { console.error("Hebrew DA: couldn't create folder", err); }
		}
		const base = `${folder ? folder + "/" : ""}${title}`;
		let path = normalizePath(`${base}.${EXTENSION}`);
		for (let i = 1; this.app.vault.getAbstractFileByPath(path); i++) path = normalizePath(`${base} ${i}.${EXTENSION}`);
		try {
			return await this.app.vault.create(path, JSON.stringify({ ...data, timestamp: new Date().toISOString() }, null, 2));
		} catch (err) {
			console.error("Hebrew DA: couldn't create file", err);
			new Notice("Couldn't create the Hebrew DA file.");
			return null;
		}
	}
}

class HdaSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: HebrewDAPlugin) { super(app, plugin); }

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;
		const save = async () => { await this.plugin.saveSettings(); this.plugin.refreshAllViews(); };

		new Setting(containerEl)
			.setName("Color theme")
			.setDesc("Standard is the tool's own palette (the same as DA-Tool's); Theme follows your Obsidian theme. Each scheme has a light and a dark version (see Light / dark mode below).")
			.addDropdown(d => {
				for (const t of COLOR_THEMES) d.addOption(t.id, t.label);
				d.setValue(s.colorTheme).onChange(async v => { s.colorTheme = v; await save(); });
			});

		new Setting(containerEl)
			.setName("Light / dark mode")
			.setDesc("Auto follows Obsidian's own mode. Also the 🌙/☀️ switch in the header.")
			.addDropdown(d => {
				d.addOption("auto", "Auto (follow Obsidian)").addOption("light", "Light").addOption("dark", "Dark");
				d.setValue(s.mode).onChange(async v => { s.mode = v as HdaSettings["mode"]; await save(); });
			});

		new Setting(containerEl)
			.setName("UI size")
			.setDesc("Scales the header, toolbar, sidebar and dialogs. The worksheet has its own zoom.")
			.addDropdown(d => {
				for (const step of UI_SCALE_STEPS) d.addOption(String(step), `${Math.round(step * 100)}%`);
				d.setValue(String(s.uiScale)).onChange(async v => { s.uiScale = Number(v); await save(); });
			});

		new Setting(containerEl)
			.setName("Hebrew font")
			.setDesc("A CSS font list; the first installed font is used.")
			.addText(t => t.setPlaceholder(DEFAULT_HEBREW_FONT).setValue(s.hebrewFont).onChange(async v => { s.hebrewFont = v.trim() || DEFAULT_HEBREW_FONT; await save(); }))
			.addExtraButton(b => b.setIcon("rotate-ccw").setTooltip("Reset").onClick(async () => { s.hebrewFont = DEFAULT_HEBREW_FONT; await save(); this.display(); }));

		new Setting(containerEl)
			.setName("Hebrew size")
			.setDesc("Size of the Hebrew text relative to the English.")
			.addSlider(sl => sl.setLimits(1, 2, 0.05).setValue(s.hebrewScale).setDynamicTooltip().onChange(async v => { s.hebrewScale = v; await save(); }));

		new Setting(containerEl)
			.setName("Indent width")
			.setDesc("Width of one mainline/offline level, in em.")
			.addSlider(sl => sl.setLimits(0.8, 3, 0.1).setValue(s.indentStep).setDynamicTooltip().onChange(async v => { s.indentStep = v; await save(); }));

		new Setting(containerEl)
			.setName("Indent guides")
			.setDesc("Faint lines marking each level's column (also the Guides button).")
			.addToggle(t => t.setValue(s.showGuides).onChange(async v => { s.showGuides = v; await save(); }));
	}
}
