const ADMIN_BADGE_STORAGE_KEY = "admin_sidebar_reads_v1";
const state = {
  token: localStorage.getItem("fish_token"),
  user: JSON.parse(localStorage.getItem("fish_user") || "null"),
  species: [],
  currentModule: null,
  refreshTimer: null,
  alerts: [],
  _alarm: null,
  _alarmOn: false,
  mapPollTimer: null,
  liveEvents: [],
  statusByUserId: new Map(),
  selectedUsers: new Set(),
  readState: loadAdminReadState(),
  unreadCounts: {},
  tracksSummary: [],
  trackHistory: [],
  historyMap: null,
  historyRoute: null,
  currentHistoryUserId: null,
  currentHistoryFilter: "all",
  historySelectedTracks: new Set(),
  catchesSummary: [],
  catchHistory: [],
  catchHistoryMap: null,
  currentCatchHistoryUserId: null,
  currentCatchHistoryVesselId: null,
  currentCatchHistoryFilter: "all",
  historySelectedCatches: new Set(),
};

function loadAdminReadState() {
  try {
    const raw = localStorage.getItem(ADMIN_BADGE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function saveAdminReadState() {
  try {
    localStorage.setItem(
      ADMIN_BADGE_STORAGE_KEY,
      JSON.stringify(state.readState || {}),
    );
  } catch {}
}
function getReadSet(moduleId) {
  const list =
    state.readState && Array.isArray(state.readState[moduleId])
      ? state.readState[moduleId]
      : [];
  return new Set(list.map((x) => String(x)));
}
function setReadSet(moduleId, values) {
  if (!state.readState) state.readState = {};
  state.readState[moduleId] = Array.from(
    new Set((Array.isArray(values) ? values : []).map((x) => String(x))),
  );
  saveAdminReadState();
}
function getSpeciesMarkers() {
  return (Array.isArray(state.species) ? state.species : []).map((s) =>
    String(s),
  );
}
function getZoneMarkers() {
  return (Array.isArray(state.zones) ? state.zones : []).map(
    (z) =>
      `${z.id}:${z.updated_at || z.updatedAt || z.created_at || z.createdAt || z.name || ""}`,
  );
}
function getVesselMarkers() {
  return (Array.isArray(state.vessels) ? state.vessels : []).map(
    (v) =>
      `${v.id}:${v.updated_at || v.updatedAt || v.created_at || v.createdAt || ""}`,
  );
}
function getActiveMarkers() {
  return (Array.isArray(state.alerts) ? state.alerts : [])
    .filter((a) => a && a.type === "Status: Active")
    .map((a) => String(a.id));
}
function getLiveEventMarkers() {
  return (Array.isArray(state.liveEvents) ? state.liveEvents : []).map((e) =>
    String(e.id),
  );
}
function getModuleMarkers(moduleId) {
  switch (moduleId) {
    case "mod_users":
      return (Array.isArray(state.users) ? state.users : []).map((u) =>
        String(u.id),
      );
    case "mod_catches":
      return (
        Array.isArray(state.catchesSummary) ? state.catchesSummary : []
      ).map((c) => String(c.userId));
    case "mod_tracks":
      return (
        Array.isArray(state.tracksSummary) ? state.tracksSummary : []
      ).map((t) => String(t.userId));
    case "mod_species":
      return getSpeciesMarkers();
    case "mod_zones":
      return getZoneMarkers();
    case "mod_alerts":
      return getActiveMarkers();
    case "mod_exports":
      return [];
    case "mod_live":
      return getLiveEventMarkers();
    case "mod_vessels":
      return getVesselMarkers();
    case "mod_activity":
      return (Array.isArray(state.activityLogs) ? state.activityLogs : []).map(
        (a) => String(a.id),
      );
    default:
      return [];
  }
}
function formatBadgeCount(count) {
  return count > 99 ? "99+" : String(count);
}
function refreshSidebarBadges() {
  const modules = [
    "mod_users",
    "mod_catches",
    "mod_tracks",
    "mod_species",
    "mod_exports",
    "mod_live",
    "mod_vessels",
    "mod_activity",
  ];
  state.unreadCounts = {};
  modules.forEach((moduleId) => {
    const badge = document.querySelector(`[data-badge-for="${moduleId}"]`);
    if (!badge) return;
    const markers = getModuleMarkers(moduleId);
    const seen = getReadSet(moduleId);
    const unread = markers.filter((marker) => !seen.has(String(marker))).length;
    state.unreadCounts[moduleId] = unread;
    if (unread > 0) {
      badge.hidden = false;
      badge.textContent = formatBadgeCount(unread);
    } else {
      badge.hidden = true;
      badge.textContent = "";
    }
  });
}
function markModuleRead(moduleId) {
  if (!moduleId) return;
  const markers = getModuleMarkers(moduleId);
  setReadSet(moduleId, markers);
  refreshSidebarBadges();
}
function registerLiveEvent(kind, payload) {
  if (!state.liveEvents) state.liveEvents = [];
  const baseId =
    payload &&
    (payload.id ||
      payload.userId ||
      payload.recordedAt ||
      payload.at ||
      Date.now());
  const eventId = `${kind}:${baseId}`;
  if (state.liveEvents.some((e) => e.id === eventId)) return;
  state.liveEvents.unshift({
    id: eventId,
    kind,
    payload,
    createdAt: new Date().toISOString(),
  });
  if (state.liveEvents.length > 200)
    state.liveEvents = state.liveEvents.slice(0, 200);
  if (state.currentModule === "mod_live") markModuleRead("mod_live");
  else refreshSidebarBadges();
}
(function ingestGoogleAuthParams() {
  try {
    const params = new URLSearchParams(location.search);
    const token = params.get("token");
    const userRaw = params.get("user");
    if (token) {
      localStorage.setItem("fish_token", token);
      state.token = token;
    }
    if (userRaw) {
      try {
        const user = JSON.parse(userRaw);
        localStorage.setItem("fish_user", JSON.stringify(user));
        state.user = user;
      } catch (e) {}
    }
    if (token || userRaw) {
      const u = new URL(location.href);
      u.searchParams.delete("token");
      u.searchParams.delete("user");
      window.history.replaceState({}, document.title, u.toString());
    }
  } catch (e) {}
})();
if (!state.token || (state.user && state.user.role !== "admin")) {
  location.href = "/login.html";
} else {
  const initAdmin = () => {
    try {
      document.body.classList.remove("auth-bg");
      document.getElementById("admin_app").style.display = "";
      document.getElementById("logout_btn").style.display = "";

      // Update Navbar User Info
      if (state.user) {
        document.getElementById("user_profile").style.display = "block";
        document.getElementById("user_name").textContent =
          state.user.name || state.user.email;
        document.getElementById("user_role").textContent =
          state.user.role || "Admin";
      }

      showAdminModule("mod_users");
      try {
        loadData();
      } catch {}
      setupAutoRefreshAdmin();
    } catch (e) {
      if (!window._authInvalidated) {
        const msg = e && e.message ? String(e.message) : "";
        const isAuth =
          msg.indexOf("Invalid token") !== -1 || msg.indexOf("Token") !== -1;
        if (!isAuth) console.error("Admin init error:", e);
      }
    }
  };
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", initAdmin);
  } else {
    initAdmin();
  }
}
async function loginAdmin() {
  try {
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: document.getElementById("email").value.trim(),
        password: document.getElementById("pass").value,
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Login failed");
    if (d.user.role !== "admin") throw new Error("Not an admin account");
    state.token = d.token;
    document.body.classList.remove("auth-bg");
    document.getElementById("login_card").style.display = "none";
    document.getElementById("admin_app").style.display = "";
    document.getElementById("msg").textContent = "";
    document.getElementById("logout_btn").style.display = "";
    showAdminModule("mod_users");
    loadData();
  } catch (e) {
    document.getElementById("msg").textContent = e.message;
  }
}

function logoutAdmin() {
  state.token = null;
  state.user = null;
  try {
    localStorage.removeItem("fish_token");
    localStorage.removeItem("fish_user");
  } catch {}
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
  stopUserMapPolling();
  try {
    if (window._liveES) {
      window._liveES.close();
      window._liveES = null;
    }
  } catch {}
  window._liveRetryTimer = null;
  window._liveRetryAttempts = 0;
  window._authInvalidated = true;
  const logoutBtn = document.getElementById("logout_btn");
  if (logoutBtn) logoutBtn.style.display = "none";
  const adminApp = document.getElementById("admin_app");
  if (adminApp) adminApp.style.display = "none";
  const loginCard = document.getElementById("login_card");
  if (loginCard) loginCard.style.display = "";
  document.body.classList.add("auth-bg");
  location.href = "/login.html";
}
let _redirectingToLogin = false;
function handleAuthFailure() {
  if (_redirectingToLogin) return;
  _redirectingToLogin = true;
  logoutAdmin();
}

async function installAdmin() {
  try {
    const email = document.getElementById("email").value || "admin@local.test";
    const pass = document.getElementById("pass").value || "admin123";
    const r = await fetch("/api/public/install_admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: pass,
        name: "Administrator",
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Install failed");
    document.getElementById("msg").textContent =
      "Admin installed. Logging in...";
    await loginAdmin();
  } catch (e) {
    document.getElementById("msg").textContent = e.message;
  }
}

function showAdminModule(id) {
  const ids = [
    "mod_users",
    "mod_catches",
    "mod_tracks",
    "mod_map",
    "mod_species",
    "mod_fishing_gears", // Added module ID
    "mod_exports",
    "mod_vessels",
    "mod_live",
    "mod_activity",
  ];

  ids.forEach((x) => {
    const el = document.getElementById(x);
    if (el) el.style.display = x === id ? "" : "none";
  });

  const btns = document.querySelectorAll("#sidebar button");
  btns.forEach((b) => b.classList.toggle("active", b.dataset.module === id));

  state.currentModule = id;
  markModuleRead(id);

  if (id !== "mod_catches") closeCatchHistory();

  if (id === "mod_map") {
    setTimeout(initUserMap, 50);
    startUserMapPolling();
  } else {
    stopUserMapPolling();
  }

  if (id === "mod_zones") {
    setTimeout(initZoneMap, 50);
  }

  if (id === "mod_vessels") {
    loadVesselsAdmin();
  }

  // Trigger data fetch for fishing gears
  if (id === "mod_fishing_gears") {
    loadFishingGears();
  }

  if (window.matchMedia("(max-width: 900px)").matches) toggleDrawer(false);
}

function startUserMapPolling() {
  if (state.mapPollTimer) return;
  state.mapPollTimer = setInterval(() => {
    if (state.currentModule !== "mod_map") return;
    try {
      refreshUserMap(false);
    } catch {}
  }, 5000);
}
function stopUserMapPolling() {
  if (!state.mapPollTimer) return;
  clearInterval(state.mapPollTimer);
  state.mapPollTimer = null;
}

function refreshDataAdmin(explicitClick) {
  if (!state.token || window._authInvalidated) return;
  if (!explicitClick && document.querySelector("tr[data-id] select")) return;

  try {
    loadData();
  } catch {}

  const m = state.currentModule;
  if (m === "mod_activity") {
    try {
      loadActivity();
    } catch {}
  }
  if (m === "mod_vessels") {
    try {
      loadVesselsAdmin();
    } catch {}
  }
  if (m === "mod_map") {
    try {
      refreshUserMap(true);
    } catch {}
  }
  if (m === "mod_species") {
    try {
      // FIX: Use background silent load instead of reloadSpecies() to avoid preloader
      loadSpeciesData(true);
    } catch {}
  }
  if (m === "mod_live") {
    try {
      ensureLive(true);
    } catch {}
  }

  if (typeof explicitClick === "boolean" && explicitClick) {
    const flashBtn = document.getElementById("refresh_btn");
    if (flashBtn) {
      flashBtn.style.transition = "transform 0.4s ease";
      flashBtn.style.transform = "rotate(360deg)";
      setTimeout(() => {
        if (flashBtn) flashBtn.style.transform = "";
      }, 500);
    }
  }
}

function goAdminHome() {
  showAdminModule("mod_map");
  toggleDrawer(false);
}
function setupAutoRefreshAdmin() {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(refreshDataAdmin, 30000);
}

function toggleDrawer(open) {
  const sb = document.getElementById("sidebar");
  const ov = document.getElementById("drawer_overlay");
  if (open) {
    sb.classList.add("open");
    ov.classList.add("show");
  } else {
    sb.classList.remove("open");
    ov.classList.remove("show");
  }
}
window.addEventListener("keydown", function (e) {
  if (e.key === "Escape") toggleDrawer(false);
});

async function loadData() {
  if (window._authInvalidated) return;
  const headers = { Authorization: "Bearer " + state.token };

  const safeFetchJson = async (url, fallback = []) => {
    try {
      const res = await fetch(url, { headers });
      if (res.status === 401) {
        handleAuthFailure();
        return fallback;
      }
      if (!res.ok) return fallback;
      return await res.json();
    } catch (e) {
      console.warn(`Failed to fetch ${url}:`, e);
      return fallback;
    }
  };

  // 1. Fetch users
  let users = await safeFetchJson("/api/users", []);

  // 2. Fetch live locations & compute activity status
  let lrData = await safeFetchJson("/api/admin/live_locations", []);
  let latestAct = new Map();
  (Array.isArray(lrData) ? lrData : []).forEach((p) => {
    const at = p.lastSeenAt || p.recordedAt;
    if (at)
      latestAct.set(p.userId, {
        at: new Date(at),
        active: p.active !== false,
      });
  });

  // 3. Sort users
  users = (Array.isArray(users) ? users : []).sort((a, b) => {
    const aAct = latestAct.get(a.id);
    const bAct = latestAct.get(b.id);
    const aActive = aAct && aAct.active ? 0 : 1;
    const bActive = bAct && bAct.active ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;

    const aDateRaw = a.created_at || a.createdAt || 0;
    const bDateRaw = b.created_at || b.createdAt || 0;
    const aAt = aAct ? aAct.at.getTime() : new Date(aDateRaw).getTime();
    const bAt = bAct ? bAct.at.getTime() : new Date(bDateRaw).getTime();
    return bAt - aAt;
  });

  state.users = users;
  state.latestUserActivity = latestAct;

  // 4. Fetch catches and summaries
  const catchesRaw = await safeFetchJson("/api/catches", []);
  state.catches = (Array.isArray(catchesRaw) ? catchesRaw : []).sort(
    (a, b) =>
      new Date(b.capturedAt || b.created_at || b.createdAt || 0) -
      new Date(a.capturedAt || a.created_at || a.createdAt || 0),
  );

  state.catchesSummary = await safeFetchJson("/api/admin/catches/summary", []);

  // 5. Fetch images and map by catch_id
  const images = await safeFetchJson("/api/images", []);
  state.images = images;
  const imgsByCatch = {};
  images.forEach((i) => {
    const k = i.catch_id;
    if (k) {
      if (!imgsByCatch[k]) imgsByCatch[k] = [];
      imgsByCatch[k].push(i);
    }
  });
  state.imgsByCatch = imgsByCatch;

  // 6. Fetch track summaries and raw tracks (FIXED ENDPOINT HERE)
  state.tracksSummary = await safeFetchJson("/api/admin/tracks/summary", []);
  let tracks = await safeFetchJson("/api/admin/tracks", []);
  state.tracks = (Array.isArray(tracks) ? tracks : []).sort(
    (a, b) => new Date(b.recordedAt || 0) - new Date(a.recordedAt || 0),
  );

  // 7. Fetch species, protected zones, alerts, vessels, and logs
  const rawSpecies = await safeFetchJson("/api/admin/species", []);
  state.species = rawSpecies;
  speciesCache = Array.isArray(rawSpecies) ? rawSpecies : [];

  state.zones = await safeFetchJson("/api/admin/protected_areas", []);
  const alerts = await safeFetchJson("/api/admin/alerts", []);
  state.alerts = alerts;

  const vesselsRaw = await safeFetchJson("/api/vessels", []);
  state.vessels = (Array.isArray(vesselsRaw) ? vesselsRaw : []).sort(
    (a, b) =>
      new Date(b.created_at || b.createdAt || b.recordedAt || 0) -
      new Date(a.created_at || a.createdAt || a.recordedAt || 0),
  );

  const actLogsRaw = await safeFetchJson("/api/activity_logs", []);
  state.activityLogs = (Array.isArray(actLogsRaw) ? actLogsRaw : []).sort(
    (a, b) =>
      new Date(b.created_at || b.createdAt || b.recordedAt || 0) -
      new Date(a.created_at || a.createdAt || a.recordedAt || 0),
  );

  // 8. Execute UI filters and rendering
  if (typeof filterUsers === "function") filterUsers();
  if (typeof filterCatches === "function") filterCatches();
  if (typeof filterTracks === "function") filterTracks();

  // FIX: Render species cards instead of legacy object-to-string innerHTML
  if (document.getElementById("speciesList")) {
    renderSpeciesList(speciesCache);
  }

  if (typeof updateZoneListUi === "function") updateZoneListUi();
  if (typeof renderZonesOnMap === "function") renderZonesOnMap();

  const at = document.getElementById("alerts");
  if (at) {
    at.innerHTML =
      "<tr><th>Type</th><th>Status</th><th>User</th><th>Coords</th><th>Time</th><th>Action</th></tr>";
    alerts.forEach((a) => {
      const u = (Array.isArray(state.users) ? state.users : []).find(
        (x) => x.id === a.userId,
      );
      const uname = u ? u.name : a.userId || "Unknown";
      const actions =
        (a.status === "resolved"
          ? ""
          : a.status === "acknowledged"
            ? `<button onclick="resolveAlert('${a.id}')">Resolve</button>`
            : `<button onclick="acknowledgeAlert('${a.id}')">Acknowledge</button> <button onclick="resolveAlert('${a.id}')">Resolve</button>`) +
        ` <button onclick="confirmDeleteAlert('${a.id}')">Delete</button>`;

      let typeStyle = "";
      if (a.type === "Status: Active")
        typeStyle =
          "background:#dcfce7; color:#166534; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600";
      else if (a.type === "Status: In Port")
        typeStyle =
          "background:#fef9c3; color:#854d0e; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600";
      else if (a.type === "Status: In Transit")
        typeStyle =
          "background:#dbeafe; color:#1e40af; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600";

      const typeDisplay = typeStyle
        ? `<span style="${typeStyle}">${a.type}</span>`
        : a.type;
      const latVal = typeof a.lat === "number" ? a.lat : 0;
      const lngVal = typeof a.lng === "number" ? a.lng : 0;
      at.innerHTML += `<tr><td>${typeDisplay}</td><td>${a.status || ""}</td><td>${uname}</td><td>${latVal.toFixed(5)}, ${lngVal.toFixed(5)}</td><td>${new Date(a.recordedAt || 0).toLocaleString()}</td><td>${actions}</td></tr>`;
    });
  }

  if (typeof loadActivity === "function") loadActivity();
  if (state.currentModule && typeof markModuleRead === "function")
    markModuleRead(state.currentModule);
  if (typeof refreshSidebarBadges === "function") refreshSidebarBadges();
  if (typeof ensureLive === "function") ensureLive();
}

let adminVesselsData = [];

async function loadVesselsAdmin() {
  try {
    const r = await fetch("/api/vessels", {
      headers: { Authorization: "Bearer " + state.token },
    });
    if (r.status === 401) {
      handleAuthFailure();
      return;
    }
    const d = await r.json();
    if (!r.ok) return;
    adminVesselsData = Array.isArray(d)
      ? d.sort(
          (a, b) =>
            new Date(b.created_at || b.createdAt || 0) -
            new Date(a.created_at || a.createdAt || 0),
        )
      : [];
    renderVesselsAdmin();
  } catch (e) {
    console.error("Failed to load vessels:", e);
  }
}

function renderVesselsAdmin(vessels) {
  const arr = Array.isArray(vessels)
    ? vessels
    : Array.isArray(adminVesselsData)
      ? adminVesselsData
      : [];
  const table = document.getElementById("vesselsTable");
  if (!table) return;

  if (!arr.length) {
    table.innerHTML =
      '<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text-muted)">No vessels registered yet</td></tr>';
    return;
  }

  table.innerHTML = `
    <tr>
      <th>Registration #</th>
      <th>Vessel Name</th>
      <th>Owner</th>
      <th>Barangay</th>
      <th>Created</th>
      <th>Updated</th>
    </tr>
    ${arr
      .map((v) => {
        // Aligned: Check both vessel_name and name properties
        const vesselName = v.vessel_name || v.name || "—";
        const regNum =
          v.vessel_registration_number || v.registration_number || "—";
        const ownerName = v.owner_name || v.owner || "—";
        const barangay = v.barangay || "—";

        const createdAt = v.created_at || v.createdAt;
        const updatedAt = v.updated_at || v.updatedAt;

        const createdStr = createdAt
          ? new Date(createdAt).toLocaleString()
          : "—";
        const updatedStr = updatedAt
          ? new Date(updatedAt).toLocaleString()
          : "—";

        return `
          <tr>
            <td>${regNum}</td>
            <td>${vesselName}</td>
            <td>${ownerName}</td>
            <td>${barangay}</td>
            <td>${createdStr}</td>
            <td>${updatedStr}</td>
          </tr>
        `;
      })
      .join("")}
  `;
}

function filterVessels() {
  const q = document.getElementById("vesselSearch")?.value.toLowerCase().trim();
  if (!q) {
    renderVesselsAdmin();
    return;
  }
  const src = Array.isArray(adminVesselsData) ? adminVesselsData : [];
  const filtered = src.filter((v) => {
    const regNum = (
      v.vessel_registration_number ||
      v.registration_number ||
      ""
    ).toLowerCase();
    const vesselName = (v.vessel_name || v.name || "").toLowerCase();
    const ownerName = (v.owner_name || v.owner || "").toLowerCase();
    const barangay = (v.barangay || "").toLowerCase();

    return (
      regNum.includes(q) ||
      vesselName.includes(q) ||
      ownerName.includes(q) ||
      barangay.includes(q)
    );
  });
  renderVesselsAdmin(filtered);
}

// --- SPECIES MANAGEMENT MODULE STATE ---
let speciesCache = [];

// Load species data (isBackground = true silences the preloader)
async function loadSpeciesData(isBackground = false) {
  try {
    const res = await apiFetch("/api/admin/species", {
      showLoader: !isBackground, // Suppress preloader on polling interval
      loaderMessage: "Loading species data...",
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to load species.");
    }

    const data = await res.json();

    // Normalize string-array vs object-array responses safely
    speciesCache = Array.isArray(data)
      ? data.map((item) =>
          typeof item === "string" ? { id: item, name: item } : item,
        )
      : [];

    renderSpeciesList(speciesCache);
  } catch (err) {
    if (!isBackground) {
      showNotification(err.message, "error");
    }
  }
}

// Render cards safely preventing [object Object] rendering
function renderSpeciesList(items) {
  const container = document.getElementById("speciesList");
  if (!container) return;

  if (!items || items.length === 0) {
    container.innerHTML = `
      <li style="grid-column: 1 / -1; text-align: center; color: #64748b; padding: 24px; background: #f8fafc; border-radius: 8px;">
        No species found.
      </li>`;
    return;
  }

  container.innerHTML = items
    .map((sp) => {
      // Ensure we access string properties properly
      const name = typeof sp === "string" ? sp : sp.name || "Unknown";
      const id = sp.id || name;
      const img =
        sp.image_url || "https://via.placeholder.com/150?text=No+Image";
      const scName = sp.scientific_name ? `<i>(${sp.scientific_name})</i>` : "";
      const price = sp.price_per_kg
        ? `₱${parseFloat(sp.price_per_kg).toFixed(2)}/kg`
        : "N/A";
      const status = sp.conservation || "Unspecified";

      return `
      <li style="
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        box-shadow: 0 2px 4px rgba(0,0,0,0.04);
      ">
        <div style="position: relative; height: 130px; background: #f1f5f9;">
          <img src="${img}" alt="${name}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.src='https://via.placeholder.com/150?text=No+Image'" />
          <span style="
            position: absolute; top: 8px; right: 8px;
            background: rgba(15, 23, 42, 0.75); color: #fff;
            font-size: 11px; padding: 2px 8px; border-radius: 12px;
          ">${status}</span>
        </div>
        
        <div style="padding: 12px; flex-grow: 1;">
          <h4 style="margin: 0 0 4px 0; color: #0f172a; font-size: 16px;">${name}</h4>
          <div style="font-size: 12px; color: #64748b; margin-bottom: 8px;">${scName}</div>
          <div style="font-size: 13px; font-weight: 600; color: var(--primary, #2563eb);">Price: ${price}</div>
          ${sp.description ? `<p style="font-size: 12px; color: #475569; margin: 8px 0 0 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${sp.description}</p>` : ""}
        </div>

        <div style="
          padding: 8px 12px; background: #f8fafc; border-top: 1px solid #e2e8f0;
          display: flex; justify-content: flex-end; gap: 6px;
        ">
          <button onclick="editSpecies('${id}')" style="background: #3b82f6; padding: 6px 10px; font-size: 12px; color: #fff; border: none; border-radius: 6px; cursor: pointer;">
            <i class="fa-solid fa-pen-to-square"></i> Edit
          </button>
          <button onclick="removeSpecies('${id}', '${name.replace(/'/g, "\\'")}')" style="background: #ef4444; padding: 6px 10px; font-size: 12px; color: #fff; border: none; border-radius: 6px; cursor: pointer;">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </li>
    `;
    })
    .join("");
}

// User-triggered manual reload (Shows preloader)
function reloadSpecies() {
  loadSpeciesData(false);
}

// Client-side search filter function
function filterSpecies() {
  const query = (document.getElementById("speciesSearchInput").value || "")
    .toLowerCase()
    .trim();
  if (!query) {
    renderSpeciesList(speciesCache);
    return;
  }

  const filtered = speciesCache.filter((sp) => {
    const nameMatch = sp.name && sp.name.toLowerCase().includes(query);
    const sciMatch =
      sp.scientific_name && sp.scientific_name.toLowerCase().includes(query);
    const consMatch =
      sp.conservation && sp.conservation.toLowerCase().includes(query);
    return nameMatch || sciMatch || consMatch;
  });

  renderSpeciesList(filtered);
}

// Modal controls: Open for Creation
function openSpeciesModal() {
  document.getElementById("speciesForm").reset();
  document.getElementById("sp_id").value = "";
  document.getElementById("speciesModalTitle").innerText = "Add New Species";
  const modal = document.getElementById("speciesModal");
  modal.style.display = "flex";
}

// Modal controls: Open for Editing
function editSpecies(id) {
  const sp = speciesCache.find((item) => item.id === id);
  if (!sp) return;

  document.getElementById("sp_id").value = sp.id || "";
  document.getElementById("sp_name").value = sp.name || "";
  document.getElementById("sp_scientific_name").value =
    sp.scientific_name || "";
  document.getElementById("sp_min_length_cm").value = sp.min_length_cm ?? "";
  document.getElementById("sp_max_length_cm").value = sp.max_length_cm ?? "";
  document.getElementById("sp_price_per_kg").value = sp.price_per_kg ?? "";
  document.getElementById("sp_conservation").value = sp.conservation || "";
  document.getElementById("sp_seasonal_allowed").value =
    sp.seasonal_allowed || "";
  document.getElementById("sp_image_url").value = sp.image_url || "";
  document.getElementById("sp_description").value = sp.description || "";

  document.getElementById("speciesModalTitle").innerText = "Edit Species";
  document.getElementById("speciesModal").style.display = "flex";
}

// Close Modal
function closeSpeciesModal() {
  document.getElementById("speciesModal").style.display = "none";
}

// SAVE / UPDATE Species Handler
async function saveSpecies(event) {
  event.preventDefault();
  const id = document.getElementById("sp_id").value;
  const isUpdate = Boolean(id);

  const payload = {
    name: document.getElementById("sp_name").value,
    scientific_name:
      document.getElementById("sp_scientific_name").value || null,
    min_length_cm:
      parseFloat(document.getElementById("sp_min_length_cm").value) || null,
    max_length_cm:
      parseFloat(document.getElementById("sp_max_length_cm").value) || null,
    price_per_kg:
      parseFloat(document.getElementById("sp_price_per_kg").value) || null,
    conservation: document.getElementById("sp_conservation").value || null,
    seasonal_allowed:
      document.getElementById("sp_seasonal_allowed").value || null,
    image_url: document.getElementById("sp_image_url").value || null,
    description: document.getElementById("sp_description").value || null,
  };

  const url = isUpdate ? `/api/admin/species/${id}` : "/api/admin/species";
  const method = isUpdate ? "PUT" : "POST";
  const loaderMsg = isUpdate ? "Updating species..." : "Saving new species...";

  try {
    const res = await apiFetch(url, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      loaderMessage: loaderMsg,
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Save failed.");
    }

    showNotification(
      isUpdate
        ? "Species updated successfully!"
        : "Species added successfully!",
      "success",
    );
    closeSpeciesModal();
    reloadSpecies();
  } catch (err) {
    showNotification(err.message, "error");
  }
}

// DELETE Species Handler (Accepts ID or fallback Name)
async function removeSpecies(id, name) {
  if (!confirm(`Are you sure you want to delete "${name}"?`)) return;

  try {
    const res = await apiFetch("/api/admin/species", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name }),
      loaderMessage: `Deleting ${name}...`,
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Deletion failed.");
    }

    showNotification("Species deleted successfully!", "success");
    reloadSpecies();
  } catch (err) {
    showNotification(err.message, "error");
  }
}

// --- 1. LOAD USERS FROM BACKEND (CACHE-BUSTED) ---
async function loadUsers(options = {}) {
  try {
    const res = await apiFetch("/api/users", {
      loaderMessage: "Loading users list...",
      ...options,
    });

    if (!res.ok) throw new Error("Failed to load users");

    const data = await res.json();
    const usersList = Array.isArray(data) ? data : [];

    // Keep global state in sync if present
    if (typeof state !== "undefined") {
      state.users = usersList;
    }

    renderUsers(usersList);
  } catch (err) {
    console.error("Error loading users:", err);
    const ut = document.getElementById("users");
    if (ut) {
      ut.innerHTML =
        '<tr><td colspan="5" style="text-align:center; padding: 24px; color: var(--text-muted);">Failed to load users.</td></tr>';
    }
    showNotification("Failed to refresh users table.", "error");
  }
}

// --- 2. RENDER USERS TABLE ---
async function renderUsers(users) {
  const ut = document.getElementById("users");
  if (!ut) return;

  let arr = users;

  // If no user list is passed directly, fetch fresh data using cache-busted fetch
  if (!Array.isArray(arr)) {
    await loadUsers();
    return;
  }

  ut.innerHTML = `
    <tr>
      <th>Full Name</th>
      <th>Email</th>
      <th>Role</th>
      <th>Created</th>
      <th>Action</th>
    </tr>
  `;

  if (arr.length === 0) {
    ut.innerHTML +=
      '<tr><td colspan="5" style="text-align:center; padding: 24px; color: var(--text-muted);">No users found.</td></tr>';
    return;
  }

  arr.forEach((u) => {
    const role = u.role || "None";
    const nameStr = (u.name || "").replace(/'/g, "\\'");
    const emailStr = (u.email || "").replace(/'/g, "\\'");

    const rawDate = u.created_at || u.createdAt;
    let createdDateText = "—";

    if (rawDate) {
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) {
        createdDateText = d.toLocaleDateString("en-US", {
          month: "long",
          day: "2-digit",
          year: "numeric",
        });
      }
    }

    let roleDisplay = role.charAt(0).toUpperCase() + role.slice(1);
    if (role === "inspector") {
      roleDisplay = "NSAP Data Enumerator";
    }

    const actionButtons =
      role === "admin"
        ? '<span class="small">protected</span>'
        : `<button onclick="editUserDetails('${u.id}', '${nameStr}', '${emailStr}', '${role}')">Update</button> 
           <button onclick="deleteUser('${u.id}')" style="background:#ef4444;">Delete</button>`;

    ut.innerHTML += `
      <tr>
        <td>${u.name || "Unnamed User"}</td>
        <td>${u.email || "—"}</td>
        <td>
          <span style="background:#f3f4f6; color:#374151; padding:2px 10px; border-radius:12px; font-size:12px; font-weight:600;">
            ${roleDisplay}
          </span>
        </td>
        <td class="small">${createdDateText}</td>
        <td>${actionButtons}</td>
      </tr>
    `;
  });
}

// --- 3. SAVE / UPDATE USER FORM ---
async function saveUserForm() {
  const userId = document.getElementById("editingUserId").value;
  const name = document.getElementById("newUserName").value.trim();
  const email = document.getElementById("newUserEmail").value.trim();
  const password = document.getElementById("newUserPass").value;
  const role = document.getElementById("newUserRole").value;

  if (!name || !email) {
    showNotification("Name and Email are required.", "error");
    return;
  }

  try {
    let url, method, payload;

    if (userId) {
      url = `/api/users/${userId}`;
      method = "PUT";
      payload = { name, email, role };
      if (password) payload.password = password;
    } else {
      if (!password) {
        showNotification(
          "Password is required when creating a new account.",
          "error",
        );
        return;
      }
      url = "/api/users";
      method = "POST";
      payload = { name, email, password, role };
    }

    const res = await apiFetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      loaderMessage: userId
        ? "Updating user account..."
        : "Creating new account...",
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showNotification(`Failed: ${data.error || res.statusText}`, "error");
      return;
    }

    showNotification(
      `User ${userId ? "updated" : "created"} successfully!`,
      "success",
    );
    resetUserForm();

    // Silent re-fetch background sync
    await loadUsers({ showLoader: false });
  } catch (err) {
    console.error("Network Error:", err);
    showNotification("An unexpected network error occurred.", "error");
  }
}

// --- 4. PREPARE FORM FOR EDITING ---
function editUserDetails(userId, currentName, currentEmail, currentRole) {
  document.getElementById("editingUserId").value = userId;
  document.getElementById("newUserName").value = currentName || "";
  document.getElementById("newUserEmail").value = currentEmail || "";
  document.getElementById("newUserRole").value = currentRole || "fisher";
  document.getElementById("newUserPass").value = "";

  document.getElementById("userFormHeader").innerText = "UPDATE USER DETAILS";

  const submitBtn = document.getElementById("userFormSubmitBtn");
  submitBtn.innerHTML =
    '<i class="fa-solid fa-pen-to-square"></i> Save_Changes';

  document.getElementById("userFormCancelBtn").style.display = "inline-block";

  document
    .getElementById("userFormContainer")
    ?.scrollIntoView({ behavior: "smooth" });
}

// --- 5. DELETE USER (OPTIMISTIC UI UPDATE) ---
function deleteUser(id) {
  openConfirm(
    "Are you sure you want to delete this user? This action cannot be undone.",
    async () => {
      try {
        const res = await apiFetch(`/api/admin/users/${id}`, {
          method: "DELETE",
          loaderMessage: "Deleting user account...",
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          showNotification(
            `Failed to delete: ${data.error || res.statusText}`,
            "error",
          );
          return;
        }

        // Optimistic UI Update
        if (typeof state !== "undefined" && Array.isArray(state.users)) {
          state.users = state.users.filter((u) => String(u.id) !== String(id));
          renderUsers(state.users);
        }

        showNotification("User deleted successfully!", "success");

        if (document.getElementById("editingUserId").value === String(id)) {
          resetUserForm();
        }

        // Silent re-sync state with backend
        await loadUsers({ showLoader: false });
      } catch (err) {
        console.error("Delete Error:", err);
        showNotification(
          "An unexpected error occurred while deleting.",
          "error",
        );
      }
    },
    { title: "Delete User", confirmText: "Delete User", isDanger: true },
  );
}

// --- 6. CHANGE ROLE (DIRECT API ACTION) ---
async function changeRole(id, role) {
  try {
    const res = await apiFetch(`/api/admin/users/${id}/role`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
      loaderMessage: "Updating user role...",
    });

    if (!res.ok) {
      showNotification("Failed to update user role.", "error");
      return;
    }

    showNotification("User role updated successfully!", "success");
    await loadUsers({ showLoader: false });
  } catch (err) {
    console.error("Change Role Error:", err);
    showNotification("Error updating user role.", "error");
  }
}

// --- 7. FILTER USERS ---
function filterUsers() {
  const searchInput = document.getElementById("userSearch");
  const q = searchInput ? searchInput.value.toLowerCase().trim() : "";

  const userList =
    typeof state !== "undefined" && Array.isArray(state.users)
      ? state.users
      : [];

  if (!q) {
    renderUsers(userList);
    return;
  }

  const filtered = userList.filter(
    (u) =>
      (u.name || "").toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q) ||
      (u.role || "").toLowerCase().includes(q),
  );

  renderUsers(filtered);
}

// --- 8. RESET FORM TO "CREATE" MODE ---
function resetUserForm() {
  document.getElementById("editingUserId").value = "";
  document.getElementById("newUserName").value = "";
  document.getElementById("newUserEmail").value = "";
  document.getElementById("newUserPass").value = "";
  document.getElementById("newUserRole").value = "fisher";

  document.getElementById("userFormHeader").innerText = "CREATE NEW ACCOUNT";

  const submitBtn = document.getElementById("userFormSubmitBtn");
  submitBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Create User';

  document.getElementById("userFormCancelBtn").style.display = "none";
}

let fishingGearsData = [];

// --- 1. LOAD FISHING GEARS FROM BACKEND (CACHE-BUSTED) ---
async function loadFishingGears() {
  const token =
    (typeof state !== "undefined" && state.token) ||
    localStorage.getItem("token") ||
    "";

  try {
    // Add timestamp to prevent browser/CDN caching
    const res = await fetch(`/api/fishing-gears?_t=${Date.now()}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
      },
      cache: "no-store",
    });

    if (!res.ok) throw new Error("Failed to load fishing gears");

    const data = await res.json();
    fishingGearsData = Array.isArray(data) ? data : [];

    // Always render directly from fresh data
    renderFishingGears(fishingGearsData);
  } catch (err) {
    console.error("Error loading fishing gears:", err);
    showNotification("Failed to refresh fishing gears table.", "error");
  }
}

// --- 2. RENDER TABLE ROWS ---
function renderFishingGears(list = []) {
  const table = document.getElementById("fishingGearsTable");
  if (!table) return;

  if (list.length === 0) {
    table.innerHTML = `
      <thead>
        <tr>
          <th>Gear Code</th>
          <th>Gear Name</th>
          <th style="text-align: right;">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="3" style="text-align: center; color: var(--text-muted); padding: 16px;">
            No fishing gears found.
          </td>
        </tr>
      </tbody>`;
    return;
  }

  const rows = list
    .map(
      (g) => `
    <tr>
      <td><strong>${g.gear_code || ""}</strong></td>
      <td>${g.gear_name || ""}</td>
      <td style="text-align: right;">
        <button 
          onclick="editFishingGear('${g.id}')" 
          style="padding: 4px 8px; margin-right: 4px; background: var(--primary);"
        >
          <i class="fa-solid fa-pen"></i> Edit
        </button>
        <button 
          onclick="deleteFishingGear('${g.id}')" 
          style="padding: 4px 8px; background: #ef4444;"
        >
          <i class="fa-solid fa-trash"></i> Delete
        </button>
      </td>
    </tr>
  `,
    )
    .join("");

  table.innerHTML = `
    <thead>
      <tr>
        <th>Gear Code</th>
        <th>Gear Name</th>
        <th style="text-align: right;">Actions</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  `;
}

// --- 3. SAVE / UPDATE FISHING GEAR FORM ---
async function saveFishingGearForm() {
  const gearId = document.getElementById("editingGearId").value;
  const gear_code = document.getElementById("gearCodeInput").value.trim();
  const gear_name = document.getElementById("gearNameInput").value.trim();

  if (!gear_code || !gear_name) {
    showNotification("Gear Code and Gear Name are required.", "error");
    return;
  }

  const token =
    (typeof state !== "undefined" && state.token) ||
    localStorage.getItem("token") ||
    "";

  try {
    let res, url, method, payload;

    if (gearId) {
      url = `/api/fishing-gears/${gearId}`;
      method = "PATCH";
      payload = { gear_code, gear_name };
    } else {
      url = "/api/fishing-gears";
      method = "POST";
      payload = { gear_code, gear_name };
    }

    res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showNotification(`Failed: ${data.error || res.statusText}`, "error");
      return;
    }

    showNotification(
      `Fishing gear ${gearId ? "updated" : "created"} successfully!`,
      "success",
    );

    resetFishingGearForm();

    // Re-fetch clean list from backend
    await loadFishingGears();
  } catch (err) {
    console.error("Network Error:", err);
    showNotification("An unexpected network error occurred.", "error");
  }
}

