// Writes dev/<name>.json from an Excel workbook, for the harness.
import fs from "fs";
import { importWorkbook } from "../src/xlsmImport";
(async () => {
	const [src, out] = process.argv.slice(2);
	const d = await importWorkbook(fs.readFileSync(src), src.split(/[\/]/).pop());
	fs.writeFileSync(out, JSON.stringify(d, null, 2));
})();
