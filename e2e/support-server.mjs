// Isolated full-dataset server for grouped-map browser verification, on Windows or Unix.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const runtime = resolve("e2e/.runtime/support-map");
mkdirSync(runtime, { recursive: true });
for (const name of ["case-queue.all.json", "accounts.all.jsonl"]) writeFileSync(resolve(runtime, name), gunzipSync(readFileSync(resolve("data/synthetic", `${name}.gz`))));
writeFileSync(resolve(runtime, "flow.json"), readFileSync("data/admin/utility_hardship_mapping.json"));
const server = spawn(process.execPath, ["--import", "tsx", "api/src/server.ts"], { stdio: "inherit", env: {
  ...process.env, PORT: "3102", GREENSPARK_FIXTURE: resolve(runtime, "case-queue.all.json"), GREENSPARK_ACCOUNTS: resolve(runtime, "accounts.all.jsonl"),
  GREENSPARK_DB: resolve(runtime, `cases-${process.pid}.sqlite`), GREENSPARK_FLOW_FILE: resolve(runtime, "flow.json"),
  WEATHER_MODE: "demo", EMERGENCY_FEED: "off", ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "", GREENSPARK_BASIC_AUTH: "",
} });
server.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGTERM", () => server.kill());
process.on("SIGINT", () => server.kill());
