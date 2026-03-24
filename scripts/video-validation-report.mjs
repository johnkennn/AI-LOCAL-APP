import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

function getStoreDir() {
  return path.join(os.homedir(), ".ai-local-app", "video-pipeline-records");
}

function pct(numerator, denominator) {
  if (!denominator) return "0.0%";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function looksChinese(text) {
  const zh = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length;
  return zh >= 6;
}

async function main() {
  const storeDir = getStoreDir();
  let files = [];
  try {
    files = (await fs.readdir(storeDir)).filter((f) => f.endsWith(".json") && f !== "cache-index.json");
  } catch {
    console.log("未发现本地视频分析持久化目录：", storeDir);
    process.exit(0);
  }

  if (files.length === 0) {
    console.log("未发现历史视频分析记录。");
    process.exit(0);
  }

  let valid = 0;
  let hasTimeline = 0;
  let zhSummary = 0;
  const sample = [];

  for (const f of files) {
    const full = path.join(storeDir, f);
    try {
      const raw = await fs.readFile(full, "utf8");
      const parsed = JSON.parse(raw);
      const analysis = parsed?.result?.analysis;
      if (!analysis) continue;
      valid += 1;
      if (Array.isArray(analysis.timeline) && analysis.timeline.length > 0) hasTimeline += 1;
      if (typeof analysis.summary === "string" && looksChinese(analysis.summary)) zhSummary += 1;
      if (sample.length < 5) {
        sample.push({
          id: parsed?.id ?? f.replace(".json", ""),
          createdAt: parsed?.createdAt ?? "-",
          timelineCount: Array.isArray(analysis.timeline) ? analysis.timeline.length : 0,
        });
      }
    } catch {
      // ignore invalid json
    }
  }

  console.log("=== 视频分析历史记录汇总 ===");
  console.log("记录文件总数:", files.length);
  console.log("有效分析记录:", valid);
  console.log("含时间线记录:", hasTimeline, `(${pct(hasTimeline, Math.max(valid, 1))})`);
  console.log("中文摘要记录:", zhSummary, `(${pct(zhSummary, Math.max(valid, 1))})`);
  console.log("");
  console.log("样本记录（最多 5 条）:");
  for (const item of sample) {
    console.log(`- ${item.id} | ${item.createdAt} | timeline=${item.timelineCount}`);
  }
}

await main();