// --- 4. PREPARE FORM FOR EDITING ---
function editFishingGear(id) {
  const gear = fishingGearsData.find((g) => String(g.id) === String(id));
  if (!gear) return;

  document.getElementById("editingGearId").value = gear.id;
  document.getElementById("gearCodeInput").value = gear.gear_code || "";
  document.getElementById("gearNameInput").value = gear.gear_name || "";

  document.getElementById("gearFormHeader").innerText = "EDIT FISHING GEAR";

  const submitBtn = document.getElementById("gearFormSubmitBtn");
  submitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Update Gear';

  document.getElementById("gearFormCancelBtn").style.display = "inline-block";
}

// --- 5. DELETE FISHING GEAR ---
function deleteFishingGear(id) {
  openConfirm(
    "Are you sure you want to delete this fishing gear? This action cannot be undone.",
    async () => {
      const token =
        (typeof state !== "undefined" && state.token) ||
        localStorage.getItem("token") ||
        "";

      try {
        const res = await fetch(`/api/fishing-gears/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          showNotification(
            `Failed to delete: ${data.error || res.statusText}`,
            "error",
          );
          return;
        }

        // Instant UI update: Remove item from local array immediately
        fishingGearsData = fishingGearsData.filter(
          (g) => String(g.id) !== String(id),
        );
        renderFishingGears(fishingGearsData);

        showNotification("Fishing gear deleted successfully!", "success");

        if (document.getElementById("editingGearId").value === String(id)) {
          resetFishingGearForm();
        }

        // Re-sync with backend data
        await loadFishingGears();
      } catch (err) {
        console.error("Delete Error:", err);
        showNotification(
          "An unexpected error occurred while deleting.",
          "error",
        );
      }
    },
    {
      title: "Delete Fishing Gear",
      confirmText: "Delete Gear",
      isDanger: true,
    },
  );
}

// --- 6. FILTER FISHING GEARS ---
function filterFishingGears() {
  const searchInput = document.getElementById("gearSearch");
  const q = searchInput ? searchInput.value.toLowerCase().trim() : "";

  if (!q) {
    renderFishingGears(fishingGearsData);
    return;
  }

  const filtered = fishingGearsData.filter(
    (g) =>
      (g.gear_code || "").toLowerCase().includes(q) ||
      (g.gear_name || "").toLowerCase().includes(q),
  );

  renderFishingGears(filtered);
}

// --- 7. RESET FORM BACK TO "ADD NEW" MODE ---
function resetFishingGearForm() {
  document.getElementById("editingGearId").value = "";
  document.getElementById("gearCodeInput").value = "";
  document.getElementById("gearNameInput").value = "";

  document.getElementById("gearFormHeader").innerText = "ADD NEW FISHING GEAR";

  const submitBtn = document.getElementById("gearFormSubmitBtn");
  submitBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Add Gear';

  document.getElementById("gearFormCancelBtn").style.display = "none";
}

function renderCatchesSummary(summary) {
  const ct = document.getElementById("catches");
  if (!ct) return;
  const arr = Array.isArray(summary) ? summary : [];
  ct.innerHTML =
    "<tr><th>Owner Name</th><th>Barangay</th><th>Latest Catch</th><th>Total Catches</th><th>Last Captured</th><th>Action</th></tr>";
  if (arr.length === 0) {
    ct.innerHTML +=
      '<tr><td colspan="6" style="text-align:center; padding: 24px; color: var(--text-muted);">No catches found.</td></tr>';
    return;
  }
  arr.forEach((s) => {
    const ownerName = s.ownerName || "—";
    const sub = [];
    if (s.vesselName) sub.push(s.vesselName);
    if (s.registrationNumber) sub.push("Reg #" + s.registrationNumber);
    if (sub.length === 0 && !s.vesselId) sub.push("Unassigned Vessel");
    const subtitle = sub.join(" · ");
    const vidParam = s.vesselId || "__unassigned__";
    ct.innerHTML += `<tr data-vid="${vidParam}"><td><a href="#" onclick="openCatchHistory(null, '${vidParam}'); return false;" style="font-weight:600; color:var(--primary)">${ownerName}</a>${subtitle ? `<div class="small">${subtitle}</div>` : ""}</td><td>${s.barangay || "—"}</td><td>${s.latestSpecies || "—"}</td><td>${s.totalCatches} catches</td><td>${s.latestCapturedAt ? new Date(s.latestCapturedAt).toLocaleString() : "—"}</td><td><button onclick="openCatchHistory(null, '${vidParam}')">View History</button></td></tr>`;
  });
}

function filterCatches() {
  const q = document.getElementById("catchSearch").value.toLowerCase().trim();
  if (!q) {
    renderCatchesSummary(state.catchesSummary);
    return;
  }
  const filtered = (
    Array.isArray(state.catchesSummary) ? state.catchesSummary : []
  ).filter(
    (s) =>
      (s.ownerName || "").toLowerCase().includes(q) ||
      (s.vesselName || "").toLowerCase().includes(q) ||
      (s.registrationNumber || "").toLowerCase().includes(q) ||
      (s.vesselId || "").toLowerCase().includes(q) ||
      (s.barangay || "").toLowerCase().includes(q) ||
      (s.latestSpecies || "").toLowerCase().includes(q),
  );
  renderCatchesSummary(filtered);
}

function toggleSelectAllUsers(checked) {
  const q = document.getElementById("trackSearch").value.toLowerCase().trim();
  let visibleSummary;
  if (!q) {
    visibleSummary = Array.isArray(state.tracksSummary)
      ? state.tracksSummary
      : [];
  } else {
    visibleSummary = (
      Array.isArray(state.tracksSummary) ? state.tracksSummary : []
    ).filter(
      (s) =>
        (s.userName || "").toLowerCase().includes(q) ||
        (s.userEmail || "").toLowerCase().includes(q) ||
        (s.userId || "").toLowerCase().includes(q),
    );
  }
  if (checked) {
    visibleSummary.forEach((s) => state.selectedUsers.add(s.userId));
  } else {
    visibleSummary.forEach((s) => state.selectedUsers.delete(s.userId));
  }
  document.querySelectorAll(".user-checkbox").forEach((cb) => {
    const uid = cb.getAttribute("data-user-id");
    cb.checked = state.selectedUsers.has(uid);
  });
  updateSelectedUserUi();
}

function toggleSingleUser(userId, checked) {
  if (checked) state.selectedUsers.add(userId);
  else state.selectedUsers.delete(userId);
  const q = document.getElementById("trackSearch").value.toLowerCase().trim();
  let visibleSummary;
  if (!q)
    visibleSummary = Array.isArray(state.tracksSummary)
      ? state.tracksSummary
      : [];
  else
    visibleSummary = (
      Array.isArray(state.tracksSummary) ? state.tracksSummary : []
    ).filter(
      (s) =>
        (s.userName || "").toLowerCase().includes(q) ||
        (s.userEmail || "").toLowerCase().includes(q) ||
        (s.userId || "").toLowerCase().includes(q),
    );
  const allChecked =
    visibleSummary.length > 0 &&
    visibleSummary.every((s) => state.selectedUsers.has(s.userId));
  const selectAll = document.getElementById("selectAllTracks");
  if (selectAll) selectAll.checked = allChecked;
  updateSelectedUserUi();
}

function updateSelectedUserUi() {
  const count = state.selectedUsers.size;
  const countEl = document.getElementById("selectedTrackCount");
  const btnEl = document.getElementById("bulkDeleteTracksBtn");
  const msgEl = document.getElementById("bulkDeleteMsg");
  if (countEl) countEl.textContent = count;
  if (btnEl) {
    btnEl.disabled = count === 0;
    btnEl.style.opacity = count === 0 ? "0.5" : "1";
    btnEl.style.cursor = count === 0 ? "not-allowed" : "pointer";
  }
  if (msgEl) {
    if (count === 0) {
      msgEl.textContent =
        "Please select at least one user to delete their GPS history.";
      msgEl.style.display = "";
    } else {
      msgEl.style.display = "none";
    }
  }
}

function confirmBulkDeleteTracks() {
  const count = state.selectedUsers.size;
  if (count === 0) return;
  const names = (state.tracksSummary || [])
    .filter((s) => state.selectedUsers.has(s.userId))
    .map((s) => s.userName || s.userId)
    .join(", ");
  openConfirm(
    `Are you sure you want to delete all GPS tracking history for:\n${names}?`,
    function () {
      bulkDeleteUserTracks();
    },
  );
}

async function bulkDeleteUserTracks() {
  const headers = { Authorization: "Bearer " + state.token };
  const userIds = Array.from(state.selectedUsers);
  const deletePromises = userIds.map((uid) =>
    fetch("/api/admin/tracks/user/" + encodeURIComponent(uid), {
      method: "DELETE",
      headers,
    }),
  );
  await Promise.all(deletePromises);
  state.selectedUsers.clear();
  loadData();
}

function filterTracks() {
  const q = document.getElementById("trackSearch").value.toLowerCase().trim();
  if (!q) {
    renderTracksSummary(state.tracksSummary);
    return;
  }
  const filtered = (
    Array.isArray(state.tracksSummary) ? state.tracksSummary : []
  ).filter(
    (s) =>
      (s.userName || "").toLowerCase().includes(q) ||
      (s.userEmail || "").toLowerCase().includes(q) ||
      (s.userId || "").toLowerCase().includes(q),
  );
  renderTracksSummary(filtered);
}

function startEditCatch(
  id,
  species,
  note,
  weight,
  length,
  netType,
  engine,
  vessel,
  hoursFished,
  numHooksPanels,
  numHauls,
) {
  const row = document.querySelector(`tr[data-id="${id}"]`);
  if (!row) return;
  const sp = row.querySelector(".sp");
  const wt = row.querySelector(".wt");
  const ln = row.querySelector(".ln");
  const nt = row.querySelector(".nt");
  const gr = row.querySelector(".gr");
  const hf = row.querySelector(".hf");
  const nhp = row.querySelector(".nhp");
  const nh = row.querySelector(".nh");
  const vs = row.querySelector(".vs");
  const act = row.querySelector(".act");

  const selId = `sp_${id}`;
  const noteId = `note_${id}`;
  const wtId = `wt_${id}`;
  const lnId = `ln_${id}`;
  const ntId = `nt_${id}`;
  const grId = `gr_${id}`;
  const hfId = `hf_${id}`;
  const nhpId = `nhp_${id}`;
  const nhId = `nh_${id}`;
  const vsId = `vs_${id}`;

  const opts =
    (state.species || [])
      .map((s) => `<option ${s === species ? "selected" : ""}>${s}</option>`)
      .join("") ||
    `<option ${species ? "selected" : ""}>${species || "unknown"}</option>`;

  sp.innerHTML = `<select id="${selId}" style="width:100%">${opts}</select><br/><input id="${noteId}" placeholder="Note" value="${note || ""}" style="margin-top:4px; width:100%"/>`;
  wt.innerHTML = `<input id="${wtId}" type="number" step="0.01" value="${weight || ""}" style="width:60px"/>`;
  ln.innerHTML = `<input id="${lnId}" type="number" step="0.1" value="${length || ""}" style="width:60px"/>`;
  if (nt)
    nt.innerHTML = `<input id="${ntId}" value="${netType || ""}" style="width:100%"/>`;
  if (gr)
    gr.innerHTML = `<input id="${grId}" value="${engine || ""}" style="width:100%"/>`;
  if (hf)
    hf.innerHTML = `<input id="${hfId}" type="number" step="0.1" min="0" value="${hoursFished != null ? hoursFished : ""}" style="width:60px"/>`;
  if (nhp)
    nhp.innerHTML = `<input id="${nhpId}" type="number" step="1" min="0" value="${numHooksPanels != null ? numHooksPanels : ""}" style="width:70px"/>`;
  if (nh)
    nh.innerHTML = `<input id="${nhId}" type="number" step="1" min="0" value="${numHauls != null ? numHauls : ""}" style="width:60px"/>`;
  vs.innerHTML = `<input id="${vsId}" value="${vessel || ""}" style="width:100%"/>`;

  act.innerHTML = `<button onclick="saveCatch('${id}','${selId}','${noteId}','${wtId}','${lnId}','${ntId}','${grId}','${vsId}','${hfId}','${nhpId}','${nhId}')">Save</button> <button onclick="if (state.currentCatchHistoryUserId || state.currentCatchHistoryVesselId) { loadCatchHistory() } else { loadData() }">Cancel</button>`;
}
async function saveCatch(
  id,
  selId,
  noteId,
  wtId,
  lnId,
  ntId,
  grId,
  vsId,
  hfId,
  nhpId,
  nhId,
) {
  const species = document.getElementById(selId).value;
  const note = document.getElementById(noteId).value;
  const weightKg = parseFloat(document.getElementById(wtId).value) || null;
  const lengthCm = parseFloat(document.getElementById(lnId).value) || null;
  const netType = document.getElementById(ntId)
    ? document.getElementById(ntId).value || null
    : null;
  const gear = document.getElementById(grId)
    ? document.getElementById(grId).value || null
    : null;
  const vessel = document.getElementById(vsId).value || null;
  const hfEl = document.getElementById(hfId);
  const nhpEl = document.getElementById(nhpId);
  const nhEl = document.getElementById(nhId);
  const hoursFished =
    hfEl && hfEl.value !== ""
      ? isFinite(parseFloat(hfEl.value))
        ? parseFloat(hfEl.value)
        : null
      : null;
  const numHooksPanels =
    nhpEl && nhpEl.value !== ""
      ? isFinite(parseInt(nhpEl.value))
        ? parseInt(nhpEl.value)
        : null
      : null;
  const numHauls =
    nhEl && nhEl.value !== ""
      ? isFinite(parseInt(nhEl.value))
        ? parseInt(nhEl.value)
        : null
      : null;

  await fetch("/api/admin/catches/" + id, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + state.token,
    },
    body: JSON.stringify({
      species,
      note,
      weightKg,
      lengthCm,
      netType,
      gear,
      vessel,
      hoursFished,
      numHooksPanels,
      numHauls,
    }),
  });
  if (state.currentCatchHistoryUserId || state.currentCatchHistoryVesselId) {
    loadCatchHistory();
  } else {
    loadData();
  }
}
async function deleteCatch(id) {
  if (!confirm("Delete this catch?")) return;
  await fetch("/api/admin/catches/" + id, {
    method: "DELETE",
    headers: { Authorization: "Bearer " + state.token },
  });
  if (state.currentCatchHistoryUserId || state.currentCatchHistoryVesselId) {
    loadCatchHistory();
  } else {
    document.getElementById("catchSearch").value = "";
    loadData();
  }
}
async function addZone() {
  try {
    const id = state.editingZoneId;
    const name = document.getElementById("zoneName").value || "New Zone";
    const zoneEl = document.getElementById("zoneJson");
    const rulesEl = document.getElementById("zoneRules");
    const raw = (zoneEl && zoneEl.value ? zoneEl.value : "").trim();
    const rulesText = (rulesEl && rulesEl.value ? rulesEl.value : "").trim();
    if (!raw) {
      if (zoneEl) zoneEl.focus();
      throw new Error("GeoJSON is required");
    }
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      if (zoneEl) zoneEl.focus();
      throw new Error("Invalid GeoJSON JSON");
    }
    let geometry = null;
    if (parsed && parsed.type === "Feature" && parsed.geometry) {
      geometry = parsed.geometry;
    } else if (
      parsed &&
      (parsed.type === "Polygon" || parsed.type === "MultiPolygon")
    ) {
      geometry = parsed;
    } else {
      throw new Error("Invalid GeoJSON: provide Feature or Polygon");
    }
    let rules = null;
    if (rulesText) {
      try {
        rules = JSON.parse(rulesText);
      } catch {
        if (rulesEl) rulesEl.focus();
        throw new Error("Invalid Rules JSON");
      }
    }

    const headers = {
      "Content-Type": "application/json",
      Authorization: "Bearer " + state.token,
    };
    const body = JSON.stringify({ name, geom: geometry, rules });

    if (id) {
      await fetch("/api/admin/protected_areas/" + id, {
        method: "PATCH",
        headers,
        body,
      });
    } else {
      await fetch("/api/admin/protected_areas", {
        method: "POST",
        headers,
        body,
      });
    }

    cancelEditZone();
    loadData();
  } catch (e) {
    alert(e.message || "Invalid JSON");
  }
}

function editZone(id) {
  const z = state.zones.find((x) => x.id === id);
  if (!z) return;
  state.editingZoneId = id;
  document.getElementById("zoneName").value = z.name || "";
  document.getElementById("zoneJson").value = JSON.stringify(z.geom, null, 2);
  document.getElementById("zoneRules").value = z.rules
    ? JSON.stringify(z.rules, null, 2)
    : "";

  document.getElementById("btn_save_zone").innerHTML =
    '<i class="fa-solid fa-save"></i> Update Zone';
  document.getElementById("btn_cancel_edit_zone").style.display = "block";

  const coll = document.querySelector(".collapsible");
  if (coll) coll.classList.add("open");

  zoomToZone(id);
}

function cancelEditZone() {
  state.editingZoneId = null;
  document.getElementById("zoneName").value = "";
  document.getElementById("zoneJson").value = "";
  document.getElementById("zoneRules").value = "";

  document.getElementById("btn_save_zone").innerHTML =
    '<i class="fa-solid fa-plus"></i> Save Zone';
  document.getElementById("btn_cancel_edit_zone").style.display = "none";

  const coll = document.querySelector(".collapsible");
  if (coll) coll.classList.remove("open");

  if (state.zoneMap && state.zoneMap.drawLayer) {
    state.zoneMap.drawLayer.remove();
    state.zoneMap.drawLayer = null;
  }
}

async function loadActivity() {
  const t = document.getElementById("actFilterType").value;
  const from = document.getElementById("actFrom").value;
  const to = document.getElementById("actTo").value;
  const headers = { Authorization: "Bearer " + state.token };
  const url = `/api/activity_logs?${t ? "type=" + encodeURIComponent(t) + "&" : ""}${from ? "from=" + encodeURIComponent(from) + "&" : ""}${to ? "to=" + encodeURIComponent(to) : ""}`;
  const r = await fetch(url, { headers });
  const logsRaw = await r.json();
  const logs = Array.isArray(logsRaw) ? logsRaw : [];
  const tbl = document.getElementById("activityLogs");
  tbl.innerHTML =
    "<tr><th>Category</th><th>Activity</th><th>User</th><th>Location</th><th>Time</th><th>Photo</th><th>Action</th></tr>";
  logs.forEach((a) => {
    const cat = a.category || TYPE_TO_CAT[a.type] || "";
    const label = TYPE_LABEL[a.type] || a.type;
    const u = (Array.isArray(state.users) ? state.users : []).find(
      (x) => x.id === a.user_id,
    );
    const uname = u ? u.name : a.user_id;
    const thumb = a.photoUrl
      ? `<a target="_blank" href="${a.photoUrl}"><img src="${a.photoUrl}" style="height:40px;border-radius:4px"/></a>`
      : "";
    const lat =
      a.location && typeof a.location.lat === "number" ? a.location.lat : 0;
    const lng =
      a.location && typeof a.location.lng === "number" ? a.location.lng : 0;
    const hasLoc =
      a.location &&
      typeof a.location.lat === "number" &&
      typeof a.location.lng === "number";
    const locLink = hasLoc
      ? `<a target="_blank" href="https://maps.google.com/?q=${lat},${lng}">${lat.toFixed(5)}, ${lng.toFixed(5)}</a>`
      : "—";
    tbl.innerHTML += `<tr><td>${cat}</td><td>${label}</td><td>${uname}</td><td>${locLink}</td><td>${new Date(a.created_at || 0).toLocaleString()}</td><td>${thumb}</td><td><button onclick="deleteActivity('${a.id}')">Delete</button></td></tr>`;
  });
  markModuleRead("mod_activity");
}

async function deleteActivity(id) {
  const headers = { Authorization: "Bearer " + state.token };
  await fetch("/api/activity_logs/" + id, { method: "DELETE", headers });
  loadActivity();
}

async function loadInsights() {
  const headers = { Authorization: "Bearer " + state.token };
  const r = await fetch("/api/admin/activity_insights", { headers });
  const d = await r.json();
  alert(
    `Illegal in protected: ${d.illegal_in_protected}\nApproaches: ${d.approaches_last7}\nPatrol km: ${d.patrol_km}`,
  );
}
const ACTIVITY_OPTIONS = {
  fishing: [
    {
      value: "catching_fish",
      label: "Catching fish using nets, traps, or hand lines",
    },
    {
      value: "unloading_catch",
      label: "Unloading fish catch at the shore",
    },
    {
      value: "boat_launching_docking",
      label: "Boat launching and docking",
    },
  ],
  environmental: [
    { value: "mangrove_planting", label: "Mangrove planting" },
    { value: "coastal_cleanup", label: "Coastal clean-up" },
    {
      value: "monitoring_water_quality",
      label: "Monitoring water quality",
    },
    {
      value: "checking_coral_reef",
      label: "Checking coral reef conditions",
    },
  ],
  tourism: [
    { value: "swimming_snorkeling", label: "Swimming and snorkeling" },
    { value: "scuba_diving", label: "Scuba diving" },
    { value: "boating_kayaking", label: "Boating or kayaking" },
    { value: "beach_events", label: "Beach events" },
  ],
  maritime: [
    {
      value: "cargo_unloading",
      label: "Cargo unloading near small ports",
    },
    {
      value: "movement_of_fishing_vessels",
      label: "Movement of fishing vessels",
    },
    {
      value: "transporting_goods_small_boats",
      label: "Transporting goods using small boats",
    },
  ],
  illegal: [
    {
      value: "illegal_fishing",
      label: "Illegal fishing (dynamite, cyanide)",
    },
    {
      value: "unauthorized_structures",
      label: "Unauthorized structures along the coastline",
    },
    { value: "illegal_dumping", label: "Illegal dumping of waste" },
  ],
};
const TYPE_TO_CAT = Object.fromEntries(
  Object.entries(ACTIVITY_OPTIONS).flatMap(([k, v]) =>
    v.map((o) => [o.value, k]),
  ),
);
const TYPE_LABEL = Object.fromEntries(
  Object.values(ACTIVITY_OPTIONS).flatMap((v) =>
    v.map((o) => [o.value, o.label]),
  ),
);
const CAT_COLORS = {
  fishing: "#1A73E8",
  environmental: "#34A853",
  tourism: "#FBBC04",
  maritime: "#A142F4",
  illegal: "#EA4335",
};
function populateActivityFilter() {
  const cat = document.getElementById("actFilterCat").value;
  const sel = document.getElementById("actFilterType");
  sel.innerHTML = "";
  const def = document.createElement("option");
  def.value = "";
  def.textContent = "All activities";
  sel.appendChild(def);
  const list = cat
    ? ACTIVITY_OPTIONS[cat]
    : Object.values(ACTIVITY_OPTIONS).flat();
  list.forEach((o) => {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  });
}
document
  .getElementById("actFilterCat")
  .addEventListener("change", populateActivityFilter);
populateActivityFilter();

async function delZone(id) {
  const headers = { Authorization: "Bearer " + state.token };
  await fetch("/api/admin/protected_areas/" + id, {
    method: "DELETE",
    headers,
  });
  loadData();
}
async function downloadExcel() {
  if (!window.XLSX) {
    alert("Excel library not loaded");
    return;
  }
  const headers = { Authorization: "Bearer " + state.token };
  const r = await fetch("/api/catches", { headers });
  const d = await r.json();
  const rows = d.map((c) => ({
    Species: c.species || "",
    NetType: c.netType || "",
    WeightKg: c.weightKg || null,
    LengthCm: c.lengthCm || null,
    Engine: c.gear || "",
    Vessel: c.vessel || "",
    Latitude: c.lat,
    Longitude: c.lng,
    CapturedAt: c.capturedAt,
    UserName: c.user ? c.user.name : "",
    UserEmail: c.user ? c.user.email : "",
  }));
  const wb = window.XLSX.utils.book_new();
  const ws = window.XLSX.utils.json_to_sheet(rows);
  window.XLSX.utils.book_append_sheet(wb, ws, "Catches");
  window.XLSX.writeFile(wb, "catches.xlsx");
}

function normalizeTrackPoint(p) {
  const userId = p && p.userId != null ? String(p.userId) : null;
  const lat = p && p.lat != null ? Number(p.lat) : NaN;
  const lng = p && p.lng != null ? Number(p.lng) : NaN;
  if (!userId || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const recordedAt = p.recordedAt
    ? String(p.recordedAt)
    : new Date().toISOString();
  const accuracy =
    p.accuracy != null && p.accuracy !== "" ? Number(p.accuracy) : null;
  const speed = p.speed != null && p.speed !== "" ? Number(p.speed) : null;
  const heading =
    p.heading != null && p.heading !== "" ? Number(p.heading) : null;
  const active = p && p.active === false ? false : true;
  const lastSeenAt = p && p.lastSeenAt ? String(p.lastSeenAt) : null;
  const status = p && p.status != null ? String(p.status) : null;
  const statusAt = p && p.statusAt != null ? String(p.statusAt) : null;
  return {
    userId,
    lat,
    lng,
    recordedAt,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
    speed: Number.isFinite(speed) ? speed : null,
    heading: Number.isFinite(heading) ? heading : null,
    active,
    lastSeenAt,
    status,
    statusAt,
    user: p.user || null,
  };
}
function normalizeStatusEvent(p) {
  const userId = p && p.userId != null ? String(p.userId) : null;
  const status = p && p.status != null ? String(p.status) : null;
  const at =
    p && (p.at || p.recordedAt)
      ? String(p.at || p.recordedAt)
      : new Date().toISOString();
  const lat = p && p.lat != null ? Number(p.lat) : NaN;
  const lng = p && p.lng != null ? Number(p.lng) : NaN;
  if (!userId || !status) return null;
  return {
    userId,
    status,
    at,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  };
}
function applyStatusEvent(p) {
  const ev = normalizeStatusEvent(p);
  if (!ev) return;
  if (!state.latestLocations) state.latestLocations = new Map();
  const cur = state.latestLocations.get(ev.userId) || null;
  const lat = ev.lat != null ? ev.lat : cur ? cur.lat : null;
  const lng = ev.lng != null ? ev.lng : cur ? cur.lng : null;
  if (lat == null || lng == null) {
    state.latestLocations.set(ev.userId, {
      ...(cur || {}),
      userId: ev.userId,
      status: ev.status,
      statusAt: ev.at,
    });
    return;
  }
  const active = ev.status === "port" ? false : true;
  const np = normalizeTrackPoint({
    ...(cur || {}),
    userId: ev.userId,
    lat,
    lng,
    active,
    status: ev.status,
    statusAt: ev.at,
    recordedAt: cur && cur.recordedAt ? cur.recordedAt : ev.at,
    lastSeenAt: ev.at,
  });
  if (!np) return;
  np.user = cur && cur.user ? cur.user : p && p.user ? p.user : null;
  state.latestLocations.set(np.userId, np);
  upsertUserMarker(np);
}
function getUserLabel(userId, payloadUser) {
  if (payloadUser && payloadUser.name) return payloadUser.name;
  const u = (state.users || []).find((x) => x.id === userId);
  if (u && u.name) return u.name;
  return userId;
}
function setUserMapStatus(text) {
  const el = document.getElementById("user_map_status");
  if (el) el.textContent = text || "";
}
function initUserMap() {
  if (!state.token) return;
  const el = document.getElementById("user_map");
  if (!el) return;
  if (!window.L) {
    setUserMapStatus("Map library failed to load");
    return;
  }

  if (!state.userMap) {
    const map = window.L.map(el, { zoomControl: true });
    window.L.tileLayer("/api/public/tiles/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    map.setView([12.5, 122.0], 5);
    state.userMap = {
      map,
      markersByUserId: new Map(),
      circlesByUserId: new Map(),
      routesByUserId: new Map(),
      routePtsByUserId: new Map(),
      routeLastKeyByUserId: new Map(),
      lastFitAt: 0,
    };
  }

  try {
    state.userMap.map.invalidateSize();
  } catch {}
  refreshUserMap();
}
async function refreshUserMap(forceFit) {
  if (!state.token) return;
  if (!state.latestLocations) state.latestLocations = new Map();
  setUserMapStatus("Loading locations...");
  try {
    const headers = { Authorization: "Bearer " + state.token };
    const r = await fetch("/api/admin/live_locations", { headers });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Failed to load locations");
    const seenUserIds = new Set();
    const activeUserIds = new Set();
    (Array.isArray(d) ? d : []).forEach((p) => {
      const np = normalizeTrackPoint(p);
      if (!np) return;
      np.user = p.user || null;
      seenUserIds.add(np.userId);
      const isActive = np.active !== false;
      if (isActive) {
        activeUserIds.add(np.userId);
        state.latestLocations.set(np.userId, np);
        upsertUserMarker(np);
      }
    });
    // Remove markers that are no longer active, or not in seen list
    Array.from(state.latestLocations.keys()).forEach((uid) => {
      if (!activeUserIds.has(uid)) {
        removeUserMarker(uid);
      }
    });
    const vals = state.latestLocations
      ? Array.from(state.latestLocations.values())
      : [];
    let activeCount = 0;
    vals.forEach((x) => {
      if (!x) return;
      if (x.active !== false) activeCount++;
    });
    setUserMapStatus(`${activeCount} active`);
    if (forceFit) fitUserMap();
    else maybeAutoFitUserMap();
  } catch (e) {
    setUserMapStatus(e.message || "Failed to load locations");
  }
}
function removeUserMarker(userId) {
  if (!userId) return;
  if (state.latestLocations) state.latestLocations.delete(userId);
  if (!state.userMap) return;
  const {
    markersByUserId,
    circlesByUserId,
    routesByUserId,
    routePtsByUserId,
    routeLastKeyByUserId,
  } = state.userMap;
  const marker = markersByUserId.get(userId);
  if (marker) {
    try {
      marker.remove();
    } catch {}
    markersByUserId.delete(userId);
  }
  const circle = circlesByUserId.get(userId);
  if (circle) {
    try {
      circle.remove();
    } catch {}
    circlesByUserId.delete(userId);
  }
  const route = routesByUserId.get(userId);
  if (route) {
    try {
      route.remove();
    } catch {}
    routesByUserId.delete(userId);
  }
  routePtsByUserId.delete(userId);
  routeLastKeyByUserId.delete(userId);
}
function markUserInactive(userId) {
  removeUserMarker(userId);
}
function upsertUserMarker(p) {
  if (!p) return;
  const isActive = p.active !== false;

  // Skip if not active (remove marker if exists)
  if (!isActive) {
    removeUserMarker(p.userId);
    return;
  }

  if (!state.latestLocations) state.latestLocations = new Map();
  state.latestLocations.set(p.userId, p);

  if (!state.userMap) return;
  const {
    map,
    markersByUserId,
    circlesByUserId,
    routesByUserId,
    routePtsByUserId,
    routeLastKeyByUserId,
  } = state.userMap;
  const label = getUserLabel(p.userId, p.user);
  const when = p.recordedAt ? new Date(p.recordedAt) : null;
  const subtitle = when ? when.toLocaleString() : "";

  const statusText = "Active";
  const statusAt = p.statusAt ? new Date(p.statusAt) : null;
  const statusLine = statusAt
    ? `${statusText} • ${statusAt.toLocaleString()}`
    : statusText;
  // Green for active
  const markerColor = "#34c759";
  const markerOpacity = 1;
  const fillOpacity = 0.9;

  let marker = markersByUserId.get(p.userId);
  if (!marker) {
    marker = window.L.circleMarker([p.lat, p.lng], {
      radius: 7,
      color: markerColor,
      weight: 2,
      opacity: markerOpacity,
      fillColor: markerColor,
      fillOpacity,
    });
    marker.addTo(map);
    markersByUserId.set(p.userId, marker);
  } else {
    marker.setLatLng([p.lat, p.lng]);
    if (marker.setStyle) {
      try {
        marker.setStyle({
          color: markerColor,
          fillColor: markerColor,
          opacity: markerOpacity,
          fillOpacity,
          radius: 7,
        });
      } catch {}
    }
  }

  // Get vessel info from state or from the point payload
  const userVessels = state.vessels || [];
  let vesselInfo = null;
  if (p.vesselId) {
    vesselInfo = userVessels.find((v) => v.id === p.vesselId);
  }
  if (!vesselInfo && p.vesselRegistrationNumber) {
    vesselInfo = userVessels.find(
      (v) => v.vessel_registration_number === p.vesselRegistrationNumber,
    );
  }

  // Build popup content
  let popupContent = `<div style="font-size:14px; font-weight:bold; margin-bottom:4px">Inspector Details</div>`;
  if (p.user) {
    if (p.user.name)
      popupContent += `<div style="font-size:13px"><b>Name:</b> ${p.user.name}</div>`;
    if (p.user.email)
      popupContent += `<div style="font-size:13px"><b>Email:</b> ${p.user.email}</div>`;
    if (p.user.role)
      popupContent += `<div style="font-size:13px"><b>Role:</b> ${p.user.role}</div>`;
    if (p.user.barangay)
      popupContent += `<div style="font-size:13px"><b>Inspector Barangay:</b> ${p.user.barangay}</div>`;
  }
  popupContent += `<div style="margin-top:8px; font-size:14px; font-weight:bold">Tracking Details</div>`;
  popupContent += `<div style="font-size:13px"><b>Status:</b> ${statusLine}</div>`;
  popupContent += `<div style="font-size:13px"><b>Time:</b> ${subtitle}</div>`;
  popupContent += `<div style="font-size:13px"><b>Location:</b> ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</div>`;
  if (vesselInfo) {
    popupContent += `<div style="margin-top:8px; font-size:14px; font-weight:bold">Vessel Details</div>`;
    if (vesselInfo.vessel_name)
      popupContent += `<div style="font-size:13px"><b>Vessel:</b> ${vesselInfo.vessel_name}</div>`;
    if (vesselInfo.owner_name)
      popupContent += `<div style="font-size:13px"><b>Owner:</b> ${vesselInfo.owner_name}</div>`;
    if (vesselInfo.barangay)
      popupContent += `<div style="font-size:13px"><b>Barangay:</b> ${vesselInfo.barangay}</div>`;
  } else if (p.vesselName || p.ownerName || p.barangay) {
    popupContent += `<div style="margin-top:8px; font-size:14px; font-weight:bold">Vessel Details</div>`;
    if (p.vesselName)
      popupContent += `<div style="font-size:13px"><b>Vessel:</b> ${p.vesselName}</div>`;
    if (p.ownerName)
      popupContent += `<div style="font-size:13px"><b>Owner:</b> ${p.ownerName}</div>`;
    if (p.barangay)
      popupContent += `<div style="font-size:13px"><b>Barangay:</b> ${p.barangay}</div>`;
  }
  popupContent += `<div style="margin-top:8px"><button onclick="openUserHistory('${p.userId}')" style="width:auto;height:auto;padding:6px 10px">View History</button></div>`;

  if (marker) {
    marker.bindPopup(popupContent);
  }

  if (
    (p.status === "transit" || isActive) &&
    p.accuracy != null &&
    Number.isFinite(p.accuracy) &&
    p.accuracy > 0
  ) {
    let circle = circlesByUserId.get(p.userId);
    if (!circle) {
      circle = window.L.circle([p.lat, p.lng], {
        radius: p.accuracy,
        weight: 1,
        opacity: 0.5,
        fillOpacity: 0.08,
      });
      circle.addTo(map);
      circlesByUserId.set(p.userId, circle);
    } else {
      circle.setLatLng([p.lat, p.lng]);
      circle.setRadius(p.accuracy);
    }
  } else {
    const circle = circlesByUserId.get(p.userId);
    if (circle) {
      try {
        circle.remove();
      } catch {}
      circlesByUserId.delete(p.userId);
    }
  }

  if (p.status === "transit") {
    let route = routesByUserId.get(p.userId);
    if (!route) {
      route = window.L.polyline([], {
        color: "#34c759",
        weight: 3,
        opacity: 0.85,
      });
      route.addTo(map);
      routesByUserId.set(p.userId, route);
      routePtsByUserId.set(p.userId, []);
    }
    const key = p.recordedAt || p.lastSeenAt || "";
    const lastKey = routeLastKeyByUserId.get(p.userId);
    if (key && key !== lastKey) {
      const pts = routePtsByUserId.get(p.userId) || [];
      pts.push([p.lat, p.lng]);
      if (pts.length > 300) pts.shift();
      routePtsByUserId.set(p.userId, pts);
      try {
        route.setLatLngs(pts);
      } catch {}
      routeLastKeyByUserId.set(p.userId, key);
    }
  } else {
    const route = routesByUserId.get(p.userId);
    if (route) {
      try {
        route.remove();
      } catch {}
      routesByUserId.delete(p.userId);
    }
    routePtsByUserId.delete(p.userId);
    routeLastKeyByUserId.delete(p.userId);
  }
}
function fitUserMap() {
  if (!state.userMap) return;
  if (!state.latestLocations || state.latestLocations.size === 0) return;
  const pts = Array.from(state.latestLocations.values()).map((p) => [
    p.lat,
    p.lng,
  ]);
  try {
    const bounds = window.L.latLngBounds(pts);
    state.userMap.map.fitBounds(bounds.pad(0.2), { animate: false });
    state.userMap.lastFitAt = Date.now();
  } catch {}
}
function maybeAutoFitUserMap() {
  if (!state.userMap) return;
  if (!state.latestLocations || state.latestLocations.size === 0) return;
  const now = Date.now();
  if (!state.userMap.lastFitAt || now - state.userMap.lastFitAt > 60000)
    fitUserMap();
}

function initZoneMap() {
  if (!state.token) return;
  const el = document.getElementById("zone_map");
  if (!el) return;
  if (!window.L) return;

  if (!state.zoneMap) {
    const map = window.L.map(el, { zoomControl: true });
    window.L.tileLayer("/api/public/tiles/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    map.setView([18.256, 122.202], 12);
    state.zoneMap = {
      map,
      drawLayer: null,
      drawPoints: [],
      zonesLayer: window.L.layerGroup().addTo(map),
      isDrawing: false,
    };

    map.on("click", (e) => {
      if (!state.zoneMap.isDrawing) return;
      const pt = [e.latlng.lat, e.latlng.lng];
      state.zoneMap.drawPoints.push(pt);
      updateDrawnPolygon();
    });

    map.on("dblclick", (e) => {
      if (!state.zoneMap.isDrawing) return;
      finishDrawingZone();
    });
  }

  try {
    state.zoneMap.map.invalidateSize();
  } catch {}
  renderZonesOnMap();
}

function startDrawingZone() {
  if (!state.zoneMap) return;
  state.zoneMap.isDrawing = true;
  state.zoneMap.drawPoints = [];
  if (state.zoneMap.drawLayer) {
    state.zoneMap.drawLayer.remove();
    state.zoneMap.drawLayer = null;
  }
  document.getElementById("btn_draw_start").textContent =
    "Drawing... (Double-click to finish)";
  document.getElementById("btn_draw_start").disabled = true;
  state.zoneMap.map.getContainer().style.cursor = "crosshair";
  state.zoneMap.map.doubleClickZoom.disable();
}

function updateDrawnPolygon() {
  const pts = state.zoneMap.drawPoints;
  if (pts.length < 2) return;
  if (state.zoneMap.drawLayer) {
    state.zoneMap.drawLayer.remove();
  }
  state.zoneMap.drawLayer = window.L.polygon(pts, {
    color: "#007aff",
    weight: 3,
    dashArray: "5, 5",
  }).addTo(state.zoneMap.map);
}

function finishDrawingZone() {
  const pts = state.zoneMap.drawPoints;
  if (pts.length < 3) {
    alert("Need at least 3 points for a polygon");
    clearDrawnZone();
    return;
  }

  // Close polygon
  const first = pts[0];
  pts.push([first[0], first[1]]);

  const geojson = {
    type: "Polygon",
    coordinates: [pts.map((p) => [p[1], p[0]])], // Leaflet is [lat,lng], GeoJSON is [lng,lat]
  };

  document.getElementById("zoneJson").value = JSON.stringify(geojson, null, 2);
  const coll = document.querySelector(".collapsible");
  if (coll) coll.classList.add("open");

  state.zoneMap.isDrawing = false;
  state.zoneMap.map.getContainer().style.cursor = "";
  state.zoneMap.map.doubleClickZoom.enable();
  document.getElementById("btn_draw_start").textContent = "Start Drawing";
  document.getElementById("btn_draw_start").disabled = false;

  if (state.zoneMap.drawLayer) {
    state.zoneMap.drawLayer.setStyle({
      dashArray: null,
      fillOpacity: 0.2,
    });
  }
}

function clearDrawnZone() {
  if (!state.zoneMap) return;
  state.zoneMap.isDrawing = false;
  state.zoneMap.drawPoints = [];
  if (state.zoneMap.drawLayer) {
    state.zoneMap.drawLayer.remove();
    state.zoneMap.drawLayer = null;
  }
  document.getElementById("zoneJson").value = "";
  document.getElementById("btn_draw_start").textContent = "Start Drawing";
  document.getElementById("btn_draw_start").disabled = false;
  state.zoneMap.map.getContainer().style.cursor = "";
  state.zoneMap.map.doubleClickZoom.enable();
}

function renderZonesOnMap() {
  if (!state.zoneMap || !state.zones) return;
  state.zoneMap.zonesLayer.clearLayers();

  state.zones.forEach((z) => {
    if (!z.geom) return;
    const poly = window.L.geoJSON(z.geom, {
      style: { color: "#ff3b30", weight: 2, fillOpacity: 0.15 },
    });
    poly.bindPopup(
      `<b>${z.name || "Unnamed Zone"}</b><br/><button onclick="delZone('${z.id}')" style="margin-top:8px">Delete</button>`,
    );
    poly.addTo(state.zoneMap.zonesLayer);
  });
}

function updateZoneListUi() {
  const container = document.getElementById("zoneListContainer");
  if (!container) return;
  container.innerHTML = "";

  if (!state.zones || state.zones.length === 0) {
    container.innerHTML =
      '<div class="small" style="grid-column: 1/-1; text-align: center; padding: 24px; background: var(--background); border-radius: 12px">No protected zones defined yet.</div>';
    return;
  }

  state.zones.forEach((z) => {
    const card = document.createElement("div");
    card.className = "card";
    card.style.margin = "0";
    card.style.padding = "16px";

    card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:8px">
              <h4 style="margin:0; font-size:15px">${z.name || "Unnamed Zone"}</h4>
              <button onclick="delZone('${z.id}')" style="background:transparent; color:var(--error); border:1px solid var(--error); padding:4px 8px; font-size:11px; height:auto; width:auto; border-radius:12px">Delete</button>
            </div>
            <div class="small" style="color:var(--text-muted); font-size:11px; margin-bottom:8px">ID: ${z.id}</div>
            <div style="display:flex; gap:8px">
              <button onclick="zoomToZone('${z.id}')" style="flex:1; height:auto; padding:6px; font-size:12px; background:var(--background); color:var(--primary); border:1px solid var(--primary); box-shadow:none"><i class="fa-solid fa-search-plus"></i> View</button>
              <button onclick="editZone('${z.id}')" style="flex:1; height:auto; padding:6px; font-size:12px; background:var(--background); color:var(--primary); border:1px solid var(--primary); box-shadow:none"><i class="fa-solid fa-edit"></i> Edit</button>
            </div>
          `;
    container.appendChild(card);
  });
}

function zoomToZone(id) {
  if (!state.zoneMap || !state.zones) return;
  const z = state.zones.find((x) => x.id === id);
  if (!z || !z.geom) return;

  const layer = window.L.geoJSON(z.geom);
  state.zoneMap.map.fitBounds(layer.getBounds().pad(0.2));
  showAdminModule("mod_zones");
}

function ensureLive(force) {
  if (window._authInvalidated) return;
  if (window._liveES && !force) {
    if (window._liveES.readyState !== 2) return;
    window._liveES.close();
  }
  if (window._liveES) {
    window._liveES.close();
    window._liveES = null;
  }
  if (!state.token) return;

  window._liveRetryAttempts = window._liveRetryAttempts || 0;
  if (window._liveRetryTimer) {
    clearTimeout(window._liveRetryTimer);
    window._liveRetryTimer = null;
  }

  window._liveES = new EventSource(
    "/api/admin/live?token=" + encodeURIComponent(state.token),
  );

  let closedByAuth = false;

  window._liveES.onopen = () => {
    window._liveRetryAttempts = 0;
  };

  window._liveES.onerror = function (e) {
    if (closedByAuth) return;
    try {
      if (
        window._liveES &&
        (window._liveES.readyState === 2 || window._liveES.readyState === 0)
      ) {
        closedByAuth = true;
        if (window._liveES) {
          window._liveES.close();
          window._liveES = null;
        }
        if (window._liveRetryAttempts === 0) {
          fetch("/api/admin/users", {
            headers: { Authorization: "Bearer " + state.token },
          })
            .then((r) => {
              if (r.status === 401) handleAuthFailure();
              else scheduleLiveRetry();
            })
            .catch(() => scheduleLiveRetry());
        } else {
          scheduleLiveRetry();
        }
        return;
      }
    } catch {}
    if (window._liveES) {
      try {
        window._liveES.close();
      } catch {}
      window._liveES = null;
    }
    scheduleLiveRetry();
  };

  function scheduleLiveRetry() {
    window._liveRetryAttempts = (window._liveRetryAttempts || 0) + 1;
    const base = Math.min(window._liveRetryAttempts, 8);
    const delay = 5000 * base;
    if (window._liveRetryTimer) clearTimeout(window._liveRetryTimer);
    window._liveRetryTimer = setTimeout(() => {
      window._liveRetryTimer = null;
      if (!window._authInvalidated) ensureLive();
    }, delay);
  }

  window._liveES.onmessage = (ev) => {
    try {
      const p = JSON.parse(ev.data);
      if (p && p.type === "catch") {
        registerLiveEvent("catch", p.item || p);
        addCatchRow(p.item);
      } else if (p && p.type === "alert") {
        registerLiveEvent("alert", p.item || p);
        addAlertRow(p.item);
        playNotificationSound();
      } else if (p && p.type === "status" && p.userId != null) {
        registerLiveEvent("status", p);
        applyStatusEvent(p);
        if (state.currentModule === "mod_map") {
          const n = state.latestLocations
            ? Array.from(state.latestLocations.values()).filter(
                (x) => x && x.active !== false,
              ).length
            : 0;
          setUserMapStatus(`${n} active user(s)`);
        }
      } else if (p && p.type === "track") {
        registerLiveEvent("track", p);
        addTrackPointToMap(p);
      } else if (p && p.type === "track_stop" && p.userId != null) {
        registerLiveEvent("track_stop", p);
        const uid = String(p.userId);
        const np = normalizeTrackPoint({
          ...p,
          active: false,
          recordedAt: p.at || p.recordedAt,
        });
        if (np) {
          np.active = false;
          if (!state.latestLocations) state.latestLocations = new Map();
          state.latestLocations.set(np.userId, np);
          upsertUserMarker(np);
        } else {
          markUserInactive(uid);
        }
        if (state.currentModule === "mod_map") {
          const n = state.latestLocations
            ? Array.from(state.latestLocations.values()).filter(
                (x) => x && x.active !== false,
              ).length
            : 0;
          setUserMapStatus(`${n} active user(s)`);
        }
      } else {
        const np = normalizeTrackPoint(p);
        if (np) {
          registerLiveEvent("track", np);
          if (!state.latestLocations) state.latestLocations = new Map();
          state.latestLocations.set(np.userId, np);
          upsertUserMarker(np);
          if (state.currentModule === "mod_map") {
            const n = state.latestLocations
              ? Array.from(state.latestLocations.values()).filter(
                  (x) => x && x.active !== false,
                ).length
              : 0;
            setUserMapStatus(`${n} active user(s)`);
          }
        }
      }
      if (state.currentModule === "mod_live") markModuleRead("mod_live");
    } catch {}
  };
}
function addCatchRow(c) {
  const ct = document.getElementById("catches");
  if (!ct || !ct.innerHTML) return;
  const isSummaryView =
    ct.querySelector("th") &&
    ct.querySelector("th").textContent.includes("Latest Catch");
  if (isSummaryView) {
    if (!state.catches) state.catches = [];
    if (!state.catches.some((x) => x.id === c.id)) state.catches.unshift(c);
    if (!state.catchesSummary) state.catchesSummary = [];
    const vess = (Array.isArray(state.vessels) ? state.vessels : []).find(
      (v) =>
        (c.vesselId && v.id === c.vesselId) ||
        (c.vesselRegistrationNumber &&
          v.vessel_registration_number &&
          String(v.vessel_registration_number).trim().toLowerCase() ===
            String(c.vesselRegistrationNumber).trim().toLowerCase()) ||
        (c.vesselName &&
          v.vessel_name &&
          String(v.vessel_name).trim().toLowerCase() ===
            String(c.vesselName).trim().toLowerCase()),
    );
    const cOwnerName = c.ownerName || (vess && vess.owner_name) || null;
    const cVesselId = c.vesselId || (vess && vess.id) || null;
    const cBarangay = c.barangay || (vess && vess.barangay) || null;
    const cRegistrationNumber =
      c.vesselRegistrationNumber ||
      (vess && vess.vessel_registration_number) ||
      null;
    const cVesselName =
      c.vesselName || c.vessel || (vess && vess.vessel_name) || null;
    const vidKey =
      cVesselId || cRegistrationNumber || cVesselName || "__unassigned__";
    const existing = state.catchesSummary.find(
      (s) =>
        (s.vesselId || "__unassigned__") === vidKey ||
        (s.registrationNumber && vidKey === s.registrationNumber) ||
        (s.vesselName && vidKey === s.vesselName),
    );
    if (existing) {
      existing.totalCatches += 1;
      existing.latestCapturedAt = c.capturedAt || c.createdAt;
      existing.latestSpecies = c.species;
      if (!existing.ownerName && cOwnerName) existing.ownerName = cOwnerName;
      if (!existing.vesselName && cVesselName)
        existing.vesselName = cVesselName;
      if (!existing.registrationNumber && cRegistrationNumber)
        existing.registrationNumber = cRegistrationNumber;
      if (!existing.barangay && cBarangay) existing.barangay = cBarangay;
      if (!existing.vesselId && cVesselId) existing.vesselId = cVesselId;
    } else {
      state.catchesSummary.unshift({
        vesselId: cVesselId,
        ownerName: cOwnerName,
        barangay: cBarangay,
        registrationNumber: cRegistrationNumber,
        vesselName: cVesselName,
        latestSpecies: c.species,
        latestCapturedAt: c.capturedAt || c.createdAt,
        totalCatches: 1,
        latestUserId: c.userId,
      });
    }
    if (state.currentModule === "mod_catches")
      renderCatchesSummary(state.catchesSummary);
    refreshSidebarBadges();
    return;
  }
  const thumb = c.photoUrl
    ? `<a target="_blank" rel="noopener" href="${c.photoUrl}" title="Open full-size photo"><img src="${c.photoUrl}" style="width:50px;height:50px;object-fit:cover;border-radius:8px;border:1px solid var(--border);display:block" alt="Catch photo" onerror="this.outerHTML='<div style=&quot;width:50px;height:50px;display:flex;align-items:center;justify-content:center;border-radius:8px;border:1px dashed var(--border);background:var(--background);color:var(--text-muted)&quot; title=&quot;Photo unavailable&quot;><i class=&quot;fa-solid fa-image&quot; style=&quot;font-size:16px&quot;></i></div>'"/></a>`
    : `<div style="width:50px;height:50px;display:flex;align-items:center;justify-content:center;border-radius:8px;border:1px dashed var(--border);background:var(--background);color:var(--text-muted)" title="No Photo"><i class="fa-solid fa-camera-slash" style="font-size:16px"></i></div>`;
  const row = `<tr data-id="${c.id}"><td>${c.user ? c.user.name : c.userId}</td><td>${thumb}</td><td class="sp">${c.species}</td><td class="nt">${c.netType || ""}</td><td class="gr">${c.gear || ""}</td><td class="vs">${c.vesselName || c.vessel || ""}</td><td><a target="_blank" href="https://maps.google.com/?q=${c.lat},${c.lng}">${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}</a></td><td>${new Date(c.capturedAt).toLocaleString()}</td><td class="act"><button onclick="startEditCatch('${c.id}','${c.species}','${(c.note || "").replace(/\"/g, "&quot;")}',${c.weightKg || null},${c.lengthCm || null},'${(c.netType || "").replace(/"/g, "&quot;")}','${(c.gear || "").replace(/"/g, "&quot;")}','${(c.vessel || "").replace(/"/g, "&quot;")}',${c.hoursFished != null ? c.hoursFished : "null"},${c.numHooksPanels != null ? c.numHooksPanels : "null"},${c.numHauls != null ? c.numHauls : "null"})">Edit</button> <button onclick="deleteCatch('${c.id}')">Delete</button></td></tr>`;
  ct.insertRow(1).outerHTML = row;
  if (!state.catches) state.catches = [];
  if (!state.catches.some((x) => x.id === c.id)) state.catches.unshift(c);
  if (state.currentModule === "mod_catches") markModuleRead("mod_catches");
  else refreshSidebarBadges();
}
function addAlertRow(a) {
  const at = document.getElementById("alerts");
  if (!at || !at.innerHTML) return;
  const uname = a.user ? a.user.name : a.userName || a.userId;
  const actions =
    (a.status === "resolved"
      ? ""
      : a.status === "acknowledged"
        ? `<button onclick="resolveAlert('${a.id}')">Resolve</button>`
        : `<button onclick="acknowledgeAlert('${a.id}')">Acknowledge</button> <button onclick="resolveAlert('${a.id}')">Resolve</button>`) +
    ` <button onclick="confirmDeleteAlert('${a.id}')">Delete</button>`;

  let typeStyle = "";
  if (a.type === "Status: Active")
    typeStyle =
      "background:#dcfce7; color:#166534; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600";
  else if (a.type === "Status: In Port")
    typeStyle =
      "background:#fef9c3; color:#854d0e; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600";
  else if (a.type === "Status: In Transit")
    typeStyle =
      "background:#dbeafe; color:#1e40af; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600";

  const typeDisplay = typeStyle
    ? `<span style="${typeStyle}">${a.type}</span>`
    : a.type;
  const row = `<tr><td>${typeDisplay}</td><td>${a.status || ""}</td><td>${uname}</td><td>${a.lat.toFixed(5)}, ${a.lng.toFixed(5)}</td><td>${new Date(a.recordedAt).toLocaleString()}</td><td>${actions}</td></tr>`;
  at.innerHTML += row;
  if (!state.alerts) state.alerts = [];
  if (!state.alerts.some((x) => x.id === a.id)) state.alerts.unshift(a);
  if (state.currentModule === "mod_alerts") markModuleRead("mod_alerts");
  else refreshSidebarBadges();
}
function playNotificationSound() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
    osc.frequency.exponentialRampToValueAtTime(1046.5, ctx.currentTime + 0.1); // C6
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.05);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
    setTimeout(() => ctx.close(), 300);
  } catch {}
}
function startAlarm() {
  if (state._alarmOn) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    let active = false;
    const timer = setInterval(() => {
      active = !active;
      gain.gain.setTargetAtTime(active ? 0.25 : 0, ctx.currentTime, 0.02);
    }, 600);
    state._alarm = { ctx, osc, gain, timer };
    state._alarmOn = true;
    try {
      ctx.resume();
    } catch {}
  } catch {}
}
function stopAlarm() {
  const a = state._alarm;
  if (!a) return;
  try {
    clearInterval(a.timer);
    a.osc.stop();
    a.ctx.close();
  } catch {}
  state._alarm = null;
  state._alarmOn = false;
}

