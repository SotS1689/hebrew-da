// Runs HDAView on a plain page with the Obsidian shim. Loads ?file=<json>
// (default sample.json), or what the harness last saved when ?resume.
import { TFile, WorkspaceLeaf } from "obsidian";
import { HDAView, HdaSettings, defaultSettings } from "../src/HDAView";

const settings: HdaSettings = defaultSettings();
const params = new URLSearchParams(location.search);
if (params.get("theme")) settings.colorTheme = params.get("theme")!;
if (params.get("mode")) settings.mode = params.get("mode") as HdaSettings["mode"];
(window as any).hdaSettings = settings;

const host = {
	app: null as any,
	settings,
	saveSettings: async () => { /* in-memory only */ },
	refreshAllViews: () => view.refreshTheming(),
};

const view = new HDAView(new WorkspaceLeaf(), host as any);
const file = new TFile();
file.basename = "Harness";
file.name = "Harness.hda";
(view as any).file = file;
document.getElementById("app")!.appendChild(view.contentEl);
(window as any).hdaView = view;

(async () => {
	await view.onOpen();
	let text = "";
	if (params.has("resume")) text = localStorage.getItem("hda-harness") || "";
	if (!text) {
		const name = params.get("file") || "sample.json";
		const res = await fetch(name);
		text = res.ok ? await res.text() : "";
	}
	view.setViewData(text, true);
})();
