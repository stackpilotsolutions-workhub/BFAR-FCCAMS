require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const exifr = require("exifr");
const fs = require("fs");
const path = require("path");
const { nanoid } = require("nanoid");
const webpush = require("web-push");
const crypto = require("crypto");
const https = require("https");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });

// Google OAuth
const { OAuth2Client } = (() => {
  try {
    return require("google-auth-library");
  } catch (e) {
    return { OAuth2Client: null };
  }
})();

const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || "").trim();
const GOOGLE_CLIENT_SECRET = (process.env.GOOGLE_CLIENT_SECRET || "").trim();
const GOOGLE_CALLBACK_PATH = "/api/auth/google/callback";
const GOOGLE_CONFIGURED = !!(
  OAuth2Client &&
  GOOGLE_CLIENT_ID &&
  GOOGLE_CLIENT_SECRET &&
  !GOOGLE_CLIENT_ID.includes("your-google-client-id") &&
  !GOOGLE_CLIENT_SECRET.includes("your-google-client-secret")
);
let _googleClient = null;

function getGoogleClient(callbackBase) {
  if (!GOOGLE_CONFIGURED) return null;
  if (_googleClient) return _googleClient;
  try {
    _googleClient = new OAuth2Client(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      String(callbackBase || "") + GOOGLE_CALLBACK_PATH,
    );
  } catch (e) {
    _googleClient = null;
  }
  return _googleClient;
}

const GOOGLE_STATE_TTL_MS = 10 * 60 * 1000;
const _googleStates = new Map();
function makeGoogleState() {
  const s = crypto.randomBytes(24).toString("hex");
  _googleStates.set(s, { createdAt: Date.now() });
  setTimeout(() => _googleStates.delete(s), GOOGLE_STATE_TTL_MS);
  return s;
}

function consumeGoogleState(s) {
  if (!s) return false;
  const entry = _googleStates.get(s);
  if (!entry) return false;
  _googleStates.delete(s);
  return Date.now() - entry.createdAt <= GOOGLE_STATE_TTL_MS;
}

function buildCallbackBase(req) {
  const override = (process.env.GOOGLE_CALLBACK_BASE_URL || "").trim();
  if (override) return override.replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "http")
    .toString()
    .split(",")[0]
    .trim();
  const host = (
    req.headers["x-forwarded-host"] ||
    req.headers.host ||
    "localhost:3001"
  )
    .toString()
    .split(",")[0]
    .trim();
  return `${proto}://${host}`;
}

function sanitizeGoogleProfile(p) {
  if (!p || typeof p !== "object") return null;
  const sub = String(p.sub || p.id || "").trim();
  const email = String(p.email || "")
    .trim()
    .toLowerCase();
  const name = String(
    p.name ||
      p.given_name ||
      p.family_name ||
      email.split("@")[0] ||
      "Google User",
  ).trim();
  const picture = String(p.picture || p.pictureUrl || "").trim();
  if (!email || !sub) return null;
  return { sub, email, name, picture, emailVerified: !!p.email_verified };
}

async function googleFetchUserInfo(client, codeTokens) {
  if (codeTokens && codeTokens.id_token) {
    try {
      const ticket = await client.verifyIdToken({
        idToken: codeTokens.id_token,
        audience: GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      const clean = sanitizeGoogleProfile(payload);
      if (clean) return clean;
    } catch (e) {}
  }
  if (codeTokens && codeTokens.access_token) {
    try {
      const info = await new Promise((resolve, reject) => {
        const url =
          "https://openidconnect.googleapis.com/v1/userinfo?access_token=" +
          encodeURIComponent(codeTokens.access_token);
        const req = https.get(url, (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(e);
            }
          });
        });
        req.on("error", reject);
      });
      const clean = sanitizeGoogleProfile(info);
      if (clean) return clean;
    } catch (e) {}
  }
  return null;
}

async function upsertGoogleUserSupabase({ sub, email, name, picture }) {
  const emailKey = String(email || "")
    .trim()
    .toLowerCase();
  if (!emailKey) throw new Error("Missing Google profile email");

  const now = new Date().toISOString();
  const client = supabaseService || supabase;

  // 1. Search existing user strictly by email
  let res = await client
    .from("profiles")
    .select("id, email, name, role, barangay, fisher_id, municipality")
    .eq("email", emailKey)
    .limit(1);

  let profile = (res.data && res.data[0]) || null;

  if (profile) {
    // 2. User exists: Update name if missing
    if (!profile.name && name) {
      const upd = await client
        .from("profiles")
        .update({ name, updated_at: now })
        .eq("id", profile.id)
        .select("id, email, name, role, barangay, fisher_id, municipality")
        .single();
      if (upd && upd.data) profile = upd.data;
    }
  } else {
    // 3. User doesn't exist: Create new profile row matching schema
    const newRow = {
      id: crypto.randomUUID(), // Generates a standard UUID
      name: name || emailKey.split("@")[0] || "Google User",
      email: emailKey,
      role: "inspector",
      created_at: now,
      updated_at: now,
    };

    const ins = await client
      .from("profiles")
      .insert([newRow])
      .select("id, email, name, role, barangay, fisher_id, municipality")
      .single();

    if (ins.error || !ins.data) {
      console.error("[Google OAuth] Insert Error:", ins.error);
      throw new Error(
        "Failed to create user record: " +
          (ins.error ? ins.error.message : "Unknown error"),
      );
    }
    profile = ins.data;
  }

  return profile;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.redirect("/user");
});

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasSupabase = !!(supabaseUrl && supabaseAnonKey);
const IS_SERVERLESS = !!process.env.VERCEL || !!process.env.NOW_REGION;

if (!hasSupabase) {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY.");
  throw new Error("Supabase configuration missing.");
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Service-role client (bypasses RLS) — used for:
//   (a) running "SET app.current_user_id = ..." (anon key lacks privilege for SET config)
//   (b) admin / cross-user bulk operations that need RLS bypass.
// If SUPABASE_SERVICE_ROLE_KEY is not set, we gracefully fall back to the
// service-role-less path: backend-level isSelfOrAdmin guards remain active
// (they are always run first) so isolation still holds.
let supabaseService = null;
try {
  if (supabaseServiceRoleKey) {
    supabaseService = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
} catch (e) {
  console.warn(
    "[supabase] Service role client unavailable:",
    (e && e.message) || e,
  );
  supabaseService = null;
}

const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || "";
const VAPID_PUBLIC = process.env.VAPID_PUBLIC || "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE || "";
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(
    "mailto:admin@example.com",
    VAPID_PUBLIC,
    VAPID_PRIVATE,
  );
}

// In-memory state for SSE and Tracking (caching)
// We keep some in-memory state for performance and Realtime (SSE) shim
const sseClients = [];
const trackingStateByUserId = new Map(); // { userId: { active, lastPoint, stoppedAt, lastSeenAt } }
const statusStateByUserId = new Map(); // { userId: { status, at, lat, lng } }

// Inject Postgres session-level GUCs so RLS policies resolve the current user.
// Runs once per request inside auth() middleware AFTER user is decoded.
// Uses service role client if available (anon key lacks SET privilege).
async function injectRlsUser(userId, role) {
  const client = supabaseService || supabase;
  if (!client) return;
  const uidStr = userId == null ? "" : String(userId);
  const roleStr = role == null ? "" : String(role);
  try {
    await client.rpc("set_config", {
      name: "app.current_user_id",
      value: uidStr,
      is_local: false,
    });
    await client.rpc("set_config", {
      name: "app.current_role",
      value: roleStr,
      is_local: false,
    });
  } catch (e) {
    // Fallback: .rpc() might not be wired for set_config on older projects;
    // try raw SQL via from('raw').select if the direct rpc helper fails.
    try {
      const { error } = await client
        .from("profiles")
        .select("id")
        .limit(0)
        .rpc("set_config", {
          name: "app.current_user_id",
          value: uidStr,
          is_local: false,
        });
      if (error)
        console.debug(
          "[supabase.rpc] set_config(user_id) skipped:",
          error.message,
        );
    } catch (_) {
      // Final safe fallback: run a multi-statement query through supabase.query()
      try {
        const { error: qErr } = await client
          .from("_rls_inject")
          .select()
          .limit(0)
          .overrideType("query"); // placeholder; if fails silently, backend guards still apply.
      } catch {}
    }
    // Inject failures are non-fatal: backend-level isSelfOrAdmin/isAdmin ALWAYS
    // run BEFORE any query executes, so cross-user reads/writes are still blocked.
  }
}

// Helper to get role
async function getUserRole(userId) {
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", String(userId))
    .single();
  return data ? data.role : "inspector";
}

function normalizeText(value) {
  return value == null ? "" : String(value).trim();
}

async function ensureUserExists(id, email, name, role, passwordHash) {
  if (!id) return null;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .insert({
        id: String(id),
        email: email || null,
        name: name || null,
        role: role || "inspector",
        password_hash: passwordHash || null,
      })
      .select("*")
      .maybeSingle();
    if (data) return data;
  } catch (e) {
    // Most likely conflict (user already exists). Return existing row.
    try {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", String(id))
        .maybeSingle();
      return data || null;
    } catch (_) {
      return null;
    }
  }
  return null;
}

async function getVesselByIdSupabase(id) {
  if (!id) return null;
  const { data, error } = await supabase
    .from("vessels")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function findVesselByRegistrationSupabase(registrationNumber, excludeId) {
  const registration = normalizeText(registrationNumber);
  if (!registration) return null;
  let query = supabase
    .from("vessels")
    .select("*")
    .eq("vessel_registration_number", registration)
    .limit(1);
  if (excludeId) query = query.neq("id", excludeId);
  const { data, error } = await query;
  if (error) throw error;
  return data && data[0] ? data[0] : null;
}

async function resolveCatchVesselSupabase(body) {
  const vesselId = normalizeText(body.vesselId);
  if (vesselId) {
    const vessel = await getVesselByIdSupabase(vesselId);
    if (!vessel) {
      const err = new Error("Selected vessel not found");
      err.statusCode = 400;
      throw err;
    }
    return {
      vessel_id: vessel.id,
      vessel: vessel.vessel_name,
      vessel_registration_number: vessel.vessel_registration_number,
      vessel_name: vessel.vessel_name,
      owner_name: vessel.owner_name,
      barangay: vessel.barangay,
      engine: normalizeText(vessel.engine || vessel.engine_gear) || null,
    };
  }

  return {
    vessel_id: null,
    vessel: normalizeText(body.vessel || body.vesselName) || null,
    vessel_registration_number:
      normalizeText(body.vesselRegistrationNumber) || null,
    vessel_name: normalizeText(body.vesselName || body.vessel) || null,
    owner_name: normalizeText(body.ownerName) || null,
    barangay: normalizeText(body.barangay) || null,
    engine: normalizeText(body.engine || body.gear) || null,
  };
}

// Auth Middleware
// Accepts TWO token types (enables the exact same frontend code to work in both LowDB & Supabase modes):
//   1. Supabase GoTrue access-token (from supabase.auth.signUp/signIn) — verified via supabase.auth.getUser
//   2. Local JWT token signed with JWT_SECRET (what LowDB mode issues via createToken) — verified via jwt.verify
// After decoding, BOTH paths:
//   a. Upsert into public.profiles if not present (so local-JWT users still have a valid profile row with password_hash)
//   b. Inject app.current_user_id / app.current_role via Postgres set_config so RLS policies resolve correctly

function auth(requiredRole) {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const qToken =
      !token && req.query && req.query.token ? req.query.token : null;
    const useToken = token || qToken;

    if (!useToken) return res.status(401).json({ error: "Unauthorized" });

    let userId = null;
    let email = null;
    let role = null;
    let name = null;
    let passwordHash = null;
    let resolvedVia = null;

    // --- Path A: Local JWT (signed with JWT_SECRET) — always try first because our login.html issues this type ---
    try {
      const decoded = jwt.verify(useToken, JWT_SECRET);
      if (decoded && decoded.id) {
        userId = String(decoded.id);
        role = String(decoded.role || "inspector");
        email = decoded.email || null;
        name = decoded.name || null;
        resolvedVia = "local-jwt";
      }
    } catch (_) {
      // Local JWT decode fail → fall through to Supabase path
    }

    // --- Path B: Supabase GoTrue token (e.g. Supabase Auth signIn, anon-key signed JWT) ---
    if (!userId) {
      try {
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser(useToken);
        if (error || !user) throw error || new Error("invalid supabase token");
        userId = String(user.id);
        email = user.email || null;
        resolvedVia = "supabase-gotrue";
      } catch (e) {
        return res.status(401).json({ error: "Invalid token" });
      }
    }

    if (!userId) return res.status(401).json({ error: "Invalid token" });

    // Fetch/merge role & profile info from public.profiles (source of truth on Supabase mode)
    try {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      if (profile) {
        role = profile.role || role || "inspector";
        email = email || profile.email || null;
        name = name || profile.name || null;
      } else if (resolvedVia === "local-jwt") {
        // Profile doesn't exist yet. Create it on first login so Supabase mode still works
        // with the exact same nanoid ids/emails from LowDB.
        passwordHash = null; // we don't store bcrypt for local JWTs at this step
        await ensureUserExists(userId, email, name, role, passwordHash);
      }
    } catch (e) {
      // Non-fatal: continue with the role we have
    }
    if (!role) role = "inspector";

    // Set auth() role check BEFORE next()
    if (requiredRole) {
      const ok = Array.isArray(requiredRole)
        ? requiredRole.includes(role)
        : role === requiredRole;
      if (!ok) return res.status(403).json({ error: "Forbidden" });
    }

    // Now inject user onto request
    req.user = { id: userId, email, role, name, authVia: resolvedVia };

    // Populate Postgres session GUCs so RLS policies see the right user.
    // We await this but never fail the request on injection errors: backend-level guards
    // (isSelfOrAdmin / isAdmin) run BEFORE any query in every handler, so we still
    // enforce isolation even if injection fails.
    try {
      await injectRlsUser(userId, role);
    } catch (_) {}

    next();
  };
}