async function resolveAlert(id) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: "Bearer " + state.token,
  };
  await fetch("/api/admin/alerts/" + id, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ status: "resolved" }),
  });
  loadData();
}
async function acknowledgeAlert(id) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: "Bearer " + state.token,
  };
  await fetch("/api/admin/alerts/" + id, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ status: "acknowledged" }),
  });
  loadData();
}
function closeHistory() {
  const ov = document.getElementById("history_overlay");
  if (ov) ov.style.display = "none";
  const box = document.getElementById("history_popup");
  if (box) box.innerHTML = "";
  if (state.historyMap) {
    try {
      state.historyMap.map.remove();
    } catch {}
    state.historyMap = null;
    state.historyRoute = null;
  }
  state.currentHistoryUserId = null;
  state.trackHistory = [];
  state.historySelectedTracks.clear();
}
function getHistoryDateRange(filter, customFrom, customTo) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (filter) {
    case "today":
      return { from: todayStart.toISOString(), to: now.toISOString() };
    case "yesterday": {
      const yestEnd = new Date(todayStart.getTime() - 1);
      const yestStart = new Date(
        yestEnd.getFullYear(),
        yestEnd.getMonth(),
        yestEnd.getDate(),
      );
      return { from: yestStart.toISOString(), to: yestEnd.toISOString() };
    }
    case "last7":
      return {
        from: new Date(
          todayStart.getTime() - 7 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        to: now.toISOString(),
      };
    case "last30":
      return {
        from: new Date(
          todayStart.getTime() - 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        to: now.toISOString(),
      };
    case "custom":
      return {
        from: customFrom ? new Date(customFrom).toISOString() : null,
        to: customTo ? new Date(customTo + "T23:59:59").toISOString() : null,
      };
    case "all":
      return { from: null, to: null };
    default:
      return { from: null, to: null };
  }
}
async function openUserTrackHistory(userId) {
  if (!userId) return;
  state.currentHistoryUserId = userId;
  state.currentHistoryFilter = "all";
  state.historySelectedTracks.clear();

  const ov = document.getElementById("history_overlay");
  const box = document.getElementById("history_popup");
  if (!ov || !box) return;

  ov.style.display = "flex";
  box.style.maxWidth = "1100px";
  box.style.maxHeight = "90vh";
  box.style.overflowY = "auto";
  box.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px">
            <h3 style="margin:0">GPS TRACK HISTORY</h3>
            <button onclick="closeHistory()" style="width:auto; height:auto; padding:8px 16px">Close</button>
          </div>
          <div id="history_user_info" class="small" style="margin-bottom:12px; color:var(--text-muted)">Loading...</div>
          <div style="display:flex; gap:8px; align-items:center; margin-bottom:12px; flex-wrap:wrap">
            <select id="historyDateFilter" onchange="onHistoryDateFilterChange()" style="width:auto; margin:0">
              <option value="all">All History</option>
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="last7">Last 7 Days</option>
              <option value="last30">Last 30 Days</option>
              <option value="custom">Custom Date Range</option>
            </select>
            <input id="historyFrom" type="date" style="display:none; width:auto; margin:0" />
            <input id="historyTo" type="date" style="display:none; width:auto; margin:0" />
            <button onclick="loadTrackHistory()" style="width:auto; height:auto; padding:8px 16px; margin:0"><i class="fa-solid fa-filter"></i> Apply Filter</button>
            <button onclick="confirmDeleteUserHistory()" style="width:auto; height:auto; padding:8px 16px; margin:0; background:#ff3b30"><i class="fa-solid fa-trash-can"></i> Delete All History</button>
          </div>
          <div id="history_map" style="width:100%; height:320px; border-radius:12px; overflow:hidden; border:1px solid var(--border); margin-bottom:12px"></div>
          <div style="max-height:50vh; overflow:auto; border:1px solid var(--border); border-radius:12px">
            <table id="history_table" style="margin-top:0">
              <thead>
                <tr><th style="width:36px; text-align:center"><input type="checkbox" id="selectAllHistoryTracks" onchange="toggleSelectAllHistory(this.checked)" /></th><th>Coordinates</th><th>Date</th><th>Time</th><th>Action</th></tr>
              </thead>
              <tbody><tr><td colspan="5" style="text-align:center; padding:20px; color:var(--text-muted)">Loading...</td></tr></tbody>
            </table>
          </div>
          <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:16px">
            <button onclick="confirmDeleteSelectedHistoryTracks()" style="background:#ff3b30; width:auto; padding:8px 16px; height:auto; font-size:13px"><i class="fa-solid fa-trash-can"></i> Delete Selected (<span id="selectedHistoryCount">0</span>)</button>
            <button onclick="closeHistory()" style="width:auto; padding:8px 16px; height:auto; font-size:13px">Close</button>
          </div>
        `;
  await loadTrackHistory();
}

async function loadTrackHistory() {
  const userId = state.currentHistoryUserId;
  if (!userId) return;

  const filterVal = document.getElementById("historyDateFilter").value;
  const customFrom = document.getElementById("historyFrom").value;
  const customTo = document.getElementById("historyTo").value;
  const range = getHistoryDateRange(filterVal, customFrom, customTo);

  const headers = { Authorization: "Bearer " + state.token };
  let url = "/api/admin/tracks?userId=" + encodeURIComponent(userId);
  if (range.from) url += "&from=" + encodeURIComponent(range.from);
  if (range.to) url += "&to=" + encodeURIComponent(range.to);

  try {
    const r = await fetch(url, { headers });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Failed to load track history");

    // Standardize object properties (lat/lng and user info)
    const rawList = Array.isArray(d) ? d : [];
    state.trackHistory = rawList
      .map((t) => ({
        ...t,
        lat: t.lat ?? t.latitude,
        lng: t.lng ?? t.longitude,
        recordedAt: t.recordedAt || t.recorded_at || t.created_at,
      }))
      .sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt));

    renderTrackHistory();
    updateHistoryMap();
    updateUserHistoryInfo(userId);
  } catch (e) {
    const tbl = document.getElementById("history_table");
    if (tbl)
      tbl.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--error)">${e.message || "Failed to load history"}</td></tr>`;
  }
}

