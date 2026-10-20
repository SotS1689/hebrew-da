// Stand-in for the parts of the Obsidian API the view uses, for the web
// version. The DOM helpers (createEl, addClass, ...) come from the dev shim;
// dialogs, menus and notices are drawn inside the view so they pick up its
// colors, and the "vault" saves files as browser downloads.

import { Component, TFile, TFolder, WorkspaceLeaf, addIcon } from "../dev/obsidian-shim";
export { Component, TFile, TFolder, WorkspaceLeaf, addIcon };

function host(): HTMLElement {
	return document.querySelector<HTMLElement>(".hda-view") ?? document.body;
}

export function download(name: string, data: BlobPart, type: string): void {
	const url = URL.createObjectURL(new Blob([data], { type }));
	const a = document.createElement("a");
	a.href = url;
	a.download = name;
	document.body.appendChild(a);
	a.click();
	a.remove();
	window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export class Notice {
	constructor(msg: string, timeout = 4000) {
		// The view reports PNG exports as saved into the vault.
		msg = msg.replace(/^Saved (.*\.png)$/, "Downloaded $1");
		const el = host().createDiv({ cls: "web-notice", text: msg });
		window.setTimeout(() => el.remove(), timeout);
	}
}

class MenuItem {
	title = ""; icon = ""; handler: (() => void) | null = null;
	setTitle(t: string) { this.title = t; return this; }
	setIcon(i: string) { this.icon = i; return this; }
	onClick(fn: () => void) { this.handler = fn; return this; }
}

export class Menu {
	private items: (MenuItem | "sep")[] = [];
	addItem(cb: (item: MenuItem) => void) { const it = new MenuItem(); cb(it); this.items.push(it); return this; }
	addSeparator() { this.items.push("sep"); return this; }
	showAtMouseEvent(e: MouseEvent) {
		document.querySelectorAll(".web-menu").forEach(m => m.remove());
		const el = host().createDiv({ cls: "web-menu da-ui-scaled" });
		for (const it of this.items) {
			if (it === "sep") { el.createDiv({ cls: "web-menu-sep" }); continue; }
			const row = el.createDiv({ cls: "web-menu-item" });
			row.createSpan({ cls: "web-menu-check", text: it.icon === "check" ? "✓" : "" });
			row.createSpan({ text: it.title });
			row.addEventListener("mousedown", ev => { ev.preventDefault(); close(); it.handler?.(); });
		}
		const away = (ev: MouseEvent) => { if (!el.contains(ev.target as Node)) close(); };
		const close = () => { el.remove(); document.removeEventListener("mousedown", away, true); };
		// Keep the menu on screen.
		const r = el.getBoundingClientRect();
		el.style.left = `${Math.max(4, Math.min(e.clientX, window.innerWidth - r.width - 4))}px`;
		el.style.top = `${Math.max(4, Math.min(e.clientY, window.innerHeight - r.height - 4))}px`;
		window.setTimeout(() => document.addEventListener("mousedown", away, true), 0);
	}
}

export class App {
	workspace = { on: (_n: string, _cb: unknown) => ({}) };
	vault = {
		getAbstractFileByPath: (_p: string) => null,
		createBinary: async (p: string, data: ArrayBuffer) => {
			download(p.split("/").pop() || "export.png", data, "image/png");
		},
		modifyBinary: async () => { /* never reached: getAbstractFileByPath finds nothing */ },
	};
}

export class Modal {
	contentEl: HTMLElement;
	private backdrop: HTMLElement;
	private onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.close(); } };
	constructor(public app: App) {
		this.backdrop = document.createElement("div");
		this.backdrop.className = "da-modal-backdrop";
		const modal = this.backdrop.createDiv({ cls: "da-modal da-modal-narrow da-ui-scaled web-modal" });
		this.contentEl = modal.createDiv({ cls: "da-modal-body" });
		this.backdrop.addEventListener("mousedown", e => { if (e.target === this.backdrop) this.close(); });
	}
	open() {
		host().appendChild(this.backdrop);
		document.addEventListener("keydown", this.onKey, true);
		(this as any).onOpen?.();
	}
	close() {
		document.removeEventListener("keydown", this.onKey, true);
		(this as any).onClose?.();
		this.backdrop.remove();
	}
}

export class TextFileView extends Component {
	app = new App();
	file: TFile | null = null;
	contentEl: HTMLElement;
	constructor(_leaf: WorkspaceLeaf) {
		super();
		this.contentEl = document.createElement("div");
	}
	// Edits are kept in the browser as they happen (see web/app.ts).
	onSaved: ((text: string) => void) | null = null;
	requestSave() {
		window.clearTimeout((this as any)._st);
		(this as any)._st = window.setTimeout(() => void this.save(), 300);
	}
	async save() {
		this.onSaved?.((this as any).getViewData());
	}
}
