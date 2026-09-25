// 每次构建把 sw.js 的 CACHE 版本号换成时间戳，保证发布新版本时浏览器更新 SW 并清理旧缓存
import { readFileSync, writeFileSync } from "node:fs";
const p = new URL("../public/sw.js", import.meta.url);
const src = readFileSync(p, "utf8");
const stamp = `wo-shell-${Date.now()}`;
const out = src.replace(/wo-shell-v1|wo-shell-\d+/g, stamp);
writeFileSync(p, out);
console.log("SW cache bumped:", stamp);