function updateUserHistoryInfo(userId) {
  const infoEl = document.getElementById("history_user_info");
  if (!infoEl) return;

  const summary = (state.tracksSummary || []).find((s) => s.userId === userId);
  const latest = state.trackHistory[0];

  // Resolve user details from summary object or individual track object
  const name =
    (summary ? summary.userName : null) ||
    (latest && latest.user ? latest.user.name : null) ||
    userId;

  const email =
    (summary ? summary.userEmail : null) ||
    (latest && latest.user ? latest.user.email : null) ||
    "";

  const total = state.trackHistory ? state.trackHistory.length : 0;

  const lat = latest ? (latest.lat ?? latest.latitude) : null;
  const lng = latest ? (latest.lng ?? latest.longitude) : null;

  const latestCoord =
    lat != null && lng != null
      ? `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`
      : "—";

  const latestTime =
    latest && latest.recordedAt
      ? new Date(latest.recordedAt).toLocaleString()
      : "—";

  infoEl.innerHTML = `<b style="color:var(--text-main); font-size:14px">${name}</b>${email ? " • " + email : ""}<br/>Total Tracks: ${total} • Latest: ${latestCoord} (${latestTime})`;
}

function renderTrackHistory() {
  const tbl = document.getElementById("history_table");
  if (!tbl) return;
  const thead = tbl.querySelector("thead");
  tbl.innerHTML = "";
  if (thead) tbl.appendChild(thead);
  else {
    tbl.innerHTML =
      '<tr><th style="width:36px; text-align:center"><input type="checkbox" id="selectAllHistoryTracks" onchange="toggleSelectAllHistory(this.checked)" /></th><th>Coordinates</th><th>Date</th><th>Time</th><th>Action</th></tr>';
  }
  const tbody = tbl.querySelector("tbody") || document.createElement("tbody");
  tbody.innerHTML = "";
  if (!state.trackHistory || state.trackHistory.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--text-muted)">No GPS records found for this user.</td></tr>';
  } else {
    state.trackHistory.forEach((t) => {
      const checked = state.historySelectedTracks.has(t.id) ? "checked" : "";
      const date = t.recordedAt ? new Date(t.recordedAt) : null;
      const dateStr = date ? date.toLocaleDateString() : "—";
      const timeStr = date ? date.toLocaleTimeString() : "—";

      const lat = t.lat ?? t.latitude;
      const lng = t.lng ?? t.longitude;

      const coordStr =
        lat != null && lng != null
          ? `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`
          : "—";

      const mapLink =
        lat != null && lng != null
          ? `<a target="_blank" href="https://maps.google.com/?q=${lat},${lng}">${coordStr}</a>`
          : "—";

      tbody.innerHTML += `<tr>
        <td style="text-align:center">
          <input type="checkbox" class="history-track-checkbox" data-id="${t.id}" onchange="toggleSingleHistoryTrack('${t.id}', this.checked)" ${checked} />
        </td>
        <td>${mapLink}</td>
        <td>${dateStr}</td>
        <td>${timeStr}</td>
        <td><button onclick="confirmDeleteHistoryTrack('${t.id}')">Delete</button></td>
      </tr>`;
    });
  }
  if (!tbl.querySelector("tbody")) tbl.appendChild(tbody);

  const allChecked =
    state.trackHistory.length > 0 &&
    state.trackHistory.every((t) => state.historySelectedTracks.has(t.id));
  const selectAll = document.getElementById("selectAllHistoryTracks");
  if (selectAll) selectAll.checked = allChecked;
  updateSelectedHistoryUi();
}

