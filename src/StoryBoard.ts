import { Menu } from "obsidian";
import {
	STORY_BLOCK_WIDTH, STORY_FIELDS, STORY_FIELD_NAMES, STORY_FUNCTIONS, StoryBlock, StoryData, StoryLink,
	newId, newStoryBlock, storyFunctionIndex,
} from "./model";

// The Story tab: plot blocks laid out on a canvas and joined by arrows.
// Positions are stored unzoomed; the board multiplies them by the zoom and
// sets its font size from it, so everything inside a block scales in em.
// The view moves freely: dragging the background (or scrolling) shifts the
// whole plane by panX/panY, with no edges, so blocks can be put anywhere on
// screen at any zoom.

export interface StoryHost {
	story(): StoryData;
	// A structural edit (one undo step, then save and re-render).
	change(fn: () => void): void;
	// Typing in a field (undo steps are grouped by bursts).
	beginTyping(): void;
	typed(): void;
	// The view moved or zoomed (saved, but not an undo step).
	viewChanged(): void;
}

const BASE_FONT_PX = 14;
const GRID = 10;
const MIN_WIDTH = 170;
const PLANE_MARGIN = 400;
const SVG_NS = "http://www.w3.org/2000/svg";

type Side = "left" | "right" | "top" | "bottom";

function snap(v: number): number {
	return Math.round(v / GRID) * GRID;
}

function fieldText(el: HTMLElement): string {
	return (el.textContent || "").replace(/ /g, " ");
}

export class StoryBoard {
	readonly el: HTMLElement;
	private plane: HTMLElement;
	private svg: SVGSVGElement;
	private labelsEl: HTMLElement;
	private selectedBlock: string | null = null;
	private selectedLink: string | null = null;
	// Drag of a block, a resize handle, a new connection, or the background.
	private drag: {
		kind: "move" | "resize" | "connect" | "pan";
		id?: string;
		startX: number; startY: number;
		origX: number; origY: number; origW: number;
		moved: boolean;
	} | null = null;
	private ghost: SVGPathElement | null = null;
	// Origin of the rendered plane in canvas units (moved only for export).
	private ox = 0;
	private oy = 0;
	private emptyEl: HTMLElement | null = null;
	private wheelTimer: number | null = null;
	private dropTarget: string | null = null;

	constructor(parent: HTMLElement, private host: StoryHost) {
		this.el = parent.createDiv({ cls: "hds-board" });
		this.el.tabIndex = -1;
		this.plane = this.el.createDiv({ cls: "hds-plane" });
		this.svg = this.el.doc.createElementNS(SVG_NS, "svg");
		this.svg.classList.add("hds-links");
		this.plane.appendChild(this.svg);
		this.labelsEl = this.plane.createDiv({ cls: "hds-link-labels" });
		this.wire();
	}

	private get data(): StoryData { return this.host.story(); }
	private get zoom(): number { return this.data.zoom || 1; }

	// ---------- rendering ----------

	render(): void {
		const focus = this.captureFocus();
		const z = this.zoom;
		this.plane.style.fontSize = `${BASE_FONT_PX * z}px`;
		this.plane.querySelectorAll(".hds-block").forEach(n => n.remove());
		this.emptyEl?.remove();
		this.emptyEl = null;
		if (this.selectedBlock && !this.block(this.selectedBlock)) this.selectedBlock = null;
		if (this.selectedLink && !this.data.links.some(l => l.id === this.selectedLink)) this.selectedLink = null;
		this.applyView();

		if (!this.data.blocks.length) {
			// On the board, not the plane, so it stays put while panning.
			this.emptyEl = this.el.createDiv({ cls: "hds-empty da-empty-hint" });
			this.emptyEl.createDiv({ text: "No story blocks yet." });
			this.emptyEl.createDiv({ text: "Use + Block, or double-click the canvas to add one." });
		}
		for (const b of this.data.blocks) this.renderBlock(b);
		this.drawLinks();
		this.restoreFocus(focus);
	}

