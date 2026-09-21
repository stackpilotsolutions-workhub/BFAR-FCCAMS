const os = require("os");
const path = require("path");

// Environment check
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const isConfigured = Boolean(supabaseUrl && supabaseAnonKey);

function getLANIPs() {
  const n = os.networkInterfaces();
  const ips = [];
  Object.values(n).forEach((arr) => {
    (arr || []).forEach((x) => {
      if (x.family === "IPv4" && !x.internal) ips.push(x.address);
    });
  });
  return ips;
}

function makeFallbackApp(err) {
  const express = require("express");
  const fa = express();
  fa.use(express.json());
  fa.all("*", (req, res) => {
    res.status(500).json({
      error: "Backend initialization failed on Vercel Serverless Function",
      detail: err && err.message ? err.message : String(err),
      stack:
        process.env.NODE_ENV === "development"
          ? (err && err.stack) || null
          : undefined,
    });
  });
  return fa;
}

let app;

try {
  if (isConfigured) {
    console.log("[Vercel] Loading Supabase Backend...");
    app = require(path.resolve(__dirname, "..", "server.supabase.js"));
  } else {
    console.warn(
      "[Vercel] WARNING: Supabase keys missing! Falling back to Local LowDB...",
    );
    app = require(path.resolve(__dirname, "..", "server.local.js"));
  }
} catch (err) {
  console.error("[Vercel] FATAL: Failed to initialize backend module:", err);
  app = makeFallbackApp(err);
}

// Safely attach or override /api/public/hostinfo
if (app && typeof app === "function") {
  app.get("/api/public/hostinfo", (req, res) => {
    res.json({
      mode: "serverless",
      platform: process.platform,
      node: process.version,
      region: process.env.VERCEL_REGION || null,
      ips: getLANIPs(),
    });
  });
}

module.exports = app;
module.exports.default = app;
module.exports.handler = app;
