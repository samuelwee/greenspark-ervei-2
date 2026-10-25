// Starts the API (3001) and the web app (5173) together; Ctrl+C stops both.
import { spawn } from "node:child_process";

const procs = [
  ["api", ["run", "dev", "-w", "api"]],
  ["web", ["run", "dev", "-w", "web"]],
].map(([name, args]) => {
  // npm is a .cmd shim on Windows. Launch its JS entry point when npm started us.
  const entry = process.env.npm_execpath;
  const p = spawn(entry ? process.execPath : "npm", entry ? [entry, ...args] : args, {
    stdio: ["ignore", "pipe", "pipe"], shell: !entry && process.platform === "win32",
  });
  const tag = (chunk) => String(chunk).split("\n").filter(Boolean).forEach((l) => console.log(`[${name}] ${l}`));
  p.stdout.on("data", tag);
  p.stderr.on("data", tag);
  p.on("error", (error) => { console.error(`[${name}] ${error.message}`); stop(); });
  p.on("exit", (code) => { console.log(`[${name}] exited (${code ?? "signal"})`); stop(); });
  return p;
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const p of procs) p.kill("SIGTERM");
  setTimeout(() => process.exit(0), 500);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