	private renderBlock(b: StoryBlock): void {
		const z = this.zoom;
		const el = this.plane.createDiv({ cls: "hds-block", attr: { "data-id": b.id } });
		el.style.left = `${(b.x - this.ox) * z}px`;
		el.style.top = `${(b.y - this.oy) * z}px`;
		el.style.width = `${b.w * z}px`;
		this.applyFunctionColor(el, b.fn);
		if (b.id === this.selectedBlock) el.addClass("is-selected");

		const head = el.createDiv({ cls: "hds-head", attr: { title: "Drag to move; click to select" } });
		const verses = this.field(head, b, "verses", "vv.", "hds-verses");
		verses.dir = "ltr";
		const fnWrap = head.createDiv({ cls: "hds-fn-wrap" });
		this.field(fnWrap, b, "fn", "Function", "hds-fn");
		const fnBtn = fnWrap.createEl("button", { cls: "hds-fn-menu", text: "▾", attr: { title: "Choose a function", "aria-label": "Choose a function" } });
		fnBtn.addEventListener("click", e => this.openFunctionMenu(b.id, e));
		const del = head.createEl("button", { cls: "hds-del", text: "×", attr: { title: "Delete block", "aria-label": "Delete block" } });
		del.addEventListener("click", () => this.deleteBlock(b.id));

		this.field(el, b, "title", "Title", "hds-title");
		this.field(el, b, "point", "Teaching point", "hds-point");

		const fields = el.createDiv({ cls: "hds-fields" });
		for (const f of STORY_FIELDS) {
			const row = fields.createDiv({ cls: "hds-field-row" });
			row.createDiv({ cls: "hds-field-label", text: STORY_FIELD_NAMES[f] });
			this.field(row, b, f, "—", "hds-field");
		}

		// Drag from a port to another block to connect them.
		for (const side of ["right", "bottom", "left", "top"] as Side[]) {
			el.createDiv({ cls: `hds-port hds-port-${side}`, attr: { title: "Drag to another block to connect" } });
		}
		el.createDiv({ cls: "hds-resize", attr: { title: "Drag to resize" } });
	}

	private field(parent: HTMLElement, b: StoryBlock, key: "verses" | "title" | "point" | "fn" | typeof STORY_FIELDS[number], placeholder: string, cls: string): HTMLElement {
		const el = parent.createDiv({ cls: `hds-edit ${cls}`, attr: { "data-field": key, "data-placeholder": placeholder, dir: "auto", spellcheck: "true" } });
		el.contentEditable = "plaintext-only";
		if (el.contentEditable !== "plaintext-only") el.contentEditable = "true";
		el.setText(b[key]);
		el.toggleClass("hds-is-empty", !b[key]);
		el.addEventListener("input", () => {
			this.host.beginTyping();
			b[key] = fieldText(el);
			el.toggleClass("hds-is-empty", !b[key]);
			if (key === "fn") this.applyFunctionColor(el.closest<HTMLElement>(".hds-block")!, b.fn);
			this.host.typed();
			// The block may have grown; arrows follow its edges.
			this.drawLinks();
		});
		el.addEventListener("keydown", e => {
			// One-line fields: Enter moves on instead of breaking the line.
			if (e.key === "Enter" && (key === "verses" || key === "fn" || key === "title" || e.ctrlKey)) {
				e.preventDefault();
				this.focusNextField(el);
			} else if (e.key === "Escape") {
				e.preventDefault();
				el.blur();
				this.el.focus({ preventScroll: true });
			}
		});
		el.addEventListener("paste", e => {
			const text = e.clipboardData?.getData("text/plain");
			if (text === undefined) return;
			e.preventDefault();
			const clean = key === "verses" || key === "fn" || key === "title" ? text.replace(/\s*\n\s*/g, " ") : text;
			this.el.doc.execCommand("insertText", false, clean);
		});
		return el;
	}

	private focusNextField(el: HTMLElement): void {
		const block = el.closest<HTMLElement>(".hds-block");
		if (!block) return;
		const all = Array.from(block.querySelectorAll<HTMLElement>(".hds-edit"));
		// Head order is verses, fn; then title and the fields.
		const order = ["verses", "fn", "title", "point", ...STORY_FIELDS].map(k => all.find(a => a.dataset.field === k)).filter(Boolean) as HTMLElement[];
		const next = order[order.indexOf(el) + 1];
		if (next) this.focusEnd(next); else el.blur();
	}

	private focusEnd(el: HTMLElement): void {
		el.focus();
		const sel = this.el.win.getSelection();
		if (!sel) return;
		const r = this.el.doc.createRange();
		r.selectNodeContents(el);
		r.collapse(false);
		sel.removeAllRanges();
		sel.addRange(r);
	}

	private applyFunctionColor(el: HTMLElement, fn: string): void {
		const i = storyFunctionIndex(fn);
		el.style.setProperty("--hds-fn-color", i >= 0 ? `var(--hds-fn-${i})` : "var(--da-border-strong)");
	}

