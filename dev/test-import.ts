import fs from "fs";
import { importWorkbook } from "../src/xlsmImport";
import { computeLabels, levelLabel } from "../src/model";
(async () => {
	for (const p of process.argv.slice(2)) {
		const d = await importWorkbook(fs.readFileSync(p), p.split(/[\/]/).pop());
		const labels = computeLabels(d.clauses);
		let out = `===== ${p.split(/[\/]/).pop()} | passage="${d.passage}" | ${d.clauses.length} clauses\n`;
		d.clauses.forEach((c, i) => { out += `${labels[i].padEnd(4)} ${levelLabel(c).padEnd(6)} ${c.conj.padEnd(4)} ${c.pattern.padEnd(22)} ${c.notes.padEnd(30)} | ${c.he.slice(0, 30)} | ${c.en.slice(0, 40)}\n`; });
		fs.appendFileSync(process.env.OUT!, out);
	}
})();