function toggleSelectAllHistory(checked) {
  if (checked) {
    state.trackHistory.forEach((t) => state.historySelectedTracks.add(t.id));
  } else {
    state.historySelectedTracks.clear();
  }
  document.querySelectorAll(".history-track-checkbox").forEach((cb) => {
    const id = cb.getAttribute("data-id");
    cb.checked = state.historySelectedTracks.has(id);
  });
  updateSelectedHistoryUi();
}

function toggleSingleHistoryTrack(id, checked) {
  if (checked) state.historySelectedTracks.add(id);
  else state.historySelectedTracks.delete(id);
  const allChecked =
    state.trackHistory.length > 0 &&
    state.trackHistory.every((t) => state.historySelectedTracks.has(t.id));
  const selectAll = document.getElementById("selectAllHistoryTracks");
  if (selectAll) selectAll.checked = allChecked;
  updateSelectedHistoryUi();
}

function updateSelectedHistoryUi() {
  const count = state.historySelectedTracks.size;
  const countEl = document.getElementById("selectedHistoryCount");
  if (countEl) countEl.textContent = count;
}

function onHistoryDateFilterChange() {
  const filterVal = document.getElementById("historyDateFilter").value;
  const fromEl = document.getElementById("historyFrom");
  const toEl = document.getElementById("historyTo");
  if (filterVal === "custom") {
    if (fromEl) fromEl.style.display = "";
    if (toEl) toEl.style.display = "";
  } else {
    if (fromEl) fromEl.style.display = "none";
    if (toEl) toEl.style.display = "none";
  }
}