	// ---------- arrows ----------

	private drawLinks(): void {
		const z = this.zoom;
		const svg = this.svg;
		while (svg.firstChild) svg.removeChild(svg.firstChild);
		this.labelsEl.empty();

		const defs = this.el.doc.createElementNS(SVG_NS, "defs");
		for (const [id, cls] of [["hds-arrow", "hds-arrow-head"], ["hds-arrow-sel", "hds-arrow-head is-selected"]]) {
			const marker = this.el.doc.createElementNS(SVG_NS, "marker");
			marker.setAttribute("id", id);
			marker.setAttribute("viewBox", "0 0 10 10");
			marker.setAttribute("refX", "9");
			marker.setAttribute("refY", "5");
			marker.setAttribute("markerWidth", "7");
			marker.setAttribute("markerHeight", "7");
			marker.setAttribute("orient", "auto-start-reverse");
			const p = this.el.doc.createElementNS(SVG_NS, "path");
			p.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
			p.setAttribute("class", cls);
			marker.appendChild(p);
			defs.appendChild(marker);
		}
		svg.appendChild(defs);

		const rects = new Map<string, DOMRect>();
		this.plane.querySelectorAll<HTMLElement>(".hds-block").forEach(el => {
			rects.set(el.dataset.id!, new DOMRect(el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight));
		});

		for (const link of this.data.links) {
			const a = rects.get(link.from), b = rects.get(link.to);
			if (!a || !b) continue;
			const { d, mid } = this.route(a, b);
			const selected = link.id === this.selectedLink;
			const hit = this.el.doc.createElementNS(SVG_NS, "path");
			hit.setAttribute("d", d);
			hit.setAttribute("class", "hds-link-hit");
			hit.dataset.linkId = link.id;
			const path = this.el.doc.createElementNS(SVG_NS, "path");
			path.setAttribute("d", d);
			path.setAttribute("class", "hds-link" + (selected ? " is-selected" : ""));
			path.setAttribute("marker-end", `url(#${selected ? "hds-arrow-sel" : "hds-arrow"})`);
			path.style.strokeWidth = `${Math.max(1, 1.6 * z)}px`;
			svg.appendChild(path);
			svg.appendChild(hit);

			if (link.label || selected) {
				const lab = this.labelsEl.createDiv({ cls: "hds-link-label" + (selected ? " is-selected" : "") + (link.label ? "" : " is-placeholder"), text: link.label || "label…", attr: { "data-link-id": link.id, title: "Double-click to edit the label" } });
				lab.style.left = `${mid.x}px`;
				lab.style.top = `${mid.y}px`;
			}
		}
		this.sizePlane(rects);
	}

	// A curve from the side of `a` facing `b` to the side of `b` facing `a`.
	private route(a: DOMRect, b: DOMRect): { d: string; mid: { x: number; y: number } } {
		const ac = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
		const bc = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
		const dx = bc.x - ac.x, dy = bc.y - ac.y;
		// Side by side unless one is clearly above the other.
		const horizontal = Math.abs(dx) - (a.width + b.width) / 4 > Math.abs(dy) - (a.height + b.height) / 4;
		let s: Side, t: Side;
		if (horizontal) { s = dx >= 0 ? "right" : "left"; t = dx >= 0 ? "left" : "right"; }
		else { s = dy >= 0 ? "bottom" : "top"; t = dy >= 0 ? "top" : "bottom"; }
		const p1 = this.anchor(a, s), p2 = this.anchor(b, t);
		const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
		const k = Math.max(30, Math.min(140, dist * 0.45));
		const c1 = this.push(p1, s, k), c2 = this.push(p2, t, k);
		const d = `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`;
		// Point at t = 0.5 on the cubic.
		const mid = { x: (p1.x + 3 * c1.x + 3 * c2.x + p2.x) / 8, y: (p1.y + 3 * c1.y + 3 * c2.y + p2.y) / 8 };
		return { d, mid };
	}

	private anchor(r: DOMRect, side: Side): { x: number; y: number } {
		switch (side) {
			case "left": return { x: r.x, y: r.y + r.height / 2 };
			case "right": return { x: r.x + r.width, y: r.y + r.height / 2 };
			case "top": return { x: r.x + r.width / 2, y: r.y };
			default: return { x: r.x + r.width / 2, y: r.y + r.height };
		}
	}

