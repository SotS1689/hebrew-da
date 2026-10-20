// Minimal stand-in for the parts of the Obsidian API the view uses, so it
// can run on a plain web page (dev/index.html) for visual checks.

type ElInfo = { cls?: string | string[]; text?: string; attr?: Record<string, string>; type?: string; value?: string };

function applyInfo(el: Element, info?: ElInfo | string): void {
	if (!info) return;
	if (typeof info === "string") { el.className = info; return; }
	if (info.cls) el.classList.add(...(Array.isArray(info.cls) ? info.cls : info.cls.split(/\s+/)).filter(Boolean));
	if (info.text !== undefined) el.textContent = info.text;
	if (info.attr) for (const [k, v] of Object.entries(info.attr)) el.setAttribute(k, v);
	if (info.type) (el as HTMLInputElement).type = info.type;
	if (info.value !== undefined) (el as HTMLInputElement).value = info.value;
}

const P = HTMLElement.prototype as any;
const NP = Element.prototype as any;
NP.createEl = function (tag: string, info?: ElInfo, cb?: (el: HTMLElement) => void) {
	const el = document.createElement(tag);
	applyInfo(el, info);
	this.appendChild(el);
	cb?.(el);
	return el;
};
NP.createDiv = function (info?: ElInfo, cb?: (el: HTMLElement) => void) { return this.createEl("div", info, cb); };
NP.createSpan = function (info?: ElInfo, cb?: (el: HTMLElement) => void) { return this.createEl("span", info, cb); };
NP.createSvg = function (tag: string, info?: ElInfo, cb?: (el: SVGElement) => void) {
	const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
	applyInfo(el, info);
	this.appendChild(el);
	cb?.(el);
	return el;
};
NP.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
NP.addClass = function (...c: string[]) { this.classList.add(...c.flatMap(x => x.split(/\s+/)).filter(Boolean)); };
NP.removeClass = function (...c: string[]) { this.classList.remove(...c); };
NP.toggleClass = function (c: string, on: boolean) { this.classList.toggle(c, on); };
NP.setText = function (t: string) { this.textContent = t; };
NP.setAttr = function (k: string, v: string) { this.setAttribute(k, v); };
NP.appendText = function (t: string) { this.appendChild(document.createTextNode(t)); };
P.hide = function () { this.style.display = "none"; };
P.show = function () { this.style.display = ""; };
// Cross-window helpers (popout windows); the harness has only one window.
NP.instanceOf = function (type: new () => unknown) { return this instanceof type; };
Object.defineProperty(NP, "doc", { get() { return this.ownerDocument ?? document; }, configurable: true });
Object.defineProperty(NP, "win", { get() { return (this.ownerDocument ?? document).defaultView ?? window; }, configurable: true });
P.setCssStyles = function (s: Record<string, string>) { Object.assign(this.style, s); };

const icons: Record<string, string> = {};
export function addIcon(name: string, svg: string): void { icons[name] = svg; }

export class Notice {
	constructor(msg: string, timeout = 4000) {
		const el = document.body.createDiv({ cls: "shim-notice", text: msg });
		window.setTimeout(() => el.remove(), timeout);
		console.log("[Notice]", msg);
	}
}

export class TFile { path = ""; name = ""; basename = ""; parent: { path: string } | null = { path: "" }; }
export class TFolder { path = ""; children: unknown[] = []; }

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
		document.querySelectorAll(".shim-menu").forEach(m => m.remove());
		const el = document.body.createDiv({ cls: "shim-menu" });
		for (const it of this.items) {
			if (it === "sep") { el.createDiv({ cls: "shim-menu-sep" }); continue; }
			const row = el.createDiv({ cls: "shim-menu-item", text: (it.icon === "check" ? "✓ " : "   ") + it.title });
			row.addEventListener("mousedown", ev => { ev.preventDefault(); el.remove(); it.handler?.(); });
		}
		el.style.left = `${e.clientX}px`;
		el.style.top = `${e.clientY}px`;
		const away = (ev: MouseEvent) => { if (!el.contains(ev.target as Node)) { el.remove(); document.removeEventListener("mousedown", away, true); } };
		window.setTimeout(() => document.addEventListener("mousedown", away, true), 0);
	}
}

export class Component {
	registerEvent(_e: unknown) { /* no-op */ }
	registerDomEvent(el: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions) { el.addEventListener(type, fn, opts); }
}

export class App {
	workspace = { on: (_n: string, _cb: unknown) => ({}) };
	vault = {
		getAbstractFileByPath: (_p: string) => null,
		// Keeps the export in memory (window.lastExport) instead of downloading.
		createBinary: async (p: string, data: ArrayBuffer) => {
			(window as any).lastExport = { path: p, bytes: data.byteLength, url: URL.createObjectURL(new Blob([data], { type: "image/png" })) };
		},
		modifyBinary: async () => { /* no-op */ },
	};
}

export class Modal {
	contentEl: HTMLElement;
	private wrap: HTMLElement;
	constructor(public app: App) {
		this.wrap = document.createElement("div");
		this.wrap.className = "shim-modal";
		this.contentEl = this.wrap.createDiv({ cls: "shim-modal-content" });
	}
	open() { document.body.appendChild(this.wrap); (this as any).onOpen?.(); }
	close() { (this as any).onClose?.(); this.wrap.remove(); }
}

export class WorkspaceLeaf {}

export class TextFileView extends Component {
	app = new App();
	file: TFile | null = null;
	contentEl: HTMLElement;
	saved = "";
	constructor(_leaf: WorkspaceLeaf) {
		super();
		this.contentEl = document.createElement("div");
	}
	requestSave() {
		window.clearTimeout((this as any)._st);
		(this as any)._st = window.setTimeout(() => this.save(), 300);
	}
	async save() {
		this.saved = (this as any).getViewData();
		try { localStorage.setItem("hda-harness", this.saved); } catch { /* ignore */ }
	}
}