function updateHistoryMap() {
  if (!state.historyMap) initHistoryMap();
  if (!state.historyMap) return;
  const map = state.historyMap.map;
  if (state.historyRoute) {
    try {
      state.historyRoute.remove();
    } catch {}
    state.historyRoute = null;
  }
  state.historyMap.markersByUserId.forEach((m) => {
    try {
      m.remove();
    } catch {}
  });
  state.historyMap.markersByUserId = new Map();

  const pts = (state.trackHistory || []).filter(
    (t) => t.lat != null && t.lng != null,
  );
  if (pts.length === 0) return;

  const latLngs = pts.map((t) => [t.lat, t.lng]);
  const polyline = window.L.polyline(latLngs, {
    color: "#0077B6",
    weight: 4,
    opacity: 0.85,
  });
  polyline.addTo(map);
  state.historyRoute = polyline;

  pts.forEach((t, i) => {
    const marker = window.L.circleMarker([t.lat, t.lng], {
      radius: 6,
      color: "#0077B6",
      weight: 2,
      opacity: 1,
      fillColor: "#00B4D8",
      fillOpacity: 0.9,
    });
    marker.addTo(map);
    marker.bindPopup(
      `<b>Point ${i + 1}</b><br/>${t.lat.toFixed(5)}, ${t.lng.toFixed(5)}<br/>${new Date(t.recordedAt).toLocaleString()}`,
    );
    state.historyMap.markersByUserId.set(t.id, marker);
  });

  try {
    const bounds = window.L.latLngBounds(latLngs);
    map.fitBounds(bounds.pad(0.2), { animate: false });
  } catch {}
}