	private push(p: { x: number; y: number }, side: Side, k: number): { x: number; y: number } {
		return side === "left" ? { x: p.x - k, y: p.y } : side === "right" ? { x: p.x + k, y: p.y } : side === "top" ? { x: p.x, y: p.y - k } : { x: p.x, y: p.y + k };
	}

	// The plane covers its contents (the arrows' SVG needs a size); blocks
	// left of or above its origin still show, since nothing clips it.
	private sizePlane(rects: Map<string, DOMRect>): void {
		let w = 0, h = 0;
		rects.forEach(r => { w = Math.max(w, r.right); h = Math.max(h, r.bottom); });
		w += PLANE_MARGIN * this.zoom;
		h += PLANE_MARGIN * this.zoom;
		this.plane.style.width = `${w}px`;
		this.plane.style.height = `${h}px`;
		this.svg.setAttribute("width", String(w));
		this.svg.setAttribute("height", String(h));
	}

	// ---------- operations ----------

	private block(id: string): StoryBlock | undefined {
		return this.data.blocks.find(b => b.id === id);
	}

	private blockEl(id: string): HTMLElement | null {
		return this.plane.querySelector<HTMLElement>(`.hds-block[data-id="${CSS.escape(id)}"]`);
	}

	// A new block to the right of the selected block, at a given canvas
	// point, or in the middle of the view.
	addBlock(at?: { x: number; y: number }): void {
		const ref = this.selectedBlock ? this.block(this.selectedBlock) : undefined;
		const c = at ?? this.viewCenter();
		let x = snap(c.x - STORY_BLOCK_WIDTH / 2), y = snap(c.y - 20);
		if (!at && ref) { x = snap(ref.x + ref.w + 80); y = ref.y; }
		const b = newStoryBlock({ x, y });
		this.host.change(() => {
			this.data.blocks.push(b);
			this.selectedBlock = b.id;
			this.selectedLink = null;
		});
		const el = this.blockEl(b.id);
		const title = el?.querySelector<HTMLElement>('[data-field="verses"]');
		if (el) this.reveal(el);
		if (title) this.focusEnd(title);
	}

	private deleteBlock(id: string): void {
		this.host.change(() => {
			this.data.blocks = this.data.blocks.filter(b => b.id !== id);
			this.data.links = this.data.links.filter(l => l.from !== id && l.to !== id);
			if (this.selectedBlock === id) this.selectedBlock = null;
		});
	}

	private deleteLink(id: string): void {
		this.host.change(() => {
			this.data.links = this.data.links.filter(l => l.id !== id);
			if (this.selectedLink === id) this.selectedLink = null;
		});
	}

	private connect(from: string, to: string): void {
		if (from === to) return;
		const existing = this.data.links.find(l => l.from === from && l.to === to);
		if (existing) { this.selectLink(existing.id); return; }
		const link: StoryLink = { id: newId(), from, to, label: "" };
		this.host.change(() => {
			// Connecting the other way round replaces the opposite arrow.
			this.data.links = this.data.links.filter(l => !(l.from === to && l.to === from));
			this.data.links.push(link);
			this.selectedLink = link.id;
			this.selectedBlock = null;
		});
	}

	clearAll(): void {
		this.host.change(() => {
			this.data.blocks = [];
			this.data.links = [];
			this.selectedBlock = null;
			this.selectedLink = null;
		});
	}

	hasSelection(): boolean {
		return !!(this.selectedBlock || this.selectedLink);
	}

	deleteSelection(): void {
		if (this.selectedLink) this.deleteLink(this.selectedLink);
		else if (this.selectedBlock) this.deleteBlock(this.selectedBlock);
	}

	clearSelection(): void {
		this.selectedBlock = null;
		this.selectedLink = null;
		this.syncSelection();
	}

	private selectBlock(id: string | null): void {
		// Redrawing replaces the arrows, so skip it when nothing changes (a
		// double-click's second press must land on the same element).
		if (this.selectedBlock === id && !this.selectedLink) return;
		this.selectedBlock = id;
		this.selectedLink = null;
		this.syncSelection();
	}

	private selectLink(id: string | null): void {
		if (this.selectedLink === id && !this.selectedBlock) return;
		this.selectedLink = id;
		this.selectedBlock = null;
		this.syncSelection();
	}

	private syncSelection(): void {
		this.plane.querySelectorAll<HTMLElement>(".hds-block").forEach(el => el.toggleClass("is-selected", el.dataset.id === this.selectedBlock));
		this.drawLinks();
	}

