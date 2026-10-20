import { toHebrewConj } from "../src/model";
const cases: [string, string][] = [["w","ו"],["b","ב"],["0","Ø"],["asr","אשר"],["kasr","כאשר"],["ky","כי"],["pn","פן"],["wothT","ועתהט"],["ed asr","עד אשר"],["oL-kn","על־כן"],["ky am","כי אם"],["כמ","כם"],["כםל","כמל"],["hnh","הנה"],["S","ס"],["B","ב"]];
let bad = 0;
for (const [i, want] of cases) { const got = toHebrewConj(i); if (got !== want) { bad++; console.log("FAIL", i, got, want); } }
console.log(bad ? `${bad} failed` : `all ${cases.length} ok`);