function initHistoryMap() {
  const el = document.getElementById("history_map");
  if (!el || !window.L) return;
  if (state.historyMap) {
    try {
      state.historyMap.map.remove();
    } catch {}
  }
  const map = window.L.map(el, { zoomControl: true });
  window.L.tileLayer("/api/public/tiles/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
  map.setView([12.5, 122.0], 6);
  state.historyMap = { map, markersByUserId: new Map(), route: null };
}

async function confirmDeleteUserHistory() {
  const userId = state.currentHistoryUserId;
  if (!userId) return;
  const summary = (state.tracksSummary || []).find((s) => s.userId === userId);
  const name = summary ? summary.userName || userId : userId;
  openConfirm(
    `Are you sure you want to delete all GPS tracking history for ${name}?`,
    function () {
      deleteUserHistory(userId);
    },
  );
}

async function deleteUserHistory(userId) {
  const headers = { Authorization: "Bearer " + state.token };
  await fetch("/api/admin/tracks/user/" + encodeURIComponent(userId), {
    method: "DELETE",
    headers,
  });
  closeHistory();
  loadData();
}

async function confirmDeleteSelectedHistoryTracks() {
  const count = state.historySelectedTracks.size;
  if (count === 0) return;
  openConfirm(
    `Are you sure you want to delete the selected ${count} GPS track record(s)?`,
    function () {
      deleteSelectedHistoryTracks();
    },
  );
}

async function deleteSelectedHistoryTracks() {
  const headers = { Authorization: "Bearer " + state.token };
  const ids = Array.from(state.historySelectedTracks);
  const deletePromises = ids.map((id) =>
    fetch("/api/admin/tracks/" + id, { method: "DELETE", headers }),
  );
  await Promise.all(deletePromises);
  state.historySelectedTracks.clear();
  loadTrackHistory();
}

async function confirmDeleteHistoryTrack(id) {
  openConfirm("Delete this track record?", function () {
    deleteHistoryTrack(id);
  });
}

async function deleteHistoryTrack(id) {
  const headers = { Authorization: "Bearer " + state.token };
  await fetch("/api/admin/tracks/" + id, { method: "DELETE", headers });
  state.historySelectedTracks.delete(id);
  loadTrackHistory();
}

async function loadTracksSummary() {
  const headers = { Authorization: "Bearer " + state.token };
  try {
    const res = await fetch("/api/admin/tracks/summary", { headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to fetch summary");

    // Guard: Ensure we only store grouped user summary items
    state.tracksSummary = Array.isArray(data) ? data : [];
    renderTracksSummary(state.tracksSummary);
  } catch (err) {
    console.error("Track Summary Load Error:", err);
  }
}

function renderTracksSummary(summary) {
  const tt = document.getElementById("tracks");
  if (!tt) return;

  // Guarantee we are operating on unique user summaries
  const arr = Array.isArray(summary) ? summary : [];

  tt.innerHTML =
    '<tr><th style="width:36px; text-align:center"><input type="checkbox" id="selectAllTracks" onchange="toggleSelectAllUsers(this.checked)" /></th><th>User</th><th>Latest Coordinates</th><th>Last Recorded</th><th>Total Tracks</th><th>Action</th></tr>';

  if (arr.length === 0) {
    tt.innerHTML +=
      '<tr><td colspan="6" style="text-align:center; padding: 24px; color: var(--text-muted);">No tracks found.</td></tr>';
    updateSelectedUserUi();
    return;
  }

  arr.forEach((s) => {
    const checked = state.selectedUsers.has(s.userId) ? "checked" : "";

    const userName = s.userName || s.userId || "Unknown User";
    const userEmail = s.userEmail || "";

    const lat = s.latestLat ?? s.lat ?? s.latitude;
    const lng = s.latestLng ?? s.lng ?? s.longitude;

    const coordStr =
      lat != null && lng != null
        ? `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`
        : "—";

    const lastRecorded = s.latestRecordedAt || s.recordedAt || s.recorded_at;
    const recordedStr = lastRecorded
      ? new Date(lastRecorded).toLocaleString()
      : "—";

    const count = s.totalTracks != null ? s.totalTracks : 1;

    tt.innerHTML += `<tr>
      <td style="text-align:center">
        <input type="checkbox" class="user-checkbox" data-user-id="${s.userId}" onchange="toggleSingleUser('${s.userId}', this.checked)" ${checked} />
      </td>
      <td>
        <a href="#" onclick="openUserTrackHistory('${s.userId}'); return false;" style="font-weight:600; color:var(--primary)">${userName}</a>
        <div class="small" style="color:var(--text-muted)">${userEmail}</div>
      </td>
      <td>${coordStr}</td>
      <td>${recordedStr}</td>
      <td>${count} tracks</td>
      <td><button onclick="openUserTrackHistory('${s.userId}')">View History</button></td>
    </tr>`;
  });

  const allChecked =
    arr.length > 0 && arr.every((s) => state.selectedUsers.has(s.userId));
  const selectAll = document.getElementById("selectAllTracks");
  if (selectAll) selectAll.checked = allChecked;
  updateSelectedUserUi();
}

function updateTrackHistoryUserInfo(userId) {
  const infoEl = document.getElementById("track_history_user_info");
  if (!infoEl) return;

  const summary = (state.tracksSummary || []).find((s) => s.userId === userId);
  const latestTrack = state.trackHistory ? state.trackHistory[0] : null;

  const userName = summary
    ? summary.userName
    : latestTrack && latestTrack.user
      ? latestTrack.user.name
      : userId;

  const userEmail = summary
    ? summary.userEmail
    : latestTrack && latestTrack.user
      ? latestTrack.user.email
      : "";

  const totalTracks = state.trackHistory ? state.trackHistory.length : 0;
  const latestTime =
    latestTrack && latestTrack.recordedAt
      ? new Date(latestTrack.recordedAt).toLocaleString()
      : "—";

  infoEl.innerHTML = `<b style="color:var(--text-main); font-size:14px">${userName}</b>${
    userEmail ? " • " + userEmail : ""
  }<br/>Total Recorded Tracks: ${totalTracks} • Latest: ${latestTime}`;
}

function closeCatchHistory() {
  const ov = document.getElementById("catch_history_overlay");
  if (ov) ov.style.display = "none";
  const box = document.getElementById("catch_history_popup");
  if (box) box.innerHTML = "";
  if (state.catchHistoryMap) {
    try {
      state.catchHistoryMap.map.remove();
    } catch {}
    state.catchHistoryMap = null;
  }
  state.currentCatchHistoryUserId = null;
  state.currentCatchHistoryVesselId = null;
  state.catchHistory = [];
  state.historySelectedCatches.clear();
}
function getCatchDateRange(filter, customFrom, customTo) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (filter) {
    case "today":
      return { from: todayStart.toISOString(), to: now.toISOString() };
    case "yesterday": {
      const yestEnd = new Date(todayStart.getTime() - 1);
      const yestStart = new Date(
        yestEnd.getFullYear(),
        yestEnd.getMonth(),
        yestEnd.getDate(),
      );
      return { from: yestStart.toISOString(), to: yestEnd.toISOString() };
    }
    case "last7":
      return {
        from: new Date(
          todayStart.getTime() - 7 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        to: now.toISOString(),
      };
    case "last30":
      return {
        from: new Date(
          todayStart.getTime() - 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        to: now.toISOString(),
      };
    case "custom":
      return {
        from: customFrom ? new Date(customFrom).toISOString() : null,
        to: customTo ? new Date(customTo + "T23:59:59").toISOString() : null,
      };
    case "all":
      return { from: null, to: null };
    default:
      return { from: null, to: null };
  }
}
async function openCatchHistory(userId, vesselId) {
  if (!userId && !vesselId) return;
  state.currentCatchHistoryUserId = userId || null;
  state.currentCatchHistoryVesselId = vesselId || null;
  state.currentCatchHistoryFilter = "all";
  state.historySelectedCatches.clear();

  const ov = document.getElementById("catch_history_overlay");
  const box = document.getElementById("catch_history_popup");
  if (!ov || !box) return;

  ov.style.display = "flex";
  box.style.maxWidth = "1200px";
  box.style.maxHeight = "90vh";
  box.style.overflowY = "auto";
  const headerTitle = vesselId
    ? vesselId === "__unassigned__"
      ? "CATCH HISTORY — UNASSIGNED VESSEL"
      : "CATCH HISTORY — BY VESSEL"
    : "CATCH HISTORY";
  const deleteBtnLabel = vesselId
    ? "Delete History for This Vessel"
    : "Delete All History";
  box.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px">
            <h3 style="margin:0">${headerTitle}</h3>
            <button onclick="closeCatchHistory()" style="width:auto; height:auto; padding:8px 16px">Close</button>
          </div>
          <div id="catch_history_user_info" class="small" style="margin-bottom:12px; color:var(--text-muted)">Loading...</div>
          <div style="display:flex; gap:8px; align-items:center; margin-bottom:12px; flex-wrap:wrap">
            <select id="catchDateFilter" onchange="onCatchDateFilterChange()" style="width:auto; margin:0">
              <option value="all">All History</option>
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="last7">Last 7 Days</option>
              <option value="last30">Last 30 Days</option>
              <option value="custom">Custom Date Range</option>
            </select>
            <input id="catchFrom" type="date" style="display:none; width:auto; margin:0" />
            <input id="catchTo" type="date" style="display:none; width:auto; margin:0" />
            <button onclick="loadCatchHistory()" style="width:auto; height:auto; padding:8px 16px; margin:0"><i class="fa-solid fa-filter"></i> Apply Filter</button>
            <button onclick="confirmDeleteUserCatchHistory()" style="width:auto; height:auto; padding:8px 16px; margin:0; background:#ff3b30"><i class="fa-solid fa-trash-can"></i> ${deleteBtnLabel}</button>
          </div>
          <div id="catch_history_map" style="width:100%; height:320px; border-radius:12px; overflow:hidden; border:1px solid var(--border); margin-bottom:12px"></div>
          <div style="max-height:50vh; overflow:auto; border:1px solid var(--border); border-radius:12px">
            <table id="catch_history_table" style="margin-top:0">
              <thead>
                <tr><th>Photo</th><th>Species</th><th>Weight</th><th>Length</th><th>Net</th><th>Engine</th><th>Hrs</th><th>Hooks</th><th>Hauls</th><th>Vessel</th><th>Coords</th><th>Captured</th><th>Action</th></tr>
              </thead>
              <tbody><tr><td colspan="13" style="text-align:center; padding:20px; color:var(--text-muted)">Loading...</td></tr></tbody>
            </table>
          </div>
          <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:16px">
            <button onclick="closeCatchHistory()" style="width:auto; padding:8px 16px; height:auto; font-size:13px">Close</button>
          </div>
        `;
  await loadCatchHistory();
}

async function loadCatchHistory() {
  const userId = state.currentCatchHistoryUserId;
  const vesselId = state.currentCatchHistoryVesselId;
  if (!userId && !vesselId) return;

  const filterVal = document.getElementById("catchDateFilter").value;
  const customFrom = document.getElementById("catchFrom").value;
  const customTo = document.getElementById("catchTo").value;
  const range = getCatchDateRange(filterVal, customFrom, customTo);

  const headers = { Authorization: "Bearer " + state.token };
  let url = "/api/catches?";
  const params = [];
  if (userId) params.push("userId=" + encodeURIComponent(userId));
  if (vesselId) params.push("vesselId=" + encodeURIComponent(vesselId));
  if (range.from) params.push("from=" + encodeURIComponent(range.from));
  if (range.to) params.push("to=" + encodeURIComponent(range.to));
  url += params.join("&");

  try {
    const r = await fetch(url, { headers });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Failed to load catch history");
    const rows = Array.isArray(d) ? d : [];
    state.catchHistory = rows.sort(
      (a, b) =>
        new Date(b.capturedAt || b.createdAt) -
        new Date(a.capturedAt || a.createdAt),
    );
    renderCatchHistory();
    updateCatchHistoryMap();
    updateCatchHistoryUserInfo(userId, vesselId);
  } catch (e) {
    const tbl = document.getElementById("catch_history_table");
    if (tbl)
      tbl.innerHTML = `<tr><td colspan="13" style="text-align:center; padding:20px; color:var(--error)">${e.message || "Failed to load history"}</td></tr>`;
  }
}

function updateCatchHistoryUserInfo(userId, vesselId) {
  const infoEl = document.getElementById("catch_history_user_info");
  if (!infoEl) return;
  const latest = state.catchHistory[0];
  const totalCatches = state.catchHistory ? state.catchHistory.length : 0;
  const latestTime = latest
    ? new Date(latest.capturedAt || latest.createdAt).toLocaleString()
    : "—";
  if (vesselId) {
    const summary = (state.catchesSummary || []).find(
      (s) =>
        (s.vesselId || "__unassigned__") === (vesselId || "__unassigned__"),
    );
    const owner = summary
      ? summary.ownerName ||
        (vesselId === "__unassigned__" ? "Unassigned Vessel" : "—")
      : vesselId === "__unassigned__"
        ? "Unassigned Vessel"
        : "—";
    const sub = [];
    if (summary && summary.vesselName) sub.push(summary.vesselName);
    if (summary && summary.registrationNumber)
      sub.push("Reg #" + summary.registrationNumber);
    if (summary && summary.barangay && summary.barangay !== "—")
      sub.push(summary.barangay);
    const subStr = sub.join(" • ");
    infoEl.innerHTML = `<b style="color:var(--text-main); font-size:14px">Owner: ${owner}</b>${subStr ? " • " + subStr : ""}<br/>Total Catches: ${totalCatches} • Latest: ${latestTime}`;
    return;
  }
  const summary = (state.catchesSummary || []).find((s) => s.userId === userId);
  const name = summary ? summary.userName || userId : userId;
  const email = summary ? summary.userEmail || "" : "";
  const barangay = summary ? summary.barangay || "—" : "—";
  infoEl.innerHTML = `<b style="color:var(--text-main); font-size:14px">${name}</b>${email ? " • " + email : ""}${barangay !== "—" ? " • " + barangay : ""}<br/>Total Catches: ${totalCatches} • Latest: ${latestTime}`;
}

function renderCatchHistory() {
  const tbl = document.getElementById("catch_history_table");
  if (!tbl) return;
  const thead = tbl.querySelector("thead");
  tbl.innerHTML = "";
  if (thead) tbl.appendChild(thead);
  else {
    tbl.innerHTML =
      "<tr><th>Photo</th><th>Species</th><th>Weight</th><th>Length</th><th>Net</th><th>Engine</th><th>Hrs</th><th>Hooks</th><th>Hauls</th><th>Vessel</th><th>Coords</th><th>Captured</th><th>Action</th></tr>";
  }
  const tbody = tbl.querySelector("tbody") || document.createElement("tbody");
  tbody.innerHTML = "";
  if (!state.catchHistory || state.catchHistory.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="13" style="text-align:center; padding:20px; color:var(--text-muted)">No catch records found.</td></tr>';
  } else {
    state.catchHistory.forEach((c) => {
      const date = c.capturedAt
        ? new Date(c.capturedAt)
        : c.createdAt
          ? new Date(c.createdAt)
          : null;
      const captured = date ? date.toLocaleString() : "—";

      // Fallback check for coordinates
      const lat = c.lat ?? c.latitude;
      const lng = c.lng ?? c.longitude;
      const hasCoords =
        lat != null &&
        lng != null &&
        !isNaN(Number(lat)) &&
        !isNaN(Number(lng));

      const coordStr = hasCoords
        ? `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`
        : "—";
      const coordCell = hasCoords
        ? `<a target="_blank" rel="noopener" href="https://maps.google.com/?q=${lat},${lng}">${coordStr}</a>`
        : "—";

      const hrs = c.hoursFished != null ? Number(c.hoursFished).toFixed(1) : "";
      const hooks = c.numHooksPanels != null ? c.numHooksPanels : "";
      const hauls = c.numHauls != null ? c.numHauls : "";
      const photoCell = c.photoUrl
        ? `<a target="_blank" rel="noopener" href="${c.photoUrl}" title="Open full-size photo"><img src="${c.photoUrl}" style="width:50px;height:50px;object-fit:cover;border-radius:8px;border:1px solid var(--border);display:block" alt="Catch photo" onerror="this.outerHTML='<div style=&quot;width:50px;height:50px;display:flex;align-items:center;justify-content:center;border-radius:8px;border:1px dashed var(--border);background:var(--background);color:var(--text-muted)&quot; title=&quot;Photo unavailable&quot;><i class=&quot;fa-solid fa-image&quot; style=&quot;font-size:16px&quot;></i></div>'"/></a>`
        : `<div style="width:50px;height:50px;display:flex;align-items:center;justify-content:center;border-radius:8px;border:1px dashed var(--border);background:var(--background);color:var(--text-muted)" title="No Photo"><i class="fa-solid fa-camera-slash" style="font-size:16px"></i></div>`;

      tbody.innerHTML += `<tr data-id="${c.id}">
        <td>${photoCell}</td>
        <td class="sp">${c.species}</td>
        <td class="wt">${c.weightKg || ""}</td>
        <td class="ln">${c.lengthCm || ""}</td>
        <td class="nt">${c.netType || ""}</td>
        <td class="gr">${c.engine || c.gear || ""}</td>
        <td class="hf">${hrs}</td>
        <td class="nhp">${hooks}</td>
        <td class="nh">${hauls}</td>
        <td class="vs">${c.vesselName || c.vessel || ""}</td>
        <td>${coordCell}</td>
        <td>${captured}</td>
        <td class="act"><button onclick="startEditCatch('${c.id}','${c.species}','${(c.note || "").replace(/"/g, "&quot;")}',${c.weightKg || null},${c.lengthCm || null},'${(c.netType || "").replace(/"/g, "&quot;")}','${(c.gear || "").replace(/"/g, "&quot;")}','${(c.vesselName || c.vessel || "").replace(/"/g, "&quot;")}',${c.hoursFished != null ? c.hoursFished : "null"},${c.numHooksPanels != null ? c.numHooksPanels : "null"},${c.numHauls != null ? c.numHauls : "null"})">Edit</button> <button onclick="confirmDeleteCatchHistoryTrack('${c.id}')">Delete</button></td>
      </tr>`;
    });
  }
  if (!tbl.querySelector("tbody")) tbl.appendChild(tbody);
}

function onCatchDateFilterChange() {
  const filterVal = document.getElementById("catchDateFilter").value;
  const fromEl = document.getElementById("catchFrom");
  const toEl = document.getElementById("catchTo");
  if (filterVal === "custom") {
    if (fromEl) fromEl.style.display = "";
    if (toEl) toEl.style.display = "";
  } else {
    if (fromEl) fromEl.style.display = "none";
    if (toEl) toEl.style.display = "none";
  }
}

function updateCatchHistoryMap() {
  if (!state.catchHistoryMap) initCatchHistoryMap();
  if (!state.catchHistoryMap) return;
  const map = state.catchHistoryMap.map;
  state.catchHistoryMap.markersByUserId.forEach((m) => {
    try {
      m.remove();
    } catch {}
  });
  state.catchHistoryMap.markersByUserId = new Map();

  const pts = (state.catchHistory || []).filter(
    (c) => c.lat != null && c.lng != null,
  );
  if (pts.length === 0) return;

  pts.forEach((c, i) => {
    const marker = window.L.circleMarker([c.lat, c.lng], {
      radius: 7,
      color: "#06D6A0",
      weight: 2,
      opacity: 1,
      fillColor: "#06D6A0",
      fillOpacity: 0.9,
    });
    marker.addTo(map);
    const netStr = c.netType || "—";
    const engineStr = c.gear || "—";
    const hrsStr =
      c.hoursFished != null ? Number(c.hoursFished).toFixed(1) : "—";
    const hooksStr = c.numHooksPanels != null ? c.numHooksPanels : "—";
    const haulsStr = c.numHauls != null ? c.numHauls : "—";
    const date = c.capturedAt
      ? new Date(c.capturedAt)
      : c.createdAt
        ? new Date(c.createdAt)
        : null;
    marker.bindPopup(
      `<b>${c.species}</b><br/><b>Weight:</b> ${c.weightKg || "—"}<br/><b>Length:</b> ${c.lengthCm || "—"}<br/><b>Net:</b> ${netStr}<br/><b>Engine:</b> ${engineStr}<br/><b>Hrs Fished:</b> ${hrsStr}<br/><b>Hooks/Panels:</b> ${hooksStr}<br/><b>Hauls:</b> ${haulsStr}<br/><b>Vessel:</b> ${c.vesselName || c.vessel || "—"}<br/><b>Time:</b> ${date ? date.toLocaleString() : "—"}<br/><b>Coords:</b> ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`,
    );
    state.catchHistoryMap.markersByUserId.set(c.id, marker);
  });

  try {
    const bounds = window.L.latLngBounds(pts.map((c) => [c.lat, c.lng]));
    map.fitBounds(bounds.pad(0.2), { animate: false });
  } catch {}
}

function initCatchHistoryMap() {
  const el = document.getElementById("catch_history_map");
  if (!el || !window.L) return;
  if (state.catchHistoryMap) {
    try {
      state.catchHistoryMap.map.remove();
    } catch {}
  }
  const map = window.L.map(el, { zoomControl: true });
  window.L.tileLayer("/api/public/tiles/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
  map.setView([12.5, 122.0], 6);
  state.catchHistoryMap = { map, markersByUserId: new Map() };
}

async function confirmDeleteUserCatchHistory() {
  const userId = state.currentCatchHistoryUserId;
  const vesselId = state.currentCatchHistoryVesselId;
  if (!userId && !vesselId) return;
  if (vesselId) {
    const summary = (state.catchesSummary || []).find(
      (s) => s.vesselId === vesselId,
    );
    const name = summary
      ? summary.ownerName ||
        (vesselId === "__unassigned__"
          ? "Unassigned Vessel"
          : summary.vesselName || "Vessel")
      : vesselId === "__unassigned__"
        ? "Unassigned Vessel"
        : "This Vessel";
    openConfirm(
      `Are you sure you want to delete all catch records for ${name}? This action cannot be undone.`,
      function () {
        deleteCatchHistoryByVessel(vesselId);
      },
    );
    return;
  }
  const summary = (state.catchesSummary || []).find((s) => s.userId === userId);
  const name = summary ? summary.userName || userId : userId;
  openConfirm(
    `Are you sure you want to delete all catch records for ${name}? This action cannot be undone.`,
    function () {
      deleteUserCatchHistory(userId);
    },
  );
}

async function deleteUserCatchHistory(userId) {
  const headers = { Authorization: "Bearer " + state.token };
  await fetch("/api/admin/catches/user/" + encodeURIComponent(userId), {
    method: "DELETE",
    headers,
  });
  closeCatchHistory();
  loadData();
}

async function deleteCatchHistoryByVessel(vesselId) {
  const headers = { Authorization: "Bearer " + state.token };
  await fetch("/api/admin/catches/vessel/" + encodeURIComponent(vesselId), {
    method: "DELETE",
    headers,
  });
  closeCatchHistory();
  loadData();
}

async function confirmDeleteCatchHistoryTrack(id) {
  openConfirm("Delete this catch record?", function () {
    deleteCatchHistoryTrack(id);
  });
}

async function deleteCatchHistoryTrack(id) {
  const headers = { Authorization: "Bearer " + state.token };
  await fetch("/api/admin/catches/" + id, { method: "DELETE", headers });
  if (state.currentCatchHistoryUserId || state.currentCatchHistoryVesselId) {
    loadCatchHistory();
  } else {
    loadData();
  }
}

function openConfirm(text, onYes, options = {}) {
  const ov = document.getElementById("confirm_overlay");
  const box = document.getElementById("confirm_popup");

  state.confirmCb = onYes;

  const title = options.title || "Confirm Action";
  const confirmText = options.confirmText || "Delete";
  const confirmBg =
    options.isDanger !== false ? "#ef4444" : "var(--primary, #0284c7)";

  box.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
      <div style="
        width: 40px; 
        height: 40px; 
        border-radius: 50%; 
        background: rgba(239, 68, 68, 0.1); 
        display: flex; 
        align-items: center; 
        justify-content: center;
        color: #ef4444;
        font-size: 18px;
        flex-shrink: 0;
      ">
        <i class="fa-solid fa-triangle-exclamation"></i>
      </div>
      <h3 style="margin: 0; font-size: 18px; font-weight: 600; color: var(--text-primary, #1f2937);">${title}</h3>
    </div>
    
    <p style="margin: 0 0 20px 0; font-size: 14px; color: var(--text-muted, #4b5563); line-height: 1.5;">${text}</p>
    
    <div style="display: flex; gap: 10px; justify-content: flex-end;">
      <button 
        onclick="closeConfirm()" 
        style="
          margin: 0; 
          padding: 8px 16px; 
          background: transparent; 
          border: 1px solid var(--border, #d1d5db); 
          color: var(--text-primary, #374151); 
          border-radius: 6px; 
          cursor: pointer;
          font-weight: 500;
        "
      >
        Cancel
      </button>
      <button 
        onclick="doConfirm()" 
        style="
          margin: 0; 
          padding: 8px 16px; 
          background: ${confirmBg}; 
          color: #ffffff; 
          border: none; 
          border-radius: 6px; 
          cursor: pointer;
          font-weight: 500;
        "
      >
        ${confirmText}
      </button>
    </div>
  `;

  // Display overlay
  ov.style.display = "flex";

  // Close when clicking overlay backdrop outside the popup box
  ov.onclick = (e) => {
    if (e.target === ov) closeConfirm();
  };
}

function closeConfirm() {
  const ov = document.getElementById("confirm_overlay");
  if (ov) {
    ov.style.display = "none";
    ov.onclick = null;
  }
  state.confirmCb = null;
}

function doConfirm() {
  try {
    if (typeof state.confirmCb === "function") state.confirmCb();
  } finally {
    closeConfirm();
  }
}

function confirmDeleteTrack(id) {
  openConfirm("Delete this track?", function () {
    deleteTrack(id);
  });
}
function confirmDeleteAlert(id) {
  openConfirm("Delete this alert?", function () {
    deleteAlert(id);
  });
}
async function deleteTrack(id) {
  const headers = { Authorization: "Bearer " + state.token };
  await fetch("/api/admin/tracks/" + id, { method: "DELETE", headers });
  loadData();
}
async function deleteAlert(id) {
  const headers = { Authorization: "Bearer " + state.token };
  await fetch("/api/admin/alerts/" + id, { method: "DELETE", headers });
  loadData();
}
if (
  "serviceWorker" in navigator &&
  (location.protocol === "https:" || location.hostname === "localhost") &&
  window.isSecureContext
) {
  window.addEventListener("load", function () {
    navigator.serviceWorker
      .register("/service-worker.js")
      .catch(function () {});
  });
}
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", function (e) {
  e.preventDefault();
  deferredPrompt = e;
  var b = document.getElementById("install_btn_admin");
  if (b) b.style.display = "inline-flex";
});
window.addEventListener("appinstalled", function () {
  var b = document.getElementById("install_btn_admin");
  if (b) b.style.display = "none";
});
async function installAdminApp() {
  try {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    var b = document.getElementById("install_btn_admin");
    if (b) b.style.display = "none";
  } catch {}
}
function togglePassword(inputId, btnId) {
  const i = document.getElementById(inputId);
  const b = document.getElementById(btnId);
  if (!i || !b) return;
  const isPass = i.type === "password";
  i.type = isPass ? "text" : "password";
  b.textContent = isPass ? "🔓" : "🔒";
}

// --- CACHE-BUSTED API FETCH WITH PRELOADER ---
async function apiFetch(url, options = {}) {
  const {
    showLoader = true,
    loaderMessage = "Processing request...",
    ...fetchOptions
  } = options;

  if (showLoader) {
    showPreloader(loaderMessage);
  }

  const token =
    (typeof state !== "undefined" && state.token) ||
    localStorage.getItem("token") ||
    "";

  const separator = url.includes("?") ? "&" : "?";
  const cacheBustedUrl = `${url}${separator}_t=${Date.now()}`;

  const defaultHeaders = {
    Authorization: `Bearer ${token}`,
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Pragma: "no-cache",
  };

  try {
    const res = await fetch(cacheBustedUrl, {
      ...fetchOptions,
      cache: "no-store",
      headers: {
        ...defaultHeaders,
        ...(fetchOptions.headers || {}),
      },
    });
    return res;
  } finally {
    if (showLoader) {
      hidePreloader();
    }
  }
}

// Lightweight notification toaster helper
function showNotification(message, type = "success") {
  let notif = document.getElementById("toast_notification");

  if (!notif) {
    notif = document.createElement("div");
    notif.id = "toast_notification";
    notif.style.cssText = `
      position: fixed;
      top: 24px;
      right: 24px;
      padding: 12px 20px;
      border-radius: 8px;
      color: #fff;
      font-size: 14px;
      font-weight: 500;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      transition: opacity 0.3s ease, transform 0.3s ease;
      display: flex;
      align-items: center;
      gap: 8px;
      pointer-events: none;
    `;
    document.body.appendChild(notif);
  }

  const isSuccess = type === "success";
  notif.style.background = isSuccess ? "#10b981" : "#ef4444";
  notif.innerHTML = `
    <i class="fa-solid ${isSuccess ? "fa-circle-check" : "fa-circle-xmark"}"></i>
    <span>${message}</span>
  `;

  notif.style.opacity = "1";
  notif.style.transform = "translateY(0)";

  setTimeout(() => {
    notif.style.opacity = "0";
    notif.style.transform = "translateY(-10px)";
  }, 3000);
}

// --- CENTRALIZED PRELOADER HELPER ---
function showPreloader(message = "Processing request...") {
  let loader = document.getElementById("global_preloader");

  if (!loader) {
    loader = document.createElement("div");
    loader.id = "global_preloader";
    loader.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(15, 23, 42, 0.5);
      backdrop-filter: blur(3px);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 99999;
      opacity: 0;
      transition: opacity 0.2s ease;
      pointer-events: auto;
    `;

    loader.innerHTML = `
      <div style="
        background: #ffffff;
        padding: 24px 32px;
        border-radius: 12px;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.2);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
      ">
        <div class="preloader-spinner" style="
          width: 36px;
          height: 36px;
          border: 4px solid #e2e8f0;
          border-top: 4px solid var(--primary, #2563eb);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        "></div>
        <span id="preloader_text" style="
          font-size: 14px;
          font-weight: 600;
          color: #334155;
        ">${message}</span>
      </div>
    `;

    // Inject spinner CSS animation dynamically if not present
    if (!document.getElementById("preloader_styles")) {
      const style = document.createElement("style");
      style.id = "preloader_styles";
      style.innerHTML = `@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`;
      document.head.appendChild(style);
    }

    document.body.appendChild(loader);
  }

  document.getElementById("preloader_text").innerText = message;
  loader.style.display = "flex";
  // Trigger reflow for CSS transition
  void loader.offsetWidth;
  loader.style.opacity = "1";
}

function hidePreloader() {
  const loader = document.getElementById("global_preloader");
  if (!loader) return;

  loader.style.opacity = "0";
  setTimeout(() => {
    loader.style.display = "none";
  }, 200);
}