	private openFunctionMenu(id: string, e: MouseEvent): void {
		const b = this.block(id);
		if (!b) return;
		const menu = new Menu();
		for (const f of STORY_FUNCTIONS) {
			menu.addItem(item => {
				item.setTitle(`${f.value}  —  ${f.hint}`);
				if (b.fn === f.value) item.setIcon("check");
				item.onClick(() => this.host.change(() => { b.fn = f.value; }));
			});
		}
		if (b.fn) {
			menu.addSeparator();
			menu.addItem(item => item.setTitle("Clear").onClick(() => this.host.change(() => { b.fn = ""; })));
		}
		menu.showAtMouseEvent(e);
	}

	private openLinkMenu(id: string, e: MouseEvent): void {
		const link = this.data.links.find(l => l.id === id);
		if (!link) return;
		const menu = new Menu();
		menu.addItem(item => item.setTitle(link.label ? "Edit label" : "Add label").onClick(() => this.editLinkLabel(id)));
		menu.addItem(item => item.setTitle("Reverse direction").onClick(() => this.host.change(() => { [link.from, link.to] = [link.to, link.from]; })));
		menu.addSeparator();
		menu.addItem(item => item.setTitle("Delete connection").onClick(() => this.deleteLink(id)));
		menu.showAtMouseEvent(e);
	}

	private editLinkLabel(id: string): void {
		const link = this.data.links.find(l => l.id === id);
		if (!link) return;
		this.selectedLink = id;
		this.selectedBlock = null;
		this.drawLinks();
		const lab = this.labelsEl.querySelector<HTMLElement>(`[data-link-id="${CSS.escape(id)}"]`);
		if (!lab) return;
		lab.empty();
		lab.removeClass("is-placeholder");
		const input = lab.createEl("input", { cls: "hds-link-input", attr: { type: "text", placeholder: "label", dir: "auto" } });
		input.value = link.label;
		input.focus();
		input.select();
		let done = false;
		const finish = (commit: boolean) => {
			if (done) return;
			done = true;
			const v = input.value.trim();
			if (commit && v !== link.label) this.host.change(() => { link.label = v; });
			else this.drawLinks();
		};
		input.addEventListener("keydown", e => {
			if (e.key === "Enter") { e.preventDefault(); finish(true); }
			else if (e.key === "Escape") { e.preventDefault(); finish(false); }
			e.stopPropagation();
		});
		input.addEventListener("blur", () => finish(true));
	}

	// ---------- view (pan + zoom) ----------

	private applyView(): void {
		const d = this.data, z = this.zoom;
		this.plane.style.transform = `translate(${d.panX}px, ${d.panY}px)`;
		// The dot grid moves and scales with the plane.
		const g = 20 * z;
		this.el.style.backgroundSize = `${g}px ${g}px`;
		this.el.style.backgroundPosition = `${d.panX - this.ox * z}px ${d.panY - this.oy * z}px`;
	}

	// Canvas point at the middle of the view.
	private viewCenter(): { x: number; y: number } {
		const z = this.zoom;
		return { x: (this.el.clientWidth / 2 - this.data.panX) / z + this.ox, y: (this.el.clientHeight / 2 - this.data.panY) / z + this.oy };
	}

	// Zooms around a point of the board (client coordinates), by default its
	// middle, keeping that point where it is on screen.
	setZoom(z: number, at?: { clientX: number; clientY: number }): void {
		const zoom = Math.round(Math.min(2, Math.max(0.2, z)) * 10) / 10;
		const old = this.zoom;
		if (zoom === old) return;
		const r = this.el.getBoundingClientRect();
		const ax = at ? at.clientX - r.left : this.el.clientWidth / 2;
		const ay = at ? at.clientY - r.top : this.el.clientHeight / 2;
		const d = this.data;
		d.panX = ax - ((ax - d.panX) / old) * zoom;
		d.panY = ay - ((ay - d.panY) / old) * zoom;
		d.zoom = zoom;
		this.render();
		this.host.viewChanged();
	}