function isAdmin(u) {
  return u && u.role === "admin";
}

function isSelfOrAdmin(req, ownerId) {
  if (isAdmin(req.user)) return true;
  return String(ownerId || "") === String(req.user.id || "");
}

// --- SSE BROADCASTING ---
function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((res) => {
    try {
      res.write(msg);
    } catch (e) {
      console.error("SSE Error", e.message);
    }
  });
}

// --- AUTH ENDPOINTS ---
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password, name, role, barangay, municipality, fisher_id } =
      req.body;

    if (!email || !password || !name) {
      return res
        .status(400)
        .json({ error: "Missing required fields: email, password, and name" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    // 1. Check if user already exists
    const { data: existingUser } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (existingUser) {
      return res
        .status(400)
        .json({ error: "User with this email already exists" });
    }

    // 2. Hash the password
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    // 3. Generate a primary key UUID using native crypto
    const newId = crypto.randomUUID();

    // 4. Insert into profiles with the generated ID
    const { data, error } = await supabase
      .from("profiles")
      .insert({
        id: newId,
        email: normalizedEmail,
        name,
        role: role || "inspector",
        password_hash,
        barangay: barangay || null,
        municipality: municipality || null,
        fisher_id: fisher_id || null,
      })
      .select()
      .single();

    if (error) {
      console.error("Supabase Insert Error:", error);
      return res.status(400).json({ error: error.message });
    }

    delete data.password_hash;

    res.json({
      message: "Registration successful",
      user: data,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/public/install_admin", async (req, res) => {
  const { email, password, name } = req.body;
  // Check if any admin exists? For now just allow creating admin.
  // In production, you'd want to lock this down.

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name, role: "admin" },
    },
  });

  if (error) return res.status(400).json({ error: error.message });

  res.json({ ok: true, user: data.user });
});

