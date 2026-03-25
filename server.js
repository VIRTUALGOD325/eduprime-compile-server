import express from "express";
import cors from "cors";
import { exec } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";

const app = express();
const PORT = process.env.PORT || 3100;

// Allow all origins (the frontend is on Vercel, Link is on localhost)
app.use(cors());
app.use(express.json({ limit: "5mb" }));

// ── Arduino CLI wrapper ──

const CLI = process.env.ARDUINO_CLI_PATH || "arduino-cli";
let coreReady = false;

function run(command) {
  return new Promise((resolve, reject) => {
    console.log(`[CMD] ${command}`);
    exec(command, { timeout: 120_000 }, (error, stdout, stderr) => {
      if (error) {
        console.error(`[CMD] Error: ${stderr || error.message}`);
        reject(new Error(stderr || error.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

async function ensureCore() {
  if (coreReady) return;
  console.log("[Setup] Checking arduino:avr core...");
  const list = await run(`${CLI} core list`);
  if (!list.includes("arduino:avr")) {
    console.log("[Setup] Installing arduino:avr core...");
    await run(`${CLI} core install arduino:avr`);
  }
  // Install common libraries
  const libs = ["IRremote@2.6.0", "Servo", "DHT sensor library", "Adafruit NeoPixel"];
  for (const lib of libs) {
    try {
      await run(`${CLI} lib install "${lib}"`);
    } catch {
      console.warn(`[Setup] Could not install ${lib}`);
    }
  }
  coreReady = true;
  console.log("[Setup] Core and libraries ready!");
}

// ── Routes ──

app.get("/health", (_req, res) => {
  res.json({ status: "ok", coreReady, timestamp: Date.now() });
});

// Compile-only (verify code compiles)
app.post("/api/compile", async (req, res) => {
  const { code, board } = req.body;
  if (!code) return res.status(400).json({ success: false, error: "Missing code" });

  try {
    await ensureCore();
    const fqbn = board || "arduino:avr:uno";
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "eduprime-"));
    const sketchPath = path.join(tmpDir, "sketch.ino");
    await fs.writeFile(sketchPath, code);

    try {
      await run(`${CLI} compile --fqbn ${fqbn} "${tmpDir}"`);
      res.json({ success: true, message: "Compilation successful!" });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Compile and return hex binary (for browser WebSerial flashing)
app.post("/api/compile-hex", async (req, res) => {
  const { code, board } = req.body;
  if (!code) return res.status(400).json({ success: false, error: "Missing code" });

  try {
    await ensureCore();
    const fqbn = board || "arduino:avr:uno";
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "eduprime-"));
    const sketchPath = path.join(tmpDir, "sketch.ino");
    await fs.writeFile(sketchPath, code);

    try {
      await run(`${CLI} compile --fqbn ${fqbn} "${tmpDir}"`);

      // Find the compiled hex file
      const buildDir = path.join(tmpDir, "build", fqbn.replace(/:/g, "."));
      const hexPath = path.join(buildDir, "sketch.ino.hex");

      try {
        const hex = await fs.readFile(hexPath, "utf-8");
        res.json({ success: true, hex, message: "Compilation successful!" });
      } catch {
        // Fallback: search for any .hex file in the build directory
        const buildExists = await fs.stat(buildDir).catch(() => null);
        if (buildExists) {
          const files = await fs.readdir(buildDir);
          const hexFile = files.find((f) => f.endsWith(".hex"));
          if (hexFile) {
            const hex = await fs.readFile(path.join(buildDir, hexFile), "utf-8");
            res.json({ success: true, hex, message: "Compilation successful!" });
            return;
          }
        }
        throw new Error("Compiled hex file not found");
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Start ──

app.listen(PORT, "0.0.0.0", async () => {
  console.log(`🔧 EduPrime Compile Server running on port ${PORT}`);
  // Pre-warm: install core on startup
  try {
    await ensureCore();
  } catch (e) {
    console.error("[Setup] Pre-warm failed:", e.message);
  }
});