	// Zooms and pans so every block is in view.
	fit(): void {
		const els = Array.from(this.plane.querySelectorAll<HTMLElement>(".hds-block"));
		const d = this.data;
		if (!els.length) { d.panX = 0; d.panY = 0; this.applyView(); this.host.viewChanged(); return; }
		const z = this.zoom;
		let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
		for (const el of els) {
			x0 = Math.min(x0, el.offsetLeft / z); y0 = Math.min(y0, el.offsetTop / z);
			x1 = Math.max(x1, (el.offsetLeft + el.offsetWidth) / z); y1 = Math.max(y1, (el.offsetTop + el.offsetHeight) / z);
		}
		const pad = 40;
		const W = this.el.clientWidth, H = this.el.clientHeight;
		const zoom = Math.floor(Math.min(1.5, Math.max(0.2, Math.min((W - 2 * pad) / (x1 - x0), (H - 2 * pad) / (y1 - y0)))) * 10) / 10;
		d.zoom = zoom;
		d.panX = (W - (x1 - x0) * zoom) / 2 - x0 * zoom;
		d.panY = (H - (y1 - y0) * zoom) / 2 - y0 * zoom;
		this.render();
		this.host.viewChanged();
	}

	// Pans just enough to bring a block into view.
	private reveal(el: HTMLElement): void {
		const d = this.data, pad = 24;
		const W = this.el.clientWidth, H = this.el.clientHeight;
		const left = el.offsetLeft + d.panX, top = el.offsetTop + d.panY;
		let dx = 0, dy = 0;
		if (left < pad) dx = pad - left;
		else if (left + el.offsetWidth > W - pad) dx = Math.max(pad - left, W - pad - (left + el.offsetWidth));
		if (top < pad) dy = pad - top;
		else if (top + el.offsetHeight > H - pad) dy = Math.max(pad - top, H - pad - (top + el.offsetHeight));
		if (!dx && !dy) return;
		d.panX += dx;
		d.panY += dy;
		this.applyView();
		this.host.viewChanged();
	}

	private panBy(dx: number, dy: number): void {
		this.data.panX += dx;
		this.data.panY += dy;
		this.applyView();
	}

	// The element to capture for the PNG export: just the area the blocks
	// cover, with arrow colors written out (the capture can't read CSS
	// variables inside SVG).
	prepareExport(): { el: HTMLElement; restore: () => void } {
		const styled: SVGElement[] = [];
		this.svg.querySelectorAll<SVGElement>(".hds-link, .hds-arrow-head").forEach(p => {
			const cs = getComputedStyle(p);
			p.style.stroke = cs.stroke;
			p.style.fill = cs.fill;
			styled.push(p);
		});
		// Captured at 100%, with the plane's origin moved to the top-left
		// block and the pan taken off.
		const d = this.data;
		const zoom = d.zoom;
		const margin = 20;
		d.zoom = 1;
		if (d.blocks.length) { this.ox = Math.min(...d.blocks.map(b => b.x)) - margin; this.oy = Math.min(...d.blocks.map(b => b.y)) - margin; }
		this.render();
		this.svg.querySelectorAll<SVGElement>(".hds-link, .hds-arrow-head").forEach(p => {
			const cs = getComputedStyle(p);
			p.style.stroke = cs.stroke;
			p.style.fill = cs.fill;
		});
		this.plane.addClass("hds-exporting");
		this.plane.setCssStyles({ transform: "none" });
		const prevW = this.plane.style.width, prevH = this.plane.style.height;
		let w = 0, h = 0;
		this.plane.querySelectorAll<HTMLElement>(".hds-block, .hds-link-label").forEach(el => {
			w = Math.max(w, el.offsetLeft + el.offsetWidth);
			h = Math.max(h, el.offsetTop + el.offsetHeight);
		});
		this.plane.style.width = `${w + margin}px`;
		this.plane.style.height = `${h + margin}px`;
		return {
			el: this.plane,
			restore: () => {
				this.plane.removeClass("hds-exporting");
				this.plane.style.width = prevW;
				this.plane.style.height = prevH;
				d.zoom = zoom;
				this.ox = 0;
				this.oy = 0;
				this.render();
			},
		};
	}

	// ---------- focus across re-renders ----------

	private captureFocus(): { id: string; field: string; caret: number } | null {
		const active = this.el.doc.activeElement as HTMLElement | null;
		if (!active || !this.plane.contains(active)) return null;
		const id = active.closest<HTMLElement>(".hds-block")?.dataset.id;
		const field = active.dataset.field;
		if (!id || !field) return null;
		const sel = this.el.win.getSelection();
		let caret = 0;
		if (sel && sel.rangeCount && active.contains(sel.anchorNode)) {
			const pre = this.el.doc.createRange();
			pre.selectNodeContents(active);
			pre.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
			caret = pre.toString().length;
		}
		return { id, field, caret };
	}