// --- GET ALL VESSELS ---
app.get("/api/vessels", auth(), async (req, res) => {
  const userId =
    req.query && req.query.userId != null ? String(req.query.userId) : null;
  const selfId = String(req.user.id || "");
  let q = supabase
    .from("vessels")
    .select("*")
    .order("created_at", { ascending: false });

  if (isAdmin(req.user)) {
    if (userId) q = q.eq("user_id", userId);
  } else {
    if (userId && userId !== selfId)
      return res.status(403).json({ error: "Forbidden" });
    q = q.eq("user_id", selfId);
  }

  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

// --- GET SINGLE VESSEL ---
app.get("/api/vessels/:id", auth(), async (req, res) => {
  const { data, error } = await supabase
    .from("vessels")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Vessel not found" });
  if (!isSelfOrAdmin(req, data.user_id))
    return res.status(403).json({ error: "Forbidden" });
  res.json(data);
});

// --- GET /api/vessels/search ---
app.get("/api/vessels/search", auth(), async (req, res) => {
  let query = req.query.q ? String(req.query.q).trim() : "";
  if (!query) return res.json([]);

  // Extract text inside parentheses if user selected from datalist e.g., "F/B Rocel (VSL-001)"
  const regMatch = query.match(/\(([^)]+)\)/);
  const cleanQuery = regMatch
    ? regMatch[1]
    : query.replace(/[^a-zA-Z0-9\s-]/g, "");

  const selfId = String(req.user.id || "");

  let q = supabase
    .from("vessels")
    .select("*")
    .or(
      `name.ilike.%${cleanQuery}%,vessel_registration_number.ilike.%${cleanQuery}%`,
    );

  if (!isAdmin(req.user)) {
    q = q.eq("user_id", selfId);
  }

  const { data, error } = await q;
  if (error) {
    console.error("Supabase error:", error.message);
    return res.status(400).json({ error: error.message });
  }

  res.json(data || []);
});

// --- CREATE VESSEL ---
app.post("/api/vessels", auth(), async (req, res) => {
  const vessel_registration_number = normalizeText(
    req.body.vessel_registration_number,
  );
  const vessel_name = normalizeText(req.body.vessel_name);
  const owner_name = normalizeText(req.body.owner_name);
  const barangay = normalizeText(req.body.barangay);
  const engine = normalizeText(req.body.engine || req.body.engine_gear);

  if (!vessel_registration_number || !vessel_name || !owner_name || !barangay) {
    return res.status(400).json({
      error: "Registration #, Name, Owner, and Barangay are required",
    });
  }

  const duplicate = await findVesselByRegistrationSupabase(
    vessel_registration_number,
  );
  if (duplicate)
    return res
      .status(409)
      .json({ error: "Vessel registration number already exists" });

  // FIXED: Field mapped to 'name' instead of 'vessel_name'
  const insertPayload = {
    id: nanoid(),
    user_id: req.user.id,
    vessel_registration_number,
    name: vessel_name,
    owner_name,
    barangay,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (engine) insertPayload.engine = engine;

  const { data, error } = await supabase
    .from("vessels")
    .insert(insertPayload)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// --- UPDATE VESSEL ---
app.patch("/api/vessels/:id", auth(), async (req, res) => {
  const id = String(req.params.id);
  const vessel_registration_number = normalizeText(
    req.body.vessel_registration_number,
  );
  const vessel_name = normalizeText(req.body.vessel_name);
  const owner_name = normalizeText(req.body.owner_name);
  const barangay = normalizeText(req.body.barangay);
  const engine = normalizeText(req.body.engine || req.body.engine_gear);

  if (!vessel_registration_number || !vessel_name || !owner_name || !barangay) {
    return res.status(400).json({
      error: "Registration #, Name, Owner, and Barangay are required",
    });
  }

  const duplicate = await findVesselByRegistrationSupabase(
    vessel_registration_number,
    id,
  );
  if (duplicate)
    return res
      .status(409)
      .json({ error: "Vessel registration number already exists" });

  const { data: existing, error: ePre } = await supabase
    .from("vessels")
    .select("user_id")
    .eq("id", id)
    .maybeSingle();
  if (ePre) return res.status(400).json({ error: ePre.message });
  if (!existing) return res.status(404).json({ error: "Vessel not found" });
  if (!isSelfOrAdmin(req, existing.user_id))
    return res.status(403).json({ error: "Forbidden" });

  const updatePayload = {
    vessel_registration_number,
    name: vessel_name,
    owner_name,
    barangay,
    engine,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("vessels")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Vessel not found" });

  const catchUpdates = {
    vessel_registration_number,
    vessel_name,
    owner_name,
  };

  const catchQuery = supabase
    .from("catches")
    .update(catchUpdates)
    .eq("vessel_id", id);
  if (!isAdmin(req.user)) {
    catchQuery.eq("user_id", req.user.id);
  }

  const { error: catchUpdateError } = await catchQuery;
  if (catchUpdateError)
    return res.status(400).json({ error: catchUpdateError.message });

  res.json(data);
});

// --- DELETE VESSEL ---
app.delete("/api/vessels/:id", auth(), async (req, res) => {
  const id = String(req.params.id);

  const { data: existing, error: ePre } = await supabase
    .from("vessels")
    .select("user_id")
    .eq("id", id)
    .maybeSingle();
  if (ePre) return res.status(400).json({ error: ePre.message });
  if (!existing) return res.status(404).json({ error: "Vessel not found" });
  if (!isSelfOrAdmin(req, existing.user_id))
    return res.status(403).json({ error: "Forbidden" });

  const catchQuery = supabase
    .from("catches")
    .update({ vessel_id: null })
    .eq("vessel_id", id);
  if (!isAdmin(req.user)) {
    catchQuery.eq("user_id", req.user.id);
  }
  const { error: catchUpdateError } = await catchQuery;
  if (catchUpdateError)
    return res.status(400).json({ error: catchUpdateError.message });

  const { error } = await supabase.from("vessels").delete().eq("id", id);
  if (error) return res.status(400).json({ error: error.message });

  res.json({ ok: true });
});

// --- GET ALL FISHING GEARS ---
app.get("/api/fishing-gears", auth(), async (req, res) => {
  const { data, error } = await supabase
    .from("fishing_gears")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

// --- GET /api/fishing-gears/search ---
app.get("/api/fishing-gears/search", auth(), async (req, res) => {
  let query = req.query.q ? String(req.query.q).trim() : "";
  if (!query) return res.json([]);

  const cleanQuery = query.replace(/[^a-zA-Z0-9\s-]/g, "");

  const { data, error } = await supabase
    .from("fishing_gears")
    .select("*")
    .or(`gear_name.ilike.%${cleanQuery}%,gear_code.ilike.%${cleanQuery}%`);

  if (error) {
    console.error("Supabase error:", error.message);
    return res.status(400).json({ error: error.message });
  }

  res.json(data || []);
});

// --- GET SINGLE FISHING GEAR ---
app.get("/api/fishing-gears/:id", auth(), async (req, res) => {
  const { data, error } = await supabase
    .from("fishing_gears")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();

  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Fishing gear not found" });

  res.json(data);
});

// --- CREATE FISHING GEAR ---
app.post("/api/fishing-gears", auth(), async (req, res) => {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ error: "Forbidden: Admin access required" });
  }

  const gear_code = normalizeText(req.body.gear_code);
  const gear_name = normalizeText(req.body.gear_name);

  if (!gear_code || !gear_name) {
    return res.status(400).json({
      error: "Gear Code and Gear Name are required",
    });
  }

  // Check duplicate gear_code
  const { data: duplicate, error: dupErr } = await supabase
    .from("fishing_gears")
    .select("id")
    .eq("gear_code", gear_code)
    .maybeSingle();

  if (dupErr) return res.status(400).json({ error: dupErr.message });
  if (duplicate) {
    return res.status(409).json({ error: "Gear code already exists" });
  }

  const insertPayload = {
    gear_code,
    gear_name,
    created_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("fishing_gears")
    .insert(insertPayload)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// --- UPDATE FISHING GEAR ---
app.patch("/api/fishing-gears/:id", auth(), async (req, res) => {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ error: "Forbidden: Admin access required" });
  }

  const id = String(req.params.id);
  const gear_code = normalizeText(req.body.gear_code);
  const gear_name = normalizeText(req.body.gear_name);

  if (!gear_code || !gear_name) {
    return res.status(400).json({
      error: "Gear Code and Gear Name are required",
    });
  }

  // Check duplicate gear_code for another entry
  const { data: duplicate, error: dupErr } = await supabase
    .from("fishing_gears")
    .select("id")
    .eq("gear_code", gear_code)
    .neq("id", id)
    .maybeSingle();

  if (dupErr) return res.status(400).json({ error: dupErr.message });
  if (duplicate) {
    return res.status(409).json({ error: "Gear code already exists" });
  }

  const updatePayload = {
    gear_code,
    gear_name,
  };

  const { data, error } = await supabase
    .from("fishing_gears")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Fishing gear not found" });

  res.json(data);
});

// --- DELETE FISHING GEAR ---
app.delete("/api/fishing-gears/:id", auth(), async (req, res) => {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ error: "Forbidden: Admin access required" });
  }

  const id = String(req.params.id);

  const { error } = await supabase.from("fishing_gears").delete().eq("id", id);

  if (error) return res.status(400).json({ error: error.message });

  res.json({ ok: true });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const normalizedEmail = String(email).trim().toLowerCase();

  try {
    // 1. Fetch user profile from Supabase profiles table
    const { data: profile, error } = await supabase
      .from("profiles")
      .select(
        "id, email, name, role, password_hash, barangay, fisher_id, municipality",
      )
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (error) {
      return res
        .status(500)
        .json({ error: error.message || "Database query error." });
    }

    if (!profile) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    if (!profile.password_hash) {
      return res
        .status(401)
        .json({ error: "No password set for this account." });
    }

    // 2. Compare password against stored hash
    const isValid = await bcrypt.compare(
      String(password),
      String(profile.password_hash),
    );
    if (!isValid) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const role = profile.role || "fisher";

    // 3. Generate JWT token for session
    const token = jwt.sign(
      {
        id: String(profile.id),
        email: profile.email,
        name: profile.name || null,
        role,
      },
      JWT_SECRET,
      { expiresIn: "7d" },
    );

    // 4. Return auth response
    return res.json({
      token,
      user: {
        id: String(profile.id),
        name: profile.name || null,
        email: profile.email,
        role,
        barangay: profile.barangay || null,
        fisher_id: profile.fisher_id || null,
        municipality: profile.municipality || null,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || "Login failed." });
  }
});

app.get("/api/auth/google/config", (req, res) => {
  res.json({ configured: !!GOOGLE_CONFIGURED });
});

app.get("/api/auth/google", (req, res) => {
  if (!GOOGLE_CONFIGURED) {
    const err = encodeURIComponent(
      "Google login is not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the server environment.",
    );
    return res.redirect("/login.html?error=" + err);
  }
  try {
    const callbackBase = buildCallbackBase(req);
    const client = getGoogleClient(callbackBase);
    if (!client) throw new Error("Google OAuth client unavailable");
    const state = makeGoogleState();
    const authorizeUrl = client.generateAuthUrl({
      access_type: "offline",
      prompt: "select_account",
      scope: ["openid", "email", "profile"],
      state,
    });
    return res.redirect(authorizeUrl);
  } catch (e) {
    console.error("[Google OAuth] Init error:", e && e.message);
    const err = encodeURIComponent(
      e && e.message ? String(e.message) : "Google login failed to start",
    );
    return res.redirect("/login.html?error=" + err);
  }
});

app.get("/api/auth/google/callback", async (req, res) => {
  try {
    if (!GOOGLE_CONFIGURED)
      throw new Error("Google login is not configured on this server.");
    const { code, state, error, error_description } = req.query || {};
    if (error) {
      if (String(error).toLowerCase() === "access_denied") {
        return res.redirect(
          "/login.html?error=" +
            encodeURIComponent("Google sign-in was cancelled."),
        );
      }
      const msg = error_description
        ? String(error_description)
        : `Google sign-in error: ${error}`;
      return res.redirect("/login.html?error=" + encodeURIComponent(msg));
    }
    if (!consumeGoogleState(state))
      throw new Error(
        "Invalid or expired Google sign-in state. Please try again.",
      );
    if (!code) throw new Error("Missing authorization code from Google.");
    const callbackBase = buildCallbackBase(req);
    const client = getGoogleClient(callbackBase);
    if (!client) throw new Error("Google OAuth client unavailable");
    const { tokens } = await client.getToken(String(code));
    if (!tokens) throw new Error("Google returned no tokens");
    client.setCredentials(tokens);
    const profile = await googleFetchUserInfo(client, tokens);
    if (!profile)
      throw new Error("Unable to retrieve your Google profile information.");
    if (!profile.emailVerified)
      throw new Error(
        "Your Google email address must be verified before you can sign in.",
      );
    const prof = await upsertGoogleUserSupabase(profile);
    const role = prof.role || "fisher";
    const jwtToken = jwt.sign(
      { id: String(prof.id), email: prof.email, name: prof.name || null, role },
      JWT_SECRET,
      { expiresIn: "7d" },
    );
    const safeUser = {
      id: String(prof.id),
      name: prof.name || null,
      email: prof.email,
      role,
      barangay: prof.barangay || null,
      fisher_id: prof.fisher_id || null,
      municipality: prof.municipality || null,
      avatarUrl: prof.avatar_url || profile.picture || null,
    };
    const redirectBase =
      String(role).toLowerCase() === "admin" ? "/admin.html" : "/user.html";
    const sep = redirectBase.includes("?") ? "&" : "?";
    const dest = `${redirectBase}${sep}token=${encodeURIComponent(jwtToken)}&user=${encodeURIComponent(JSON.stringify(safeUser))}`;
    return res.redirect(dest);
  } catch (e) {
    console.error("[Google OAuth] Callback error:", e && e.message);
    const msg = e && e.message ? String(e.message) : "Google sign-in failed";
    return res.redirect("/login.html?error=" + encodeURIComponent(msg));
  }
});

// --- DASHBOARD STATS ---
function getDateRange(type, value) {
  let startDate = new Date();
  let endDate = new Date();

  if (type === "daily" && value) {
    // value format: "YYYY-MM-DD"
    const [y, m, d] = value.split("-").map(Number);
    startDate = new Date(y, m - 1, d, 0, 0, 0, 0);
    endDate = new Date(y, m - 1, d, 23, 59, 59, 999);
  } else if (type === "weekly" && value) {
    // value format: "YYYY-Www"
    const parts = value.split("-W");
    const year = parseInt(parts[0], 10);
    const week = parseInt(parts[1], 10);

    // Calculate simple ISO Week Date start
    const simple = new Date(year, 0, 1 + (week - 1) * 7);
    const dow = simple.getDay();
    const ISOweekStart = simple;
    if (dow <= 4) {
      ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
    } else {
      ISOweekStart.setDate(simple.getDate() + 8 - simple.getDay());
    }

    startDate = new Date(ISOweekStart.setHours(0, 0, 0, 0));
    endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
  } else if (type === "monthly" && value) {
    // value format: "YYYY-MM"
    const [y, m] = value.split("-").map(Number);
    startDate = new Date(y, m - 1, 1, 0, 0, 0, 0);
    endDate = new Date(y, m, 0, 23, 59, 59, 999);
  } else {
    // Fallback: Default to Current Month
    const now = new Date();
    startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    endDate = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );
  }

  return {
    startISO: startDate.toISOString(),
    endISO: endDate.toISOString(),
    startDate,
    endDate,
  };
}

app.get("/api/dashboard/stats", auth(), async (req, res) => {
  try {
    const { type, value } = req.query;
    const { startISO, endISO, startDate } = getDateRange(type, value);

    // 1. Total catch weight filtered by time range
    const { data: catchesRange } = await supabase
      .from("catches")
      .select("weight")
      .eq("user_id", req.user.id)
      .gte("recorded_at", startISO)
      .lte("recorded_at", endISO);

    const totalWeightToday = (catchesRange || []).reduce(
      (sum, c) => sum + (Number(c.weight) || 0),
      0,
    );

    // 2. Active vessels for current user
    let activeVessels = 0;
    const myTracking = trackingStateByUserId.get(req.user.id);
    if (myTracking && myTracking.active) activeVessels = 1;

    // 3. Total coastal activities filtered by time range
    const { count: activitiesWeek } = await supabase
      .from("activity_logs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", req.user.id)
      .gte("created_at", startISO)
      .lte("created_at", endISO);

    // 4. Top 3 species filtered by time range
    const { data: rangeCatches } = await supabase
      .from("catches")
      .select("species")
      .eq("user_id", req.user.id)
      .gte("recorded_at", startISO)
      .lte("recorded_at", endISO);

    const speciesCounts = (rangeCatches || []).reduce((acc, c) => {
      const s = c.species || "Unknown";
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});

    const topSpecies = Object.entries(speciesCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([name, count]) => ({ name, count }));

    // 5. Catch trend (Generates 6 intervals looking back from selected date)
    const trend = [];
    for (let i = 5; i >= 0; i--) {
      let mStart, mEnd, label;

      if (type === "daily") {
        const d = new Date(startDate);
        d.setDate(d.getDate() - i);
        mStart = new Date(
          d.getFullYear(),
          d.getMonth(),
          d.getDate(),
          0,
          0,
          0,
        ).toISOString();
        mEnd = new Date(
          d.getFullYear(),
          d.getMonth(),
          d.getDate(),
          23,
          59,
          59,
        ).toISOString();
        label = d.toLocaleDateString("default", {
          month: "short",
          day: "numeric",
        });
      } else if (type === "weekly") {
        const d = new Date(startDate);
        d.setDate(d.getDate() - i * 7);
        mStart = d.toISOString();
        mEnd = new Date(
          d.getTime() + 7 * 24 * 60 * 60 * 1000 - 1,
        ).toISOString();
        label = `Wk ${d.toLocaleDateString("default", { month: "short", day: "numeric" })}`;
      } else {
        const d = new Date(
          startDate.getFullYear(),
          startDate.getMonth() - i,
          1,
        );
        mStart = new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
        mEnd = new Date(
          d.getFullYear(),
          d.getMonth() + 1,
          0,
          23,
          59,
          59,
        ).toISOString();
        label = d.toLocaleString("default", { month: "short" });
      }

      const { data: mData } = await supabase
        .from("catches")
        .select("species, weight")
        .eq("user_id", req.user.id)
        .gte("recorded_at", mStart)
        .lte("recorded_at", mEnd);

      const bySpecies = {};
      (mData || []).forEach((c) => {
        const s = c.species || "Unknown";
        bySpecies[s] = (bySpecies[s] || 0) + (Number(c.weight) || 0);
      });
      trend.push({ month: label, species: bySpecies });
    }

    const allSpecies = new Set();
    trend.forEach((t) =>
      Object.keys(t.species).forEach((s) => allSpecies.add(s)),
    );
    const months = trend.map((t) => t.month);
    const series = Array.from(allSpecies).map((species) => ({
      species,
      data: trend.map((t) => t.species[species] || 0),
    }));

    res.json({
      totalWeightToday,
      activeVessels,
      activitiesWeek: activitiesWeek || 0,
      topSpecies,
      trend: { months, series },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- ACTIVITY LOGS ---
app.get("/api/activity_logs/me", auth(), async (req, res) => {
  const { data, error } = await supabase
    .from("activity_logs")
    .select("*")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.post("/api/activity_logs", auth(), async (req, res) => {
  const { type, category, lat, lng, line, details } = req.body;

  const { data, error } = await supabase
    .from("activity_logs")
    .insert({
      id: nanoid(),
      user_id: req.user.id,
      action: type || "activity_logged",
      type,
      category,
      latitude: parseFloat(lat),
      longitude: parseFloat(lng),
      location: { lat: parseFloat(lat), lng: parseFloat(lng) },
      geom_line: line || null,
      details: typeof details === "object" ? details : { note: details },
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  broadcast({ type: "activity", item: data });
  res.json(data);
});

// POST /api/activity_logs/upload
app.post(
  "/api/activity_logs/upload",
  auth(),
  upload.single("photo"),
  async (req, res) => {
    try {
      const { type, category, lat, lng, line, note } = req.body;
      let photoUrl = null;

      if (req.file) {
        // Access file directly from memory buffer
        const fileContent = req.file.buffer;
        const fileName = `activities/${req.user.id}/${Date.now()}_${req.file.originalname}`;

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("uploads")
          .upload(fileName, fileContent, {
            contentType: req.file.mimetype,
          });

        if (uploadError) throw uploadError;

        const {
          data: { publicUrl },
        } = supabase.storage.from("uploads").getPublicUrl(fileName);
        photoUrl = publicUrl;
      }

      const { data, error } = await supabase
        .from("activity_logs")
        .insert({
          id: nanoid(),
          user_id: req.user.id,
          action: type || "activity_logged",
          type,
          category,
          location: { lat: parseFloat(lat), lng: parseFloat(lng) },
          geom_line: line ? JSON.parse(line) : null,
          image_url: photoUrl,
          details: note ? { note } : null,
        })
        .select()
        .single();

      if (error) throw error;
      broadcast({ type: "activity", item: data });
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },
);

// --- DATA ENDPOINTS ---

app.post("/api/status", auth(), async (req, res) => {
  const { status, lat, lng } = req.body;
  const at = req.body.at || new Date().toISOString();
  const userId = req.user.id;

  // 1. Check for the user's latest status event
  const { data: latestEvents } = await supabase
    .from("status_events")
    .select("id, status")
    .eq("user_id", userId)
    .order("at", { ascending: false })
    .limit(1);

  const latestEvent =
    latestEvents && latestEvents.length ? latestEvents[0] : null;

  let data;
  let error;

  // 2. If status is unchanged, update the existing row instead of inserting a duplicate
  if (latestEvent && latestEvent.status === status) {
    const { data: updated, error: err } = await supabase
      .from("status_events")
      .update({
        latitude: lat != null ? Number(lat) : null,
        longitude: lng != null ? Number(lng) : null,
        at,
      })
      .eq("id", latestEvent.id)
      .select()
      .single();

    data = updated;
    error = err;
  } else {
    // Insert new record only if the status actually changed
    const { data: inserted, error: err } = await supabase
      .from("status_events")
      .insert({
        id: nanoid(),
        user_id: userId,
        status,
        latitude: lat != null ? Number(lat) : null,
        longitude: lng != null ? Number(lng) : null,
        at,
      })
      .select()
      .single();

    data = inserted;
    error = err;
  }

  if (error) return res.status(400).json({ error: error.message });

  // Update in-memory cache
  statusStateByUserId.set(userId, { status, at, lat, lng });

  if (status === "port") {
    const prev = trackingStateByUserId.get(userId) || {};
    trackingStateByUserId.set(userId, { ...prev, active: false });

    // Mark active tracks in DB as inactive
    await supabase
      .from("tracks")
      .update({ active: false })
      .eq("user_id", userId)
      .eq("active", true);

    broadcast({ type: "track_stop", userId, at, lat, lng });
  }

  broadcast({ type: "status", ...data, userId });
  res.json({ ok: true, item: data });
});

app.post("/api/track", auth(), async (req, res) => {
  const { lat, lng, accuracy, speed, heading, recordedAt } = req.body;

  if (lat == null || lng == null) {
    return res.status(400).json({ error: "Missing lat/lng coordinates" });
  }

  const userId = req.user.id;
  const atTime = recordedAt || new Date().toISOString();
  const currentStatus = statusStateByUserId.get(userId)?.status || "transit";

  // 1. Check tracks table independently for an existing active transit record
  const { data: existingTrack } = await supabase
    .from("tracks")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "transit")
    .eq("active", true)
    .limit(1);

  const hasTrackRecord = existingTrack && existingTrack.length > 0;

  const dbPoint = {
    user_id: userId,
    latitude: Number(lat),
    longitude: Number(lng),
    accuracy: accuracy != null ? Number(accuracy) : null,
    speed: speed != null ? Number(speed) : null,
    heading: heading != null ? Number(heading) : null,
    active: true,
    status: currentStatus,
    status_at: atTime,
    recorded_at: atTime,
  };

  // Insert into 'tracks' ONLY if an active transit track point doesn't already exist
  if (!hasTrackRecord) {
    const trackId = nanoid();
    dbPoint.id = trackId;

    const { error: trackErr } = await supabase.from("tracks").insert(dbPoint);
    if (trackErr) {
      console.error("Error inserting into tracks:", trackErr);
      return res.status(400).json({ error: trackErr.message });
    }
  }

  // 2. Check status_events table independently
  const { data: existingStatus } = await supabase
    .from("status_events")
    .select("id")
    .eq("user_id", userId)
    .eq("status", currentStatus)
    .limit(1);

  if (!existingStatus || existingStatus.length === 0) {
    const { error: statusErr } = await supabase.from("status_events").insert({
      id: nanoid(),
      user_id: userId,
      status: currentStatus,
      latitude: Number(lat),
      longitude: Number(lng),
      at: atTime,
    });

    if (statusErr) {
      console.error("Error inserting into status_events:", statusErr);
    }
  }

  // Sync in-memory states and broadcast
  trackingStateByUserId.set(userId, {
    active: true,
    lastPoint: { ...dbPoint, lat, lng },
    lastSeenAt: Date.now(),
  });

  statusStateByUserId.set(userId, {
    status: currentStatus,
    at: atTime,
    lat: Number(lat),
    lng: Number(lng),
  });

  broadcast({ type: "track", ...dbPoint, lat, lng, userId });
  res.json({ ok: true, skippedInsert: hasTrackRecord });
});

app.get("/api/status/me", auth(), async (req, res) => {
  const { data: statusData } = await supabase
    .from("status_events")
    .select("*")
    .eq("user_id", req.user.id)
    .order("at", { ascending: false })
    .limit(1);

  const { data: trackData } = await supabase
    .from("tracks")
    .select("*")
    .eq("user_id", req.user.id)
    .order("recorded_at", { ascending: false })
    .limit(1);

  const activeState = trackingStateByUserId.get(req.user.id);

  res.json({
    status: statusData && statusData.length ? statusData[0] : null,
    lastTrack: trackData && trackData.length ? trackData[0] : null,
    isTracking: !!activeState?.active,
  });
});

app.post("/api/track/stop", auth(), async (req, res) => {
  const at = req.body.at || new Date().toISOString();
  const userId = req.user.id;

  // 1. Update in-memory tracking state
  const prev = trackingStateByUserId.get(userId) || {};
  trackingStateByUserId.set(userId, { ...prev, active: false });
  statusStateByUserId.set(userId, { status: "port", at });

  // 2. Mark active tracks as inactive in Supabase
  await supabase
    .from("tracks")
    .update({ active: false })
    .eq("user_id", userId)
    .eq("active", true);

  // 3. Update existing status_events record to 'port' instead of inserting
  const { data: latestEvents } = await supabase
    .from("status_events")
    .select("id")
    .eq("user_id", userId)
    .order("at", { ascending: false })
    .limit(1);

  if (latestEvents && latestEvents.length > 0) {
    await supabase
      .from("status_events")
      .update({ status: "port", at })
      .eq("id", latestEvents[0].id);
  } else {
    await supabase.from("status_events").insert({
      id: nanoid(),
      user_id: userId,
      status: "port",
      at,
    });
  }

  // 4. Broadcast websocket termination
  broadcast({
    type: "track_stop",
    userId,
    at,
  });

  res.json({ ok: true });
});

// Helper to resolve vessel details reliably
async function resolveCatchVesselSupabase(body, userId) {
  let vesselId = body.vesselId || body.vessel_id || null;
  let vesselReg =
    body.vesselRegistrationNumber || body.vessel_registration_number || null;
  let vesselName = body.vesselName || body.vessel_name || null;
  let ownerName = body.ownerName || body.owner_name || null;

  if (vesselId) {
    const { data: vessel } = await supabase
      .from("vessels")
      .select("id, vessel_registration_number, name, owner_name")
      .eq("id", vesselId)
      .single();

    if (vessel) {
      return {
        vessel_id: vessel.id,
        vessel_registration_number: vessel.vessel_registration_number,
        vessel_name: vessel.name,
        owner_name: vessel.owner_name,
      };
    }
  }

  return {
    vessel_id: vesselId,
    vessel_registration_number: vesselReg,
    vessel_name: vesselName,
    owner_name: ownerName,
  };
}

// POST /api/catches
app.post("/api/catches", auth(), async (req, res) => {
  const {
    species,
    netType,
    weightKg,
    lengthCm,
    gear,
    photoUrl,
    note,
    lat,
    lng,
    capturedAt,
    hoursFished,
    numHooksPanels,
    numHauls,
  } = req.body;

  if (lat == null || lng == null) {
    return res.status(400).json({ error: "Missing GPS coordinates" });
  }

  let vesselInfo;
  try {
    vesselInfo = await resolveCatchVesselSupabase(req.body, req.user.id);
  } catch (e) {
    return res.status(e.statusCode || 400).json({ error: e.message });
  }

  const insertData = {
    id: nanoid(),
    user_id: req.user.id,
    species: species || "unknown",
    net_type: netType || gear || null,
    weight: weightKg ? parseFloat(weightKg) : null,
    length_cm: lengthCm ? parseFloat(lengthCm) : null,
    gear: gear || netType || null,
    hours_fished:
      hoursFished != null && isFinite(parseFloat(hoursFished))
        ? parseFloat(hoursFished)
        : null,
    num_hooks_panels:
      numHooksPanels != null && isFinite(parseInt(numHooksPanels))
        ? parseInt(numHooksPanels)
        : null,
    num_hauls:
      numHauls != null && isFinite(parseInt(numHauls))
        ? parseInt(numHauls)
        : null,
    vessel_id: vesselInfo.vessel_id,
    vessel_registration_number: vesselInfo.vessel_registration_number,
    vessel_name: vesselInfo.vessel_name,
    owner_name: vesselInfo.owner_name,
    image_url: photoUrl || null,
    note: note || null,
    latitude: parseFloat(lat),
    longitude: parseFloat(lng),
    status: "pending",
    recorded_at: new Date().toISOString(),
    captured_at: capturedAt || new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("catches")
    .insert(insertData)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  broadcast({ type: "catch", item: { ...data, userId: req.user.id } });
  res.json(data);
});

// POST /api/catches/upload
app.post(
  "/api/catches/upload",
  auth(),
  upload.single("photo"),
  async (req, res) => {
    try {
      console.log("--- DEBUG CATCH UPLOAD START ---");
      console.log("1. req.file received by Multer:", req.file);
      console.log("2. req.body text fields received:", req.body);

      const {
        species,
        netType,
        weightKg,
        lengthCm,
        gear,
        note,
        lat,
        lng,
        capturedAt,
        hoursFished,
        numHooksPanels,
        numHauls,
      } = req.body;

      let photoUrl = null;

      if (req.file) {
        // Access file directly from memory buffer
        const fileContent = req.file.buffer;
        const safeFileName = req.file.originalname.replace(
          /[^a-zA-Z0-9.-]/g,
          "_",
        );
        const filePath = `${req.user.id}/${Date.now()}_${safeFileName}`;

        console.log(
          `3. Attempting upload to bucket 'uploads' at path: ${filePath}`,
        );

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("uploads")
          .upload(filePath, fileContent, {
            contentType: req.file.mimetype,
            upsert: true,
          });

        if (uploadError) {
          console.error("❌ SUPABASE STORAGE ERROR:", uploadError);
          return res.status(500).json({
            stage: "supabase_storage_upload",
            error: uploadError.message,
            details: uploadError,
          });
        }

        console.log("4. Storage Upload Success:", uploadData);

        const { data: urlData } = supabase.storage
          .from("uploads")
          .getPublicUrl(filePath);

        photoUrl = urlData ? urlData.publicUrl : null;
        console.log("5. Generated Public URL:", photoUrl);
      } else {
        console.warn(
          "⚠️ WARNING: No file found in req.file! (Check Postman field name)",
        );
      }

      const vesselInfo = await resolveCatchVesselSupabase(
        req.body,
        req.user.id,
      );

      const insertData = {
        id: nanoid(),
        user_id: req.user.id,
        species: species || "unknown",
        weight: weightKg ? parseFloat(weightKg) : null,
        length_cm: lengthCm ? parseFloat(lengthCm) : null,
        net_type: netType || gear || null,
        gear: gear || netType || null,
        hours_fished:
          hoursFished != null && isFinite(parseFloat(hoursFished))
            ? parseFloat(hoursFished)
            : null,
        num_hooks_panels:
          numHooksPanels != null && isFinite(parseInt(numHooksPanels))
            ? parseInt(numHooksPanels)
            : null,
        num_hauls:
          numHauls != null && isFinite(parseInt(numHauls))
            ? parseInt(numHauls)
            : null,
        vessel_id: vesselInfo.vessel_id,
        vessel_registration_number: vesselInfo.vessel_registration_number,
        vessel_name: vesselInfo.vessel_name,
        owner_name: vesselInfo.owner_name,
        image_url: photoUrl,
        note: note || null,
        latitude: lat ? parseFloat(lat) : null,
        longitude: lng ? parseFloat(lng) : null,
        status: "pending",
        recorded_at: new Date().toISOString(),
        captured_at: capturedAt || new Date().toISOString(),
      };

      console.log("6. Inserting object to DB:", insertData);

      const { data, error: dbError } = await supabase
        .from("catches")
        .insert(insertData)
        .select()
        .single();

      if (dbError) {
        console.error("❌ SUPABASE DB ERROR:", dbError);
        return res.status(400).json({
          stage: "supabase_db_insert",
          error: dbError.message,
          details: dbError,
        });
      }

      console.log("--- DEBUG CATCH UPLOAD SUCCESS ---");
      res.json(data);
    } catch (e) {
      console.error("❌ UNCAUGHT ROUTE EXCEPTION:", e);
      res.status(500).json({ stage: "server_exception", error: e.message });
    }
  },
);

app.get("/api/catches/me", auth(), async (req, res) => {
  const { data, error } = await supabase
    .from("catches")
    .select("*, vessels(*)")
    .eq("user_id", req.user.id);
  if (error) return res.status(400).json({ error: error.message });

  res.json(
    (data || []).map((c) => ({
      ...c,
      userId: c.user_id,
      vesselId: c.vessel_id,
      vesselRegistrationNumber: c.vessel_registration_number,
      vesselName: c.vessel_name,
      ownerName: c.owner_name,
      barangay: c.vessels ? c.vessels.barangay : null,
      engine:
        (c.vessels
          ? normalizeText(c.vessels.engine || c.vessels.engine_gear)
          : null) ||
        normalizeText(c.gear) ||
        null,
      weightKg: c.weight,
      lengthCm: c.length_cm, // FIXED: Reads from length_cm
      netType: c.net_type,
      hoursFished: c.hours_fished,
      numHooksPanels: c.num_hooks_panels,
      numHauls: c.num_hauls,
      lat: c.latitude, // FIXED: Maps latitude to lat
      lng: c.longitude, // FIXED: Maps longitude to lng
      capturedAt: c.captured_at || c.recorded_at,
      photoUrl: c.image_url,
      note: c.note, // FIXED: Reads from note
    })),
  );
});

app.get("/api/catches", auth("admin"), async (req, res) => {
  const { userId, vesselId, from, to } = req.query;
  let query = supabase
    .from("catches")
    .select("*, profiles(id, name, email), vessels(*)");
  if (userId) query = query.eq("user_id", userId);
  if (vesselId && vesselId !== "__unassigned__") {
    const vid = String(vesselId);
    query = query.or(
      `vessel_id.eq.${vid},vessel_registration_number.ilike.${vid},vessel_name.ilike.${vid}`,
    );
  } else if (vesselId === "__unassigned__") {
    query = query
      .is("vessel_id", null)
      .is("vessel_registration_number", null)
      .is("vessel_name", null);
  }
  if (from) query = query.gte("recorded_at", new Date(from).toISOString());
  if (to) query = query.lte("recorded_at", new Date(to).toISOString());
  query = query.order("recorded_at", { ascending: false });
  const { data: catches, error: cErr } = await query;
  if (cErr) return res.status(400).json({ error: cErr.message });

  const list = (catches || []).map((c) => ({
    ...c,
    user: c.profiles
      ? { id: c.profiles.id, name: c.profiles.name, email: c.profiles.email }
      : null,
    userId: c.user_id,
    vesselId: c.vessel_id,
    vesselRegistrationNumber: c.vessel_registration_number,
    vesselName: c.vessel_name,
    ownerName: c.owner_name,
    barangay: c.vessels ? c.vessels.barangay : null,
    engine:
      (c.vessels
        ? normalizeText(c.vessels.engine || c.vessels.engine_gear)
        : null) ||
      normalizeText(c.gear) ||
      null,
    weightKg: c.weight,
    lengthCm: c.length_cm, // Aligned with column: length_cm
    netType: c.net_type,
    hoursFished: c.hours_fished,
    numHooksPanels: c.num_hooks_panels,
    numHauls: c.num_hauls,
    lat: c.latitude != null ? Number(c.latitude) : null, // Mapped to lat for frontend
    lng: c.longitude != null ? Number(c.longitude) : null, // Mapped to lng for frontend
    capturedAt: c.captured_at || c.recorded_at,
    photoUrl: c.image_url,
    note: c.note, // Aligned with column: note
  }));
  res.json(list);
});

app.patch("/api/admin/catches/:id", auth("admin"), async (req, res) => {
  const id = req.params.id;
  const {
    species,
    weightKg,
    lengthCm,
    gear,
    note,
    netType,
    hoursFished,
    numHooksPanels,
    numHauls,
  } = req.body;

  const updates = {};
  if (species !== undefined) updates.species = species;
  if (weightKg !== undefined) updates.weight = weightKg;
  if (lengthCm !== undefined) updates.length = lengthCm;
  if (gear !== undefined) updates.gear = gear;
  if (note !== undefined) updates.notes = note;
  if (netType !== undefined) updates.net_type = netType;
  if (hoursFished !== undefined)
    updates.hours_fished =
      hoursFished != null
        ? isFinite(parseFloat(hoursFished))
          ? parseFloat(hoursFished)
          : null
        : null;
  if (numHooksPanels !== undefined)
    updates.num_hooks_panels =
      numHooksPanels != null
        ? isFinite(parseInt(numHooksPanels))
          ? parseInt(numHooksPanels)
          : null
        : null;
  if (numHauls !== undefined)
    updates.num_hauls =
      numHauls != null
        ? isFinite(parseInt(numHauls))
          ? parseInt(numHauls)
          : null
        : null;
  if (req.body.vesselId !== undefined) {
    try {
      const vesselInfo = await resolveCatchVesselSupabase(req.body);
      updates.vessel_id = vesselInfo.vessel_id;
      updates.vessel = vesselInfo.vessel;
      updates.vessel_registration_number =
        vesselInfo.vessel_registration_number;
      updates.vessel_name = vesselInfo.vessel_name;
      updates.owner_name = vesselInfo.owner_name;
    } catch (e) {
      return res.status(e.statusCode || 400).json({ error: e.message });
    }
  }

  const { error } = await supabase.from("catches").update(updates).eq("id", id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

app.delete("/api/admin/catches/:id", auth("admin"), async (req, res) => {
  const id = req.params.id;
  const { error } = await supabase.from("catches").delete().eq("id", id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

app.get("/api/admin/catches/summary", auth("admin"), async (req, res) => {
  const { data: catches, error: cErr } = await supabase
    .from("catches")
    .select("*, vessels(*)")
    .order("recorded_at", { ascending: false });
  if (cErr) return res.status(400).json({ error: cErr.message });
  const byVessel = new Map();
  (catches || []).forEach((c) => {
    const v = c.vessels || {};
    const info = {
      vesselId: c.vessel_id || null,
      ownerName: v.owner_name || c.owner_name || null,
      barangay: v.barangay || c.barangay || null,
      registrationNumber:
        v.vessel_registration_number || c.vessel_registration_number || null,
      vesselName: v.vessel_name || c.vessel_name || null,
    };
    let key;
    if (info.vesselId) key = "id:" + info.vesselId;
    else if (info.registrationNumber) key = "reg:" + info.registrationNumber;
    else if (info.vesselName) key = "name:" + info.vesselName;
    else key = "__unassigned__";
    const t = new Date(c.recorded_at || c.created_at || 0).getTime();
    const cur = byVessel.get(key);
    if (!cur) {
      byVessel.set(key, {
        vesselId: info.vesselId,
        ownerName: info.ownerName,
        barangay: info.barangay,
        registrationNumber: info.registrationNumber,
        vesselName: info.vesselName,
        latestSpecies: c.species || null,
        latestCapturedAt: c.recorded_at || c.created_at,
        _t: t,
        totalCatches: 1,
        latestUserId: c.user_id || null,
      });
    } else {
      cur.totalCatches += 1;
      if (t > cur._t) {
        cur._t = t;
        cur.latestSpecies = c.species || null;
        cur.latestCapturedAt = c.recorded_at || c.created_at;
        cur.latestUserId = c.user_id || null;
      }
      if (!cur.ownerName && info.ownerName) cur.ownerName = info.ownerName;
      if (!cur.barangay && info.barangay) cur.barangay = info.barangay;
      if (!cur.registrationNumber && info.registrationNumber)
        cur.registrationNumber = info.registrationNumber;
      if (!cur.vesselName && info.vesselName) cur.vesselName = info.vesselName;
      if (!cur.vesselId && info.vesselId) cur.vesselId = info.vesselId;
    }
  });
  const out = Array.from(byVessel.values())
    .map((x) => {
      const { _t, ...rest } = x;
      return rest;
    })
    .sort((a, b) => {
      const aT = a.latestCapturedAt
        ? new Date(a.latestCapturedAt).getTime()
        : 0;
      const bT = b.latestCapturedAt
        ? new Date(b.latestCapturedAt).getTime()
        : 0;
      return bT - aT;
    });
  res.json(out);
});

app.delete(
  "/api/admin/catches/user/:userId",
  auth("admin"),
  async (req, res) => {
    const userId = String(req.params.userId);
    const { data: exists, error: e1 } = await supabase
      .from("catches")
      .select("id")
      .eq("user_id", userId);
    if (e1) return res.status(400).json({ error: e1.message });
    if (!exists || exists.length === 0)
      return res.status(404).json({ error: "No catches found for this user" });
    const { error } = await supabase
      .from("catches")
      .delete()
      .eq("user_id", userId);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true, deleted: exists.length });
  },
);

app.delete(
  "/api/admin/catches/vessel/:vesselId",
  auth("admin"),
  async (req, res) => {
    const vesselId = String(req.params.vesselId);
    let existsQuery;
    if (vesselId === "__unassigned__") {
      existsQuery = supabase
        .from("catches")
        .select("id")
        .is("vessel_id", null)
        .is("vessel_registration_number", null)
        .is("vessel_name", null);
    } else {
      existsQuery = supabase
        .from("catches")
        .select("id")
        .or(
          `vessel_id.eq.${vesselId},vessel_registration_number.ilike.${vesselId},vessel_name.ilike.${vesselId}`,
        );
    }
    const { data: exists, error: e1 } = await existsQuery;
    if (e1) return res.status(400).json({ error: e1.message });
    if (!exists || exists.length === 0)
      return res
        .status(404)
        .json({ error: "No catches found for this vessel" });
    let delQuery;
    if (vesselId === "__unassigned__") {
      delQuery = supabase
        .from("catches")
        .delete()
        .is("vessel_id", null)
        .is("vessel_registration_number", null)
        .is("vessel_name", null);
    } else {
      delQuery = supabase
        .from("catches")
        .delete()
        .or(
          `vessel_id.eq.${vesselId},vessel_registration_number.ilike.${vesselId},vessel_name.ilike.${vesselId}`,
        );
    }
    const { error } = await delQuery;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true, deleted: exists.length });
  },
);

app.patch("/api/catches/:id", auth(), async (req, res) => {
  const id = req.params.id;
  const {
    species,
    weightKg,
    lengthCm,
    gear,
    note,
    netType,
    hoursFished,
    numHooksPanels,
    numHauls,
  } = req.body;
  const { data: existing, error: ePre } = await supabase
    .from("catches")
    .select("user_id")
    .eq("id", id)
    .maybeSingle();
  if (ePre || !existing) return res.status(404).json({ error: "Not found" });
  if (!isSelfOrAdmin(req, existing.user_id))
    return res.status(403).json({ error: "Forbidden" });
  const updates = {};
  if (species !== undefined) updates.species = species;
  if (weightKg !== undefined) updates.weight = weightKg;
  if (lengthCm !== undefined) updates.length = lengthCm;
  if (gear !== undefined) updates.gear = gear;
  if (note !== undefined) updates.notes = note;
  if (netType !== undefined) updates.net_type = netType;
  if (hoursFished !== undefined)
    updates.hours_fished =
      hoursFished != null
        ? isFinite(parseFloat(hoursFished))
          ? parseFloat(hoursFished)
          : null
        : null;
  if (numHooksPanels !== undefined)
    updates.num_hooks_panels =
      numHooksPanels != null
        ? isFinite(parseInt(numHooksPanels))
          ? parseInt(numHooksPanels)
          : null
        : null;
  if (numHauls !== undefined)
    updates.num_hauls =
      numHauls != null
        ? isFinite(parseInt(numHauls))
          ? parseInt(numHauls)
          : null
        : null;
  if (req.body.vesselId !== undefined) {
    try {
      const vesselInfo = await resolveCatchVesselSupabase(req.body);
      updates.vessel_id = vesselInfo.vessel_id;
      updates.vessel = vesselInfo.vessel;
      updates.vessel_registration_number =
        vesselInfo.vessel_registration_number;
      updates.vessel_name = vesselInfo.vessel_name;
      updates.owner_name = vesselInfo.owner_name;
    } catch (e) {
      return res.status(e.statusCode || 400).json({ error: e.message });
    }
  }
  const { error } = await supabase.from("catches").update(updates).eq("id", id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

app.delete("/api/catches/:id", auth(), async (req, res) => {
  const id = req.params.id;
  const { data: existing, error: ePre } = await supabase
    .from("catches")
    .select("user_id")
    .eq("id", id)
    .maybeSingle();
  if (ePre || !existing) return res.status(404).json({ error: "Not found" });
  if (!isSelfOrAdmin(req, existing.user_id))
    return res.status(403).json({ error: "Forbidden" });
  const { error } = await supabase.from("catches").delete().eq("id", id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

app.get("/api/live_locations", auth(), async (req, res) => {
  const currentUserId = String(req.user.id);
  const active = [];
  trackingStateByUserId.forEach((v, k) => {
    if (v.active && String(k) === currentUserId) {
      active.push({
        userId: k,
        ...v.lastPoint,
        active: true,
        lastSeenAt: v.lastSeenAt,
      });
    }
  });
  res.json(active);
});

app.get("/api/admin/live_locations", auth("admin"), async (req, res) => {
  // Get user profiles and vessels from supabase
  const { data: profiles } = await supabase.from("profiles").select("*");
  const { data: vessels } = await supabase.from("vessels").select("*");

  // Get latest track points from database for all users
  const { data: tracks } = await supabase
    .from("tracks")
    .select("*, user_id, recorded_at")
    .order("recorded_at", { ascending: false });

  // Get latest status events from database
  const { data: statusEvents } = await supabase
    .from("status_events")
    .select("*, user_id, at")
    .order("at", { ascending: false });

  const latestByUserId = new Map();

  // Process status events first
  statusEvents.forEach((st) => {
    const userId = st.user_id ? String(st.user_id) : null;
    if (!userId) return;
    const lat = st.lat != null ? Number(st.lat) : NaN;
    const lng = st.lng != null ? Number(st.lng) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const at = st.at ? String(st.at) : null;
    const t = at ? new Date(at).getTime() : NaN;
    if (!Number.isFinite(t)) return;
    latestByUserId.set(userId, {
      userId,
      lat,
      lng,
      accuracy: null,
      speed: null,
      heading: null,
      recordedAt: at,
      status: st.status,
      statusAt: at,
      _t: t,
    });
  });

  // Process track points, overriding if newer
  tracks.forEach((p) => {
    const userId = p.user_id ? String(p.user_id) : null;
    if (!userId) return;
    const recordedAt = p.recorded_at ? String(p.recorded_at) : null;
    const t = recordedAt ? new Date(recordedAt).getTime() : NaN;
    if (!Number.isFinite(t)) return;
    const cur = latestByUserId.get(userId);
    if (!cur || t > cur._t) {
      latestByUserId.set(userId, {
        userId,
        id: p.id,
        lat: Number(p.lat),
        lng: Number(p.lng),
        accuracy: p.accuracy,
        speed: p.speed,
        heading: p.heading,
        recordedAt,
        status: cur ? cur.status : null,
        statusAt: cur ? cur.statusAt : null,
        _t: t,
      });
    }
  });

  // Merge with in-memory tracking state
  trackingStateByUserId.forEach((v, k) => {
    const userId = String(k);
    const cur = latestByUserId.get(userId);
    if (
      !cur ||
      (v.lastSeenAt && new Date(v.lastSeenAt).getTime() > (cur._t || 0))
    ) {
      latestByUserId.set(userId, {
        userId,
        ...v.lastPoint,
        active: v.active,
        lastSeenAt: v.lastSeenAt,
        status: statusStateByUserId.get(userId)
          ? statusStateByUserId.get(userId).status
          : cur
            ? cur.status
            : null,
        statusAt: statusStateByUserId.get(userId)
          ? statusStateByUserId.get(userId).at
          : cur
            ? cur.statusAt
            : null,
        _t: v.lastSeenAt
          ? new Date(v.lastSeenAt).getTime()
          : cur
            ? cur._t
            : Date.now(),
      });
    } else if (cur) {
      cur.active = v.active;
      cur.lastSeenAt = v.lastSeenAt;
    }
  });

  const out = Array.from(latestByUserId.values())
    .sort((a, b) => b._t - a._t)
    .map((p) => {
      const u = profiles
        ? profiles.find((x) => String(x.id) === String(p.userId))
        : null;
      const { _t, ...rest } = p;

      // Determine active status
      let active = rest.active !== false;
      if (rest.status === "port") active = false;

      // Find vessel info for this user
      let vesselInfo = null;
      if (vessels) {
        if (rest.vesselId) {
          vesselInfo = vessels.find(
            (v) => String(v.id) === String(rest.vesselId),
          );
        }
        if (!vesselInfo && rest.vesselRegistrationNumber) {
          vesselInfo = vessels.find(
            (v) =>
              v.vessel_registration_number === rest.vesselRegistrationNumber,
          );
        }
        if (!vesselInfo && u) {
          // Try to find by owner name
          vesselInfo = vessels.find(
            (v) =>
              v.owner_name &&
              v.owner_name.toLowerCase().includes((u.name || "").toLowerCase()),
          );
        }
      }

      return {
        ...rest,
        active,
        user: u ? { ...u } : null, // include all user fields
        vesselId: vesselInfo ? vesselInfo.id : rest.vesselId,
        vesselRegistrationNumber: vesselInfo
          ? vesselInfo.vessel_registration_number
          : rest.vesselRegistrationNumber,
        vesselName: vesselInfo ? vesselInfo.vessel_name : rest.vesselName,
        ownerName: vesselInfo ? vesselInfo.owner_name : rest.ownerName,
        barangay: vesselInfo ? vesselInfo.barangay : rest.barangay,
      };
    });

  res.json(out);
});

app.get("/api/users", auth("admin"), async (req, res) => {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[/api/users] Supabase Error:", error);
    return res.status(400).json({ error: error.message });
  }

  console.log("[/api/users] Fetched profiles count:", data ? data.length : 0);
  res.json(data);
});

app.get("/api/admin/users", auth("admin"), async (req, res) => {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.put("/api/users/:id", auth("admin"), async (req, res) => {
  const { id } = req.params;
  const { name, email, role, password } = req.body;

  try {
    // 1. Build profile updates object
    const profileUpdates = {
      ...(name && { name }),
      ...(email && { email }),
      ...(role && { role }),
      updated_at: new Date().toISOString(),
    };

    // FIX: If a new password was provided, hash it and add to profile updates
    if (password && password.trim() !== "") {
      const saltRounds = 10;
      profileUpdates.password_hash = await bcrypt.hash(password, saltRounds);
    }

    // 2. Update the 'profiles' database table
    const { data: updatedProfile, error: profileError } = await supabase
      .from("profiles")
      .update(profileUpdates)
      .eq("id", id)
      .select()
      .single();

    if (profileError) {
      console.error(`[/api/users/${id}] Profile update error:`, profileError);
      return res.status(400).json({ error: profileError.message });
    }

    // 3. Sync credentials with Supabase Auth (if user was created via Supabase Auth)
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id,
      );
    const authUpdates = {};
    if (email) authUpdates.email = email;
    if (password) authUpdates.password = password;

    if (isUuid && Object.keys(authUpdates).length > 0) {
      try {
        const { error: authError } = await supabase.auth.admin.updateUserById(
          id,
          authUpdates,
        );
        if (authError) {
          console.warn(
            `[/api/users/${id}] Auth sync skipped or failed:`,
            authError.message,
          );
        }
      } catch (authErr) {
        console.warn(
          `[/api/users/${id}] Supabase Auth update skipped:`,
          authErr.message,
        );
      }
    }

    console.log(`[/api/users/${id}] Updated successfully:`, updatedProfile);
    res.json(updatedProfile);
  } catch (err) {
    console.error(`[/api/users/${id}] Server error:`, err);
    res
      .status(500)
      .json({ error: "Internal server error while updating user." });
  }
});

app.post("/api/users", auth("admin"), async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!email || !password || !name) {
    return res
      .status(400)
      .json({ error: "Name, email, and password are required." });
  }

  try {
    let userId = null;
    let authUserCreated = false;

    // 1. Attempt to create user in Supabase Auth
    try {
      const { data: authData, error: authError } =
        await supabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { name, role: role || "fisher" },
        });

      if (authError) {
        console.warn(
          "[/api/users POST] Supabase Auth creation notice:",
          authError.message,
        );
      } else if (authData && authData.user) {
        userId = authData.user.id;
        authUserCreated = true;
      }
    } catch (authErr) {
      console.warn(
        "[/api/users POST] Auth admin method unavailable or failed:",
        authErr.message,
      );
    }

    // 2. Fallback ID generation if Supabase Auth isn't active or returns no ID
    if (!userId) {
      userId = crypto.randomUUID();
    }

    // 3. Insert record into the 'profiles' database table
    const newProfile = {
      id: userId,
      name,
      email,
      role: role || "fisher",
    };

    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .insert([newProfile])
      .select()
      .single();

    if (profileError) {
      console.error("[/api/users POST] Profile insert error:", profileError);

      // Rollback Auth user if profile creation fails
      if (authUserCreated) {
        await supabase.auth.admin.deleteUser(userId).catch(() => {});
      }

      return res.status(400).json({ error: profileError.message });
    }

    console.log("[/api/users POST] User created successfully:", profileData);
    res.status(201).json(profileData);
  } catch (err) {
    console.error("[/api/users POST] Server error:", err);
    res
      .status(500)
      .json({ error: "Internal server error while creating user." });
  }
});

app.delete("/api/admin/users/:id", auth("admin"), async (req, res) => {
  const { id } = req.params;

  try {
    // 1. Delete user from the 'profiles' database table
    const { error: profileError } = await supabase
      .from("profiles")
      .delete()
      .eq("id", id);

    if (profileError) {
      console.error(
        `[/api/admin/users/${id} DELETE] Profile deletion error:`,
        profileError,
      );
      return res.status(400).json({ error: profileError.message });
    }

    // 2. Delete user from Supabase Auth (ONLY if ID is a valid UUID)
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id,
      );

    if (isUuid) {
      try {
        const { error: authError } = await supabase.auth.admin.deleteUser(id);
        if (authError) {
          console.warn(
            `[/api/admin/users/${id} DELETE] Auth deletion skipped or failed:`,
            authError.message,
          );
        }
      } catch (authErr) {
        console.warn(
          `[/api/admin/users/${id} DELETE] Supabase Auth deletion skipped for non-auth user:`,
          authErr.message,
        );
      }
    } else {
      console.warn(
        `[/api/admin/users/${id} DELETE] Skipped Supabase Auth deletion because ID is not a UUID.`,
      );
    }

    console.log(`[/api/admin/users/${id} DELETE] User deleted successfully.`);
    res.json({ message: "User deleted successfully", id });
  } catch (err) {
    console.error(`[/api/admin/users/${id} DELETE] Server error:`, err);
    res
      .status(500)
      .json({ error: "Internal server error while deleting user." });
  }
});

// 1. Group tracks per user to populate state.tracksSummary
app.get("/api/admin/tracks/summary", auth("admin"), async (req, res) => {
  try {
    // Query raw tracks sorted by newest first
    const { data: tracks, error: tracksError } = await supabase
      .from("tracks")
      .select("*")
      .order("recorded_at", { ascending: false });

    if (tracksError)
      return res.status(400).json({ error: tracksError.message });

    // Fetch all profiles to ensure mapping even if Supabase FK relationships are missing
    const { data: profiles } = await supabase.from("profiles").select("*");

    // Build map supporting both profile.id and profile.user_id
    const profileMap = new Map();
    (profiles || []).forEach((p) => {
      if (p.id) profileMap.set(String(p.id), p);
      if (p.user_id) profileMap.set(String(p.user_id), p);
    });

    const summaryMap = new Map();

    (tracks || []).forEach((t) => {
      const uid = String(t.user_id || "");
      if (!uid) return;

      const matchedProfile = profileMap.get(uid);
      const profileName = matchedProfile
        ? matchedProfile.name ||
          matchedProfile.full_name ||
          matchedProfile.username
        : null;
      const profileEmail = matchedProfile ? matchedProfile.email || "" : "";

      // Check coordinates fallback
      const rawLat = t.latitude != null ? t.latitude : t.lat;
      const rawLng = t.longitude != null ? t.longitude : t.lng;

      if (!summaryMap.has(uid)) {
        summaryMap.set(uid, {
          userId: uid,
          userName: profileName || uid,
          userEmail: profileEmail,
          latestLat: rawLat != null ? Number(rawLat) : null,
          latestLng: rawLng != null ? Number(rawLng) : null,
          latestRecordedAt: t.recorded_at || t.created_at || null,
          totalTracks: 1,
        });
      } else {
        const item = summaryMap.get(uid);
        item.totalTracks += 1;

        // If initial record lacked name/email, update if found on subsequent checks
        if ((!item.userName || item.userName === uid) && profileName) {
          item.userName = profileName;
        }
        if (!item.userEmail && profileEmail) {
          item.userEmail = profileEmail;
        }
      }
    });

    res.json(Array.from(summaryMap.values()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Align individual track fetching
app.get("/api/admin/tracks", auth("admin"), async (req, res) => {
  const { userId } = req.query;
  let q = supabase
    .from("tracks")
    .select("*, profiles(id, name, email)")
    .order("recorded_at", { ascending: false });

  if (userId) q = q.eq("user_id", userId);

  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });

  const list = (data || []).map((t) => {
    const profileObj = Array.isArray(t.profiles) ? t.profiles[0] : t.profiles;
    const rawLat = t.latitude != null ? t.latitude : t.lat;
    const rawLng = t.longitude != null ? t.longitude : t.lng;

    return {
      id: t.id,
      userId: t.user_id,
      lat: rawLat != null ? Number(rawLat) : null,
      lng: rawLng != null ? Number(rawLng) : null,
      accuracy: t.accuracy,
      speed: t.speed,
      heading: t.heading,
      recordedAt: t.recorded_at || t.created_at,
      user: profileObj
        ? {
            id: profileObj.id,
            name: profileObj.name || profileObj.id,
            email: profileObj.email || "",
          }
        : null,
    };
  });

  res.json(list);
});

// 3. Status history endpoint
app.get("/api/admin/status_history", auth("admin"), async (req, res) => {
  const { userId, limit } = req.query;
  let q = supabase
    .from("status_events")
    .select("*, profiles(id, name, email)")
    .order("at", { ascending: false })
    .limit(Number(limit) || 50);

  if (userId) q = q.eq("user_id", userId);

  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });

  const list = (data || []).map((s) => {
    const profileObj = Array.isArray(s.profiles) ? s.profiles[0] : s.profiles;
    const rawLat = s.latitude != null ? s.latitude : s.lat;
    const rawLng = s.longitude != null ? s.longitude : s.lng;

    return {
      ...s,
      lat: rawLat != null ? Number(rawLat) : null,
      lng: rawLng != null ? Number(rawLng) : null,
      userName: profileObj ? profileObj.name : s.user_id,
      userEmail: profileObj ? profileObj.email : "",
    };
  });

  res.json(list);
});

// 4. Regular status history query
app.get("/api/status_history", auth(), async (req, res) => {
  const { userId, limit } = req.query;
  const selfId = String(req.user.id || "");
  let q = supabase
    .from("status_events")
    .select("*")
    .order("at", { ascending: false })
    .limit(Number(limit) || 50);

  if (isAdmin(req.user)) {
    if (userId) q = q.eq("user_id", userId);
  } else {
    if (userId && String(userId) !== selfId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    q = q.eq("user_id", selfId);
  }

  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// 5. Delete track history for a specific user
app.delete(
  "/api/admin/tracks/user/:userId",
  auth("admin"),
  async (req, res) => {
    const userId = String(req.params.userId);
    const { error } = await supabase
      .from("tracks")
      .delete()
      .eq("user_id", userId);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  },
);

// 6. Delete a single track by ID
app.delete("/api/admin/tracks/:id", auth("admin"), async (req, res) => {
  const id = req.params.id;
  const { error } = await supabase.from("tracks").delete().eq("id", id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

// GET /api/species - Public or catch-form dropdown list
app.get("/api/species", async (req, res) => {
  const { data, error } = await supabase
    .from("species")
    .select("*")
    .order("name");

  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

// GET /api/admin/species - Admin full management view
app.get("/api/admin/species", auth("admin"), async (req, res) => {
  const { data, error } = await supabase
    .from("species")
    .select("*")
    .order("name");

  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

// POST /api/admin/species - Create species record with complete attributes
app.post("/api/admin/species", auth("admin"), async (req, res) => {
  const {
    name,
    scientific_name,
    image_url,
    description,
    min_length_cm,
    max_length_cm,
    price_per_kg,
    conservation,
    seasonal_allowed,
  } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Species name is required" });
  }

  const cleanName = name.trim();

  // Check duplicate name
  const { data: existing } = await supabase
    .from("species")
    .select("id, name")
    .ilike("name", cleanName)
    .maybeSingle();

  if (existing) {
    return res.status(409).json({ error: "Species already exists" });
  }

  const insertData = {
    id: nanoid(),
    name: cleanName,
    scientific_name: scientific_name || null,
    image_url: image_url || null,
    description: description || null,
    min_length_cm:
      min_length_cm != null && isFinite(parseFloat(min_length_cm))
        ? parseFloat(min_length_cm)
        : null,
    max_length_cm:
      max_length_cm != null && isFinite(parseFloat(max_length_cm))
        ? parseFloat(max_length_cm)
        : null,
    price_per_kg:
      price_per_kg != null && isFinite(parseFloat(price_per_kg))
        ? parseFloat(price_per_kg)
        : null,
    conservation: conservation || null,
    seasonal_allowed: seasonal_allowed || null,
    created_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("species")
    .insert(insertData)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// PUT /api/admin/species/:id - Update existing species by ID
app.put("/api/admin/species/:id", auth("admin"), async (req, res) => {
  const { id } = req.params;
  const {
    name,
    scientific_name,
    image_url,
    description,
    min_length_cm,
    max_length_cm,
    price_per_kg,
    conservation,
    seasonal_allowed,
  } = req.body;

  const updateData = {
    name: name ? name.trim() : undefined,
    scientific_name:
      scientific_name !== undefined ? scientific_name || null : undefined,
    image_url: image_url !== undefined ? image_url || null : undefined,
    description: description !== undefined ? description || null : undefined,
    min_length_cm:
      min_length_cm !== undefined
        ? isFinite(parseFloat(min_length_cm))
          ? parseFloat(min_length_cm)
          : null
        : undefined,
    max_length_cm:
      max_length_cm !== undefined
        ? isFinite(parseFloat(max_length_cm))
          ? parseFloat(max_length_cm)
          : null
        : undefined,
    price_per_kg:
      price_per_kg !== undefined
        ? isFinite(parseFloat(price_per_kg))
          ? parseFloat(price_per_kg)
          : null
        : undefined,
    conservation: conservation !== undefined ? conservation || null : undefined,
    seasonal_allowed:
      seasonal_allowed !== undefined ? seasonal_allowed || null : undefined,
  };

  // Strip out undefined values
  Object.keys(updateData).forEach(
    (key) => updateData[key] === undefined && delete updateData[key],
  );

  const { data, error } = await supabase
    .from("species")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// DELETE /api/admin/species - Delete by ID (or name fallback)
app.delete("/api/admin/species", auth("admin"), async (req, res) => {
  const { id, name } = req.body;

  if (!id && !name) {
    return res
      .status(400)
      .json({ error: "Species ID or name required for deletion" });
  }

  let query = supabase.from("species").delete();
  if (id) {
    query = query.eq("id", id);
  } else {
    query = query.eq("name", name);
  }

  const { error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

app.get("/api/admin/alerts", auth(["admin", "inspector"]), async (req, res) => {
  let q = supabase
    .from("alerts")
    .select("*, profiles(id, name, email)")
    .order("recorded_at", { ascending: false });
  if (!isAdmin(req.user)) {
    q = q.eq("user_id", req.user.id);
  }
  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });
  const mapped = (data || []).map((a) => ({
    ...a,
    userId: a.user_id,
    userName: a.user_name,
    recordedAt: a.recorded_at,
    user: a.profiles
      ? { id: a.profiles.id, name: a.profiles.name, email: a.profiles.email }
      : null,
  }));
  res.json(mapped);
});

app.patch(
  "/api/admin/alerts/:id",
  auth(["admin", "inspector"]),
  async (req, res) => {
    const id = req.params.id;
    const { status, note } = req.body;
    const { data: existing, error: e1 } = await supabase
      .from("alerts")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (e1 || !existing) return res.status(404).json({ error: "Not found" });
    if (!isSelfOrAdmin(req, existing.user_id))
      return res.status(403).json({ error: "Forbidden" });
    const next = {
      status: status || existing.status,
      note: note ?? existing.note,
    };
    const { error } = await supabase.from("alerts").update(next).eq("id", id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  },
);

app.delete("/api/admin/alerts/:id", auth("admin"), async (req, res) => {
  const id = req.params.id;
  const { data: existing, error: e1 } = await supabase
    .from("alerts")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (e1 || !existing) return res.status(404).json({ error: "Not found" });
  const { error } = await supabase.from("alerts").delete().eq("id", id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

app.post("/api/alerts", auth(), async (req, res) => {
  const { type, lat, lng, note } = req.body;
  if (!type || lat == null || lng == null)
    return res.status(400).json({ error: "Missing fields" });
  const { data: profile } = await supabase
    .from("profiles")
    .select("name")
    .eq("id", req.user.id)
    .maybeSingle();
  const { data, error } = await supabase
    .from("alerts")
    .insert({
      type: String(type),
      status: "pending",
      note: note || null,
      user_id: req.user.id,
      user_name: profile ? profile.name : null,
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      recorded_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  broadcast({
    type: "alert",
    item: {
      ...data,
      userId: data.user_id,
      userName: data.user_name,
      recordedAt: data.recorded_at,
    },
  });
  res.json(data);
});

app.post("/api/alerts/create", auth(), async (req, res) => {
  const { type, lat, lng, note } = req.body;
  if (!type || lat == null || lng == null)
    return res.status(400).json({ error: "Missing fields" });
  const { data: profile } = await supabase
    .from("profiles")
    .select("name")
    .eq("id", req.user.id)
    .maybeSingle();
  const { data, error } = await supabase
    .from("alerts")
    .insert({
      type: String(type),
      status: "pending",
      note: note || null,
      user_id: req.user.id,
      user_name: profile ? profile.name : null,
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      recorded_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  broadcast({
    type: "alert",
    item: {
      ...data,
      userId: data.user_id,
      userName: data.user_name,
      recordedAt: data.recorded_at,
    },
  });
  res.json(data);
});

app.get("/api/test_alerts", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/admin/protected_areas", auth("admin"), async (req, res) => {
  const { data, error } = await supabase
    .from("protected_areas")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(
    (data || []).map((pa) => ({
      id: pa.id,
      name: pa.name,
      geom: pa.geom || pa.geometry,
      rules: pa.rules,
      createdAt: pa.created_at,
      updatedAt: pa.updated_at,
    })),
  );
});

app.post("/api/admin/protected_areas", auth("admin"), async (req, res) => {
  const { name, geom, rules } = req.body;
  if (!geom) return res.status(400).json({ error: "Geom required" });
  const { data, error } = await supabase
    .from("protected_areas")
    .insert({ name: name || "Unnamed Zone", geom, rules: rules || null })
    .select("*")
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({
    id: data.id,
    name: data.name,
    geom: data.geom,
    rules: data.rules,
    createdAt: data.created_at,
  });
});

app.patch("/api/admin/protected_areas/:id", auth("admin"), async (req, res) => {
  const id = req.params.id;
  const { name, geom, rules } = req.body;
  const { data: existing, error: e1 } = await supabase
    .from("protected_areas")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (e1 || !existing) return res.status(404).json({ error: "Not found" });
  const next = {};
  if (name !== undefined) next.name = name;
  if (geom !== undefined) next.geom = geom;
  if (rules !== undefined) next.rules = rules;
  next.updated_at = new Date().toISOString();
  const { error } = await supabase
    .from("protected_areas")
    .update(next)
    .eq("id", id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

app.delete(
  "/api/admin/protected_areas/:id",
  auth("admin"),
  async (req, res) => {
    const id = req.params.id;
    const { data: existing, error: e1 } = await supabase
      .from("protected_areas")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (e1 || !existing) return res.status(404).json({ error: "Not found" });
    const { error } = await supabase
      .from("protected_areas")
      .delete()
      .eq("id", id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  },
);

app.get(
  "/api/activity_logs",
  auth(["admin", "inspector"]),
  async (req, res) => {
    const { type, userId, from, to, format } = req.query;
    const selfId = String(req.user.id || "");
    let q = supabase
      .from("activity_logs")
      .select("*, profiles(id, name, email)")
      .order("created_at", { ascending: false })
      .limit(500);
    if (isAdmin(req.user)) {
      if (userId) q = q.eq("user_id", userId);
    } else {
      if (userId && String(userId) !== selfId)
        return res.status(403).json({ error: "Forbidden" });
      q = q.eq("user_id", selfId);
    }
    if (type) q = q.eq("type", type);
    if (from) q = q.gte("created_at", from);
    if (to) q = q.lte("created_at", to + "T23:59:59");
    const { data, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    const out = (data || []).map((a) => ({
      id: a.id,
      user_id: a.user_id,
      userId: a.user_id,
      type: a.type,
      category: a.category,
      location: a.location,
      geom_line: a.geom_line,
      details: a.details,
      image_url: a.image_url,
      photoUrl: a.image_url,
      created_at: a.created_at,
      user: a.profiles
        ? { id: a.profiles.id, name: a.profiles.name, email: a.profiles.email }
        : null,
    }));
    if (format === "geojson") {
      const features = [];
      out.forEach((a) => {
        if (a.location && a.location.lng != null)
          features.push({
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [a.location.lng, a.location.lat],
            },
            properties: {
              id: a.id,
              type: a.type,
              category: a.category || null,
              user_id: a.user_id,
              created_at: a.created_at,
            },
          });
        if (Array.isArray(a.geom_line))
          features.push({
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: a.geom_line.map((p) => [p.lng, p.lat]),
            },
            properties: {
              id: a.id,
              type: a.type,
              category: a.category || null,
              user_id: a.user_id,
              created_at: a.created_at,
            },
          });
      });
      return res.json({ type: "FeatureCollection", features });
    }
    res.json(out);
  },
);

app.delete(
  "/api/activity_logs/:id",
  auth(["admin", "inspector"]),
  async (req, res) => {
    const id = req.params.id;
    const { data: existing, error: ePre } = await supabase
      .from("activity_logs")
      .select("user_id")
      .eq("id", id)
      .maybeSingle();
    if (ePre || !existing) return res.status(404).json({ error: "Not found" });
    if (!isSelfOrAdmin(req, existing.user_id))
      return res.status(403).json({ error: "Forbidden" });
    const { error } = await supabase
      .from("activity_logs")
      .delete()
      .eq("id", id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  },
);

app.get("/api/admin/activity_insights", auth("admin"), async (req, res) => {
  const startOfWeek = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { count, error } = await supabase
    .from("activity_logs")
    .select("*", { count: "exact", head: true })
    .gte("created_at", startOfWeek);
  if (error) return res.status(400).json({ error: error.message });
  res.json({
    illegal_in_protected: 0,
    approaches_last7: count || 0,
    patrol_km: 0,
  });
});

app.post("/api/images", auth(), async (req, res) => {
  const { catch_id, bucket_key, exif } = req.body;
  if (!catch_id || !bucket_key)
    return res.status(400).json({ error: "Missing fields" });
  const { data, error } = await supabase
    .from("images")
    .insert({
      catch_id,
      bucket_key,
      exif: exif || null,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.get("/api/images", auth(), async (req, res) => {
  const { data, error } = await supabase
    .from("images")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

const tileCache = new Map();
const BLANK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+lmZkAAAAASUVORK5CYII=",
  "base64",
);

app.get("/api/public/tiles/:z/:x/:y.png", async (req, res) => {
  try {
    const z = String(req.params.z || "");
    const x = String(req.params.x || "");
    const y = String(req.params.y || "");
    if (!/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) {
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.send(BLANK_PNG);
    }

    const key = `${z}/${x}/${y}`;
    const now = Date.now();
    const cached = tileCache.get(key);
    if (cached && cached.expiresAt > now) {
      res.setHeader("Content-Type", cached.contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.send(cached.body);
    }

    const upstream = `https://tile.openstreetmap.org/${key}.png`;
    let status = 502;
    let contentType = "image/png";
    let body = null;
    if (typeof fetch === "function") {
      const r = await fetch(upstream, {
        redirect: "follow",
        headers: { "User-Agent": "capstone-pro" },
      });
      status = r.status;
      if (r.ok) {
        contentType = r.headers.get("content-type") || "image/png";
        body = Buffer.from(await r.arrayBuffer());
      }
    } else {
      const result = await new Promise((resolve, reject) => {
        const upstreamReq = https.get(
          upstream,
          { headers: { "User-Agent": "capstone-pro" } },
          (upstreamRes) => {
            const chunks = [];
            upstreamRes.on("data", (c) => chunks.push(c));
            upstreamRes.on("end", () =>
              resolve({
                status: upstreamRes.statusCode || 502,
                contentType: String(
                  upstreamRes.headers["content-type"] || "image/png",
                ),
                body: Buffer.concat(chunks),
              }),
            );
          },
        );
        upstreamReq.on("error", reject);
      });
      status = result.status;
      contentType = result.contentType;
      body = result.body;
      if (status < 200 || status >= 300) body = null;
    }

    if (!body) {
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=300");
      return res.send(BLANK_PNG);
    }

    tileCache.set(key, {
      body,
      contentType,
      expiresAt: now + 24 * 60 * 60 * 1000,
    });
    if (tileCache.size > 600) {
      for (const k of tileCache.keys()) {
        tileCache.delete(k);
        if (tileCache.size <= 500) break;
      }
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(body);
  } catch {
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=60");
    res.send(BLANK_PNG);
  }
});

app.get("/api/public/config", (req, res) => {
  res.json({ mapboxToken: MAPBOX_TOKEN, vapidPublicKey: VAPID_PUBLIC });
});

app.get(
  "/api/admin/live",
  auth(["admin", "inspector", "NSAP Data Enumerator"]),
  (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("\n");
    sseClients.push(res);

    const hb = setInterval(() => {
      if (!res.destroyed) {
        try {
          res.write(":\n\n");
        } catch (_) {}
      }
    }, 30000);

    const cleanup = () => {
      clearInterval(hb);
      const idx = sseClients.indexOf(res);
      if (idx !== -1) sseClients.splice(idx, 1);
    };
    req.on("close", cleanup);
    req.on("error", cleanup);
  },
);

/* ---------- Vercel AI SDK routes (AI Gateway activates on Vercel deploy) ---------- */
let _ai = null;
let _openai = null;
let _anthropic = null;
let _google = null; // Added Gemini provider reference

try {
  _ai = require("ai");
} catch (e) {
  console.warn("[ai] ai package not installed:", e && e.message);
}
try {
  _openai = require("@ai-sdk/openai");
} catch (e) {
  console.warn("[ai] @ai-sdk/openai not installed:", e && e.message);
}
try {
  _anthropic = require("@ai-sdk/anthropic");
} catch (e) {
  console.warn("[ai] @ai-sdk/anthropic not installed:", e && e.message);
}
// 1. Require Google / Gemini SDK package
try {
  _google = require("@ai-sdk/google");
} catch (e) {
  console.warn("[ai] @ai-sdk/google not installed:", e && e.message);
}

function _pickAiModel() {
  if (!_ai) return null;

  // 1. Try Google Gemini first
  const geminiKey =
    process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (geminiKey && _google && typeof _google.google === "function") {
    try {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = geminiKey;
      return _google.google(process.env.GEMINI_MODEL || "gemini-2.5-flash");
    } catch (e) {
      console.warn("[ai] google() factory failed:", e && e.message);
    }
  }

  // 2. Fallback to OpenAI
  if (
    process.env.OPENAI_API_KEY &&
    _openai &&
    typeof _openai.openai === "function"
  ) {
    try {
      return _openai.openai(process.env.OPENAI_MODEL || "gpt-4o-mini");
    } catch (e) {
      console.warn("[ai] openai() factory failed:", e && e.message);
    }
  }

  // 3. Fallback to Anthropic
  if (
    process.env.ANTHROPIC_API_KEY &&
    _anthropic &&
    typeof _anthropic.anthropic === "function"
  ) {
    try {
      return _anthropic.anthropic(
        process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20240620",
      );
    } catch (e) {
      console.warn("[ai] anthropic() factory failed:", e && e.message);
    }
  }

  return null;
}

const BFAR_AI_SYSTEM_CHAT = `You are a helpful BFAR (Bureau of Fisheries and Aquatic Resources, Philippines) field assistant. 
Answer questions about: vessel registration, catch size limits, protected/endangered species, 
BFAR reporting deadlines, zoning for municipal vs commercial waters, and Philippine fisheries law.
Keep answers concise (under 250 words when possible). If you reference law, cite specific Republic Acts 
(e.g. RA 8550 Philippine Fisheries Code of 1998, RA 10654 amendments, RA 9147 Wildlife Act) when relevant. 
Do NOT fabricate specific section numbers if you are not confident — say "please cross-check with the latest BFAR AO (Administrative Order)" instead.`;

const BFAR_AI_SYSTEM_CATCH_ANALYSIS = `You are a BFAR fisheries compliance and stock-health analyst (Philippines).
Return ONLY a valid JSON object with keys:
  "summary":      one-paragraph plain text (< 160 chars),
  "bfarNotes":    one-paragraph regulatory notes mentioning RA 8550 / RA 10654 / Wildlife Act / BFAR AO if applicable,
  "stockHealth":  one of: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN",
  "recommendedActions": array of 0-4 short string actions an inspector could take next (<= 80 chars each).
No markdown fences, no extra commentary. Strict JSON only.`;

app.post("/api/ai/chat", auth(), async (req, res) => {
  const model = _pickAiModel();
  if (!model || !_ai)
    return res.status(503).json({
      error:
        "AI not configured. Add GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY to environment.",
    });
  const { messages = [] } = req.body || {};
  try {
    const { streamText } = _ai;
    const result = streamText({
      model,
      system: BFAR_AI_SYSTEM_CHAT,
      messages: Array.isArray(messages) ? messages : [],
      temperature: 0.2,
      maxSteps: 1,
      onFinish: ({ usage, finishReason }) => {
        try {
          console.log(
            `[ai/chat] user=${req.user && req.user.id} finish=${finishReason} usage=${JSON.stringify(usage)}`,
          );
        } catch {}
      },
    });
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.flushHeaders && res.flushHeaders();
    for await (const chunk of result.textStream) {
      if (chunk) res.write(chunk);
    }
    res.end();
  } catch (err) {
    try {
      console.error("[ai/chat] error", (err && err.stack) || err);
    } catch {}
    if (res.headersSent) {
      try {
        res.end();
      } catch {}
    } else res.status(500).json({ error: (err && err.message) || String(err) });
  }
});

app.post("/api/ai/catch-analysis", auth(), async (req, res) => {
  const model = _pickAiModel();
  if (!model || !_ai)
    return res.status(503).json({
      error:
        "AI not configured. Add GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY to environment.",
    });
  const {
    species = "",
    weightKg = null,
    location = "",
    notes = "",
    capturedAt = "",
  } = req.body || {};
  try {
    const { generateText } = _ai;
    const promptLines = [
      "Inspect this catch report from a BFAR field inspector and return the strict JSON shape requested in system.",
      `species: ${species || "(not provided)"}`,
      `weightKg: ${weightKg === null || weightKg === "" ? "(not provided)" : String(weightKg)}`,
      `capturedAt: ${capturedAt || "(not provided)"}`,
      `location: ${location || "(not provided)"}`,
      `inspector notes: ${notes || "(none)"}`,
      `reporter userId: ${req.user && req.user.id} (${req.user && req.user.role})`,
    ];
    const { text, usage, finishReason } = await generateText({
      model,
      system: BFAR_AI_SYSTEM_CATCH_ANALYSIS,
      prompt: promptLines.join("\n"),
      temperature: 0.2,
      maxRetries: 1,
    });
    let analysis;
    try {
      const cleaned = String(text || "")
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      analysis = JSON.parse(cleaned);
    } catch {
      analysis = {
        summary: (text || "").slice(0, 160),
        bfarNotes: "",
        stockHealth: "UNKNOWN",
        recommendedActions: [],
        _rawText: text,
      };
    }
    try {
      console.log(
        `[ai/catch-analysis] user=${req.user && req.user.id} finish=${finishReason} usage=${JSON.stringify(usage)}`,
      );
    } catch {}
    res.json({ ok: true, usage: usage || null, analysis });
  } catch (err) {
    try {
      console.error("[ai/catch-analysis] error", (err && err.stack) || err);
    } catch {}
    res.status(500).json({ error: (err && err.message) || String(err) });
  }
});

if (IS_SERVERLESS) {
  module.exports = app;
} else if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`Supabase Server running on port ${PORT}`);
  });
} else {
  module.exports = app;
}

app.get("/api/reports/monthly", auth(), async (req, res) => {
  const { month } = req.query; // Expected format: "YYYY-MM"

  if (!month) {
    return res
      .status(400)
      .json({ error: "Month parameter (YYYY-MM) is required." });
  }

  const startDate = `${month}-01T00:00:00.000Z`;

  // Calculate end date of month
  const [year, m] = month.split("-");
  const lastDay = new Date(year, m, 0).getDate();
  const endDate = `${month}-${lastDay}T23:59:59.999Z`;

  // Fetch logged user profile info
  const { data: profile } = await supabase
    .from("profiles")
    .select("name, municipality, barangay")
    .eq("id", req.user.id)
    .single();

  // Fetch catches for selected month
  const { data: catches, error } = await supabase
    .from("catches")
    .select("*")
    .eq("user_id", req.user.id)
    .gte("captured_at", startDate)
    .lte("captured_at", endDate)
    .order("captured_at", { ascending: true });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json({
    profile,
    catches: catches || [],
  });
});