	private restoreFocus(f: { id: string; field: string; caret: number } | null): void {
		if (!f) return;
		const el = this.blockEl(f.id)?.querySelector<HTMLElement>(`[data-field="${f.field}"]`);
		if (!el) return;
		el.focus();
		const sel = this.el.win.getSelection();
		if (!sel) return;
		const walker = this.el.doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		let remaining = f.caret;
		for (let n = walker.nextNode(); n; n = walker.nextNode()) {
			const len = n.textContent?.length ?? 0;
			if (remaining <= len) {
				const r = this.el.doc.createRange();
				r.setStart(n, remaining);
				r.collapse(true);
				sel.removeAllRanges();
				sel.addRange(r);
				return;
			}
			remaining -= len;
		}
	}

	// ---------- pointer handling ----------

	// Canvas coordinates (unzoomed) of a mouse event.
	private point(e: MouseEvent): { x: number; y: number } {
		const r = this.plane.getBoundingClientRect();
		return { x: (e.clientX - r.left) / this.zoom + this.ox, y: (e.clientY - r.top) / this.zoom + this.oy };
	}

	private wire(): void {
		this.el.addEventListener("mousedown", e => this.onMouseDown(e));
		this.el.addEventListener("dblclick", e => {
			const t = e.target as HTMLElement;
			const labelEl = t.closest<HTMLElement>(".hds-link-label");
			if (labelEl) { e.preventDefault(); this.editLinkLabel(labelEl.dataset.linkId!); return; }
			const linkId = (t as unknown as SVGElement).dataset?.linkId;
			if (linkId) { e.preventDefault(); this.editLinkLabel(linkId); return; }
			if (t === this.el || t === this.plane || (t as Element) === this.svg || t === this.labelsEl || t.closest(".hds-empty")) {
				e.preventDefault();
				this.addBlock(this.point(e));
			}
		});
		this.el.addEventListener("wheel", e => {
			if (e.ctrlKey || e.metaKey) return; // zoom, handled by the view
			e.preventDefault();
			const k = e.deltaMode === 1 ? 16 : 1;
			if (e.shiftKey && !e.deltaX) this.panBy(-e.deltaY * k, 0);
			else this.panBy(-e.deltaX * k, -e.deltaY * k);
			if (this.wheelTimer !== null) window.clearTimeout(this.wheelTimer);
			this.wheelTimer = window.setTimeout(() => { this.wheelTimer = null; this.host.viewChanged(); }, 400);
		}, { passive: false });
		this.el.addEventListener("contextmenu", e => {
			const t = e.target as HTMLElement;
			const linkId = (t as unknown as SVGElement).dataset?.linkId ?? t.closest<HTMLElement>(".hds-link-label")?.dataset.linkId;
			if (linkId) { e.preventDefault(); this.selectLink(linkId); this.openLinkMenu(linkId, e); }
		});
	}

	private onMouseDown(e: MouseEvent): void {
		if (e.button !== 0) return;
		const t = e.target as HTMLElement;
		const blockEl = t.closest<HTMLElement>(".hds-block");
		const id = blockEl?.dataset.id;
		const base = { startX: e.clientX, startY: e.clientY, origX: 0, origY: 0, origW: 0, moved: false };

		const linkId = (t as unknown as SVGElement).dataset?.linkId ?? t.closest<HTMLElement>(".hds-link-label")?.dataset.linkId;
		if (linkId && !t.closest("input")) {
			e.preventDefault();
			this.selectLink(linkId);
			this.el.focus({ preventScroll: true });
			return;
		}
		if (blockEl && id) {
			const b = this.block(id);
			if (!b) return;
			if (t.classList.contains("hds-port")) {
				e.preventDefault();
				this.drag = { kind: "connect", id, ...base };
				this.startGhost();
			} else if (t.classList.contains("hds-resize")) {
				e.preventDefault();
				this.drag = { kind: "resize", id, ...base, origW: b.w };
			} else if (t.closest(".hds-edit, button")) {
				if (this.selectedBlock !== id) { this.selectedBlock = id; this.selectedLink = null; this.syncSelection(); }
				return;
			} else {
				e.preventDefault();
				(this.el.doc.activeElement as HTMLElement | null)?.blur?.();
				this.el.focus({ preventScroll: true });
				this.drag = { kind: "move", id, ...base, origX: b.x, origY: b.y };
				this.selectBlock(id);
			}
		} else {
			// Background: clear the selection and pan (without selecting text).
			e.preventDefault();
			this.el.win.getSelection()?.removeAllRanges();
			(this.el.doc.activeElement as HTMLElement | null)?.blur?.();
			this.el.focus({ preventScroll: true });
			if (this.hasSelection()) this.clearSelection();
			this.drag = { kind: "pan", ...base, origX: this.data.panX, origY: this.data.panY };
			this.el.addClass("is-panning");
		}
		const doc = this.el.doc;
		const move = (ev: MouseEvent) => this.onMouseMove(ev);
		const up = (ev: MouseEvent) => {
			doc.removeEventListener("mousemove", move);
			doc.removeEventListener("mouseup", up);
			this.onMouseUp(ev);
		};
		doc.addEventListener("mousemove", move);
		doc.addEventListener("mouseup", up);
	}

	private onMouseMove(e: MouseEvent): void {
		const d = this.drag;
		if (!d) return;
		const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
		if (!d.moved && Math.hypot(dx, dy) < 3) return;
		d.moved = true;
		const z = this.zoom;
		if (d.kind === "pan") {
			this.panBy(d.origX + dx - this.data.panX, d.origY + dy - this.data.panY);
			return;
		}
		const b = d.id ? this.block(d.id) : undefined;
		const el = d.id ? this.blockEl(d.id) : null;
		if (!b || !el) return;
		if (d.kind === "move") {
			el.style.left = `${snap(d.origX + dx / z) * z}px`;
			el.style.top = `${snap(d.origY + dy / z) * z}px`;
			this.drawLinks();
		} else if (d.kind === "resize") {
			el.style.width = `${Math.max(MIN_WIDTH, snap(d.origW + dx / z)) * z}px`;
			this.drawLinks();
		} else if (d.kind === "connect") {
			this.updateGhost(el, e);
		}
	}

	private onMouseUp(e: MouseEvent): void {
		const d = this.drag;
		this.drag = null;
		this.el.removeClass("is-panning");
		if (!d) return;
		const z = this.zoom;
		const b = d.id ? this.block(d.id) : undefined;
		const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
		if (d.kind === "connect") {
			const target = this.dropTarget;
			this.endGhost();
			if (b && target) this.connect(b.id, target);
			return;
		}
		if (d.kind === "pan") {
			if (d.moved) this.host.viewChanged();
			return;
		}
		if (!d.moved || !b) return;
		if (d.kind === "move") {
			const x = snap(d.origX + dx / z), y = snap(d.origY + dy / z);
			if (x !== b.x || y !== b.y) this.host.change(() => { b.x = x; b.y = y; });
		} else if (d.kind === "resize") {
			const w = Math.max(MIN_WIDTH, snap(d.origW + dx / z));
			if (w !== b.w) this.host.change(() => { b.w = w; });
		}
	}

	private startGhost(): void {
		this.ghost = this.el.doc.createElementNS(SVG_NS, "path");
		this.ghost.setAttribute("class", "hds-link hds-link-ghost");
		this.ghost.setAttribute("marker-end", "url(#hds-arrow-sel)");
		this.svg.appendChild(this.ghost);
		this.el.addClass("is-connecting");
	}

	private updateGhost(fromEl: HTMLElement, e: MouseEvent): void {
		if (!this.ghost) return;
		const over = (this.el.doc.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>(".hds-block");
		const target = over && over !== fromEl ? over.dataset.id! : null;
		if (target !== this.dropTarget) {
			this.plane.querySelectorAll(".hds-block.is-drop-target").forEach(n => n.removeClass("is-drop-target"));
			if (target) over!.addClass("is-drop-target");
			this.dropTarget = target;
		}
		const a = new DOMRect(fromEl.offsetLeft, fromEl.offsetTop, fromEl.offsetWidth, fromEl.offsetHeight);
		const r = this.plane.getBoundingClientRect();
		const p = { x: e.clientX - r.left, y: e.clientY - r.top };
		const b = target && over ? new DOMRect(over.offsetLeft, over.offsetTop, over.offsetWidth, over.offsetHeight) : new DOMRect(p.x, p.y, 0, 0);
		this.ghost.setAttribute("d", this.route(a, b).d);
	}

	private endGhost(): void {
		this.ghost?.remove();
		this.ghost = null;
		this.dropTarget = null;
		this.el.removeClass("is-connecting");
		this.plane.querySelectorAll(".hds-block.is-drop-target").forEach(n => n.removeClass("is-drop-target"));
	}
}
