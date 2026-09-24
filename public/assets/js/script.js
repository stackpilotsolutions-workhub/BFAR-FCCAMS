const state = {
  token: localStorage.getItem("fish_token"),
  user: JSON.parse(localStorage.getItem("fish_user") || "null"),
  watchId: null,
  lastPos: null,
  currentModule: null,
  refreshTimer: null,
  myCatchesData: [],
  myActivityData: [],
  catchLoc: null,
  isTracking: false,
  trackMap: null,
  trackMarker: null,
  trackAccuracyCircle: null,
  trackRoute: null,
  trackRoutePts: [],
  trackRouteLastKey: null,
  status: "transit",
  statusAt: null,
  lastTrackSentAt: 0,
  lastTrackSentPos: null,
  dashboardMap: null,
  dashboardMarkers: new Map(),
  catchChart: null,
};

const PALETTE = [
  "#0077B6",
  "#00B4D8",
  "#06D6A0",
  "#FFB703",
  "#EF476F",
  "#9B5DE5",
  "#00BBF9",
  "#F15BB5",
];

let vesselsData = [];
let editingVesselId = null;
window.fishingGearsData = window.fishingGearsData || [];

let _redirectingToLogin = false;
function handleAuthFailure() {
  if (_redirectingToLogin) return;
  _redirectingToLogin = true;
  window._authInvalidated = true;
  try {
    if (state.watchId != null) {
      navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
    }
  } catch {}
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
  state.token = null;
  state.user = null;
  try {
    localStorage.removeItem("fish_token");
    localStorage.removeItem("fish_user");
  } catch {}
  try {
    if (window._liveES) {
      window._liveES.close();
      window._liveES = null;
    }
  } catch {}
  location.href = "/login.html";
}
// Ingest OAuth callback ?token=&user= before redirect check
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

// Redirect if not logged in
if (!state.token) {
  location.href = "/login.html";
} else {
  const initUser = () => {
    try {
      setAuth(state.token, state.user);
    } catch {}
    try {
      loadSpecies();
    } catch {}
    try {
      enablePush();
    } catch {}
  };
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", initUser);
  } else {
    initUser();
  }
}

function setAuth(token, user) {
  state.token = token;
  state.user = user;
  document.body.classList.remove("auth-bg");
  document.getElementById("app").style.display = "";
  document.getElementById("logout_btn").style.display = "";

  // Update Navbar User Info
  if (user) {
    document.getElementById("user_profile").style.display = "block";
    document.getElementById("user_name").textContent = user.name || user.email;
    const displayRole =
      user.role === "inspector"
        ? "NSAP Data Enumerator"
        : user.role || "No role";
    document.getElementById("user_role").textContent = displayRole;
  }

  showModule("dashboard");
  loadMyCatches();
  setupAutoRefreshUser();
  loadMyStatus();
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function logout() {
  if (document.getElementById("logoutModal")) return;

  // Embedded Styles for Animations & Layout
  if (!document.getElementById("logoutModalStyles")) {
    const style = document.createElement("style");
    style.id = "logoutModalStyles";
    style.textContent = `
      @keyframes modalFadeIn {
        from { opacity: 0; transform: scale(0.95) translateY(10px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      .logout-spinner {
        width: 32px;
        height: 32px;
        border: 3px solid #eaf7ff;
        border-top-color: #0077b6;
        border-radius: 50%;
        animation: spin 0.75s linear infinite;
        margin: 0 auto;
      }
      .logout-btn-action {
        flex: 1;
        padding: 12px;
        border-radius: 10px;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .logout-btn-cancel {
        border: 1.5px solid #bde0fe;
        background: #ffffff;
        color: #023047;
      }
      .logout-btn-cancel:hover {
        background: #f4fafd;
        border-color: #0077b6;
      }
      .logout-btn-confirm {
        border: none;
        background: #ef476f;
        color: #ffffff;
        box-shadow: 0 4px 12px rgba(239, 71, 111, 0.25);
      }
      .logout-btn-confirm:hover {
        background: #d9385e;
        transform: translateY(-1px);
        box-shadow: 0 6px 16px rgba(239, 71, 111, 0.35);
      }
      .cleanup-step {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 13px;
        color: #4f5d75;
        padding: 6px 0;
        text-align: left;
        border-bottom: 1px dashed #eaf7ff;
      }
      .cleanup-step i {
        font-size: 14px;
        width: 16px;
      }
    `;
    document.head.appendChild(style);
  }

  const modalOverlay = document.createElement("div");
  modalOverlay.id = "logoutModal";
  modalOverlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(2, 48, 71, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;

  modalOverlay.innerHTML = `
    <div id="logoutCard" style="
      background: #ffffff;
      padding: 32px 28px;
      border-radius: 20px;
      box-shadow: 0 20px 45px rgba(2, 48, 71, 0.22);
      max-width: 380px;
      width: 90%;
      text-align: center;
      border: 1px solid #bde0fe;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      animation: modalFadeIn 0.2s ease-out forwards;
    ">
      <div id="logoutIconBox" style="
        width: 64px;
        height: 64px;
        background: #eaf7ff;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 16px auto;
      ">
        <i class="fa-solid fa-right-from-bracket" style="font-size: 26px; color: #0077b6;"></i>
      </div>

      <h3 id="logoutTitle" style="margin: 0 0 8px 0; color: #023047; font-size: 20px; font-weight: 800; letter-spacing: -0.01em;">
        Signing Out
      </h3>

      <p id="logoutSubtitle" style="margin: 0 0 24px 0; color: #4f5d75; font-size: 13.5px; line-height: 1.45;">
        Are you sure you want to end your current session?
      </p>

      <div id="logoutProgressArea" style="display: none; margin-bottom: 20px;"></div>

      <div id="logoutActions" style="display: flex; gap: 12px;">
        <button class="logout-btn-action logout-btn-cancel" onclick="closeLogoutModal()">Cancel</button>
        <button class="logout-btn-action logout-btn-confirm" onclick="proceedLogout()">Logout</button>
      </div>
    </div>
  `;

  document.body.appendChild(modalOverlay);
}

function closeLogoutModal() {
  const modal = document.getElementById("logoutModal");
  if (modal) modal.remove();
}

async function proceedLogout() {
  const iconBox = document.getElementById("logoutIconBox");
  const title = document.getElementById("logoutTitle");
  const subtitle = document.getElementById("logoutSubtitle");
  const actions = document.getElementById("logoutActions");
  const progressArea = document.getElementById("logoutProgressArea");

  // Switch UI to active cleanup mode
  actions.style.display = "none";
  subtitle.style.display = "none";
  progressArea.style.display = "block";

  iconBox.style.background = "#ffffff";
  iconBox.innerHTML = `<div class="logout-spinner"></div>`;
  title.textContent = "Cleaning Up Session...";

  const steps = [
    { id: "step-track", label: "Stopping location tracking..." },
    { id: "step-geo", label: "Clearing geo location watch..." },
    { id: "step-state", label: "Clearing active timers & state..." },
    { id: "step-storage", label: "Clearing local storage..." },
  ];

  progressArea.innerHTML = steps
    .map(
      (s) => `
    <div class="cleanup-step" id="${s.id}">
      <i class="fa-regular fa-circle" style="color: #8d99ae;"></i>
      <span>${s.label}</span>
    </div>
  `,
    )
    .join("");

  const updateStep = (id, status) => {
    const el = document.getElementById(id);
    if (!el) return;
    const icon = el.querySelector("i");
    if (status === "active") {
      icon.className = "fa-solid fa-spinner";
      icon.style.animation = "spin 0.8s linear infinite";
      icon.style.color = "#0077b6";
      el.style.color = "#023047";
      el.style.fontWeight = "600";
    } else if (status === "done") {
      icon.className = "fa-solid fa-circle-check";
      icon.style.animation = "none";
      icon.style.color = "#06d6a0";
      el.style.color = "#4f5d75";
      el.style.fontWeight = "400";
    } else if (status === "error") {
      icon.className = "fa-solid fa-circle-exclamation";
      icon.style.animation = "none";
      icon.style.color = "#ef476f";
    }
  };

  try {
    // Step 1: Track Stop
    updateStep("step-track", "active");
    await delay(350);
    if (state.token && state.watchId != null) {
      try {
        await fetch("/api/track/stop", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + state.token,
          },
          body: JSON.stringify({
            at: new Date().toISOString(),
            reason: "logout",
          }),
          keepalive: true,
        });
      } catch {}
    }
    updateStep("step-track", "done");

    // Step 2: Geo Watcher
    updateStep("step-geo", "active");
    await delay(350);
    if (state.watchId != null) {
      try {
        navigator.geolocation.clearWatch(state.watchId);
      } catch {}
      state.watchId = null;
    }
    updateStep("step-geo", "done");

    // Step 3: Reset Timers & Memory
    updateStep("step-state", "active");
    await delay(350);
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }
    state.token = null;
    state.user = null;
    updateStep("step-state", "done");

    // Step 4: Storage Reset
    updateStep("step-storage", "active");
    await delay(350);
    localStorage.removeItem("fish_token");
    localStorage.removeItem("fish_user");
    updateStep("step-storage", "done");

    // Final Success State
    iconBox.style.background = "#e6fdf5";
    iconBox.innerHTML = `<i class="fa-solid fa-check" style="font-size: 28px; color: #06d6a0;"></i>`;
    title.textContent = "Logged Out!";

    if (typeof showToast === "function") {
      showToast("Logged out successfully.", "success");
    }

    await delay(500);
    location.href = "/login.html";
  } catch (error) {
    iconBox.style.background = "#ffeef2";
    iconBox.innerHTML = `<i class="fa-solid fa-xmark" style="font-size: 28px; color: #ef476f;"></i>`;
    title.textContent = "Logout Error";

    if (typeof showToast === "function") {
      showToast("Session cleared with warnings.", "error");
    }

    // Force Cleanup Fallback
    localStorage.removeItem("fish_token");
    localStorage.removeItem("fish_user");

    await delay(1000);
    location.href = "/login.html";
  }
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function updateLocationState(valid) {
  const ids = [
    "btn_add_waypoint",
    "btn_submit_act",
    "btn_submit_act_upload",
    "btn_submit_catch",
    "btn_upload_catch",
    "btn_cam_upload",
    "btn_cam_attach",
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !valid;
  });
  const msgIds = ["act_msg", "catch_msg", "cam_loc_msg"];
  if (valid) {
    msgIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el && el.textContent === "Waiting for location signal...") {
        el.textContent = "";
        el.className = "small";
      }
    });
  } else {
    msgIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = "Waiting for location signal...";
        el.className = "small";
      }
    });
  }
}

function updateCatchCoords(lat, lng) {
  const loc = state.catchLoc || { lat, lng };
  const txt = document.getElementById("catch_coords_text");
  if (txt) txt.textContent = `${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}`;
}

function resetCatchLocation() {
  state.catchLoc = null;
  if (state.lastPos) updateCatchCoords(state.lastPos.lat, state.lastPos.lng);
}
function setTrackingUi(active, msg, cls) {
  const isTracking = !!active;
  state.isTracking = isTracking;

  const startBtn = document.getElementById("btn_start_tracking");
  const stopBtn = document.getElementById("btn_stop_tracking");

  // Synchronize Start button state and classes
  if (startBtn) {
    startBtn.disabled = isTracking;
    startBtn.classList.toggle("disabled", isTracking);
    startBtn.classList.toggle("active", !isTracking);
    startBtn.setAttribute("aria-disabled", String(isTracking));
  }

  // Synchronize Stop button state and classes
  if (stopBtn) {
    stopBtn.disabled = !isTracking;
    stopBtn.classList.toggle("disabled", !isTracking);
    stopBtn.classList.toggle("active", isTracking);
    stopBtn.setAttribute("aria-disabled", String(!isTracking));
  }

  // Update status message banner
  const el = document.getElementById("track_msg");
  if (el && msg != null) {
    el.textContent = msg;
    el.className = cls || "small";
  }
}

function setTrackMapStatus(text, cls) {
  const el = document.getElementById("track_map_status");
  if (!el) return;
  el.textContent = text || "";
  el.className = cls || "small";
}

function initTrackMap() {
  const el = document.getElementById("track_map");
  if (!el) return;

  if (!window.L) {
    setTrackMapStatus("Map library failed to load", "small error");
    return;
  }

  if (state.trackMap) {
    try {
      state.trackMap.invalidateSize();
    } catch {}
    return;
  }

  const map = window.L.map(el, { zoomControl: true });

  window.L.tileLayer("/api/public/tiles/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  // Fallback to state.lastPos or saved localStorage coordinates
  const savedPos = state.lastPos || readLastLocation();
  const fallback =
    savedPos && Number.isFinite(savedPos.lat) && Number.isFinite(savedPos.lng)
      ? [Number(savedPos.lat), Number(savedPos.lng)]
      : [18.256, 122.202];

  map.setView(fallback, savedPos ? 14 : 10);
  state.trackMap = map;
  setTrackMapStatus("");
}

function clearTrackRoute() {
  if (state.trackRoute) {
    try {
      state.trackRoute.remove();
    } catch {}
  }
  state.trackRoute = null;
  state.trackRoutePts = [];
  state.trackRouteLastKey = null;
}

function ensureTrackRoute() {
  initTrackMap();
  if (!state.trackMap || !window.L) return;

  if (!state.trackRoute) {
    state.trackRoute = window.L.polyline([], {
      color: "#34c759",
      weight: 3,
      opacity: 0.85,
    });
    state.trackRoute.addTo(state.trackMap);
    state.trackRoutePts = [];
    state.trackRouteLastKey = null;
  }
}
async function postStatus(status, lat, lng, at) {
  if (!state.token) throw new Error("Please login first");
  const payload = { status, at: at || new Date().toISOString() };
  if (lat != null && Number.isFinite(Number(lat))) payload.lat = Number(lat);
  if (lng != null && Number.isFinite(Number(lng))) payload.lng = Number(lng);

  const r = await fetch("/api/status", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + state.token,
    },
    body: JSON.stringify(payload),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Failed to update status");
  return d.item || null;
}

// Helper to keep Fish Catch Logging updated in real-time as movement occurs
function broadcastLocationUpdate(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  // 1. Update form input fields if present
  const latInput =
    document.getElementById("catch_latitude") ||
    document.getElementById("catch_lat");
  const lngInput =
    document.getElementById("catch_longitude") ||
    document.getElementById("catch_lng");

  if (latInput) latInput.value = lat.toFixed(6);
  if (lngInput) lngInput.value = lng.toFixed(6);

  // 2. Call specialized catch logging handler functions if declared
  if (typeof updateCatchCoords === "function") {
    updateCatchCoords(lat, lng);
  }
  if (typeof updateLocationState === "function") {
    updateLocationState(true);
  }
}

async function getFreshPosition() {
  try {
    await ensureGpsAvailable();
  } catch {
    return state.lastPos &&
      Number.isFinite(state.lastPos.lat) &&
      Number.isFinite(state.lastPos.lng)
      ? { lat: state.lastPos.lat, lng: state.lastPos.lng }
      : null;
  }
  const opts = { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 };
  const pos = await new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(p),
      () => resolve(null),
      opts,
    ),
  );
  if (pos && pos.coords) {
    const lat = Number(pos.coords.latitude);
    const lng = Number(pos.coords.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng))
      return {
        lat,
        lng,
        accuracy:
          pos.coords.accuracy != null ? Number(pos.coords.accuracy) : null,
        heading: pos.coords.heading != null ? Number(pos.coords.heading) : null,
        speed: pos.coords.speed != null ? Number(pos.coords.speed) : null,
      };
  }
  return state.lastPos &&
    Number.isFinite(state.lastPos.lat) &&
    Number.isFinite(state.lastPos.lng)
    ? { lat: state.lastPos.lat, lng: state.lastPos.lng }
    : null;
}

function setStatusUi(status, at) {
  // Normalize string for safe matching
  const normalizedStatus = String(status || "transit")
    .toLowerCase()
    .trim();
  const isPort = normalizedStatus === "port" || normalizedStatus === "docked";

  // Match the exact display text expected by your UI
  const text = isPort ? "In Port" : "In Transit";

  const textElem = document.getElementById("status_text");
  const indicatorElem = document.getElementById("status_indicator");

  if (textElem) {
    textElem.textContent = text;
  }

  if (indicatorElem) {
    indicatorElem.style.backgroundColor = isPort
      ? "var(--warning)"
      : "var(--success)";
  }

  const when = document.getElementById("status_when");
  if (when) {
    // Format timestamp cleanly with a fallback for invalid dates
    if (at) {
      const parsedDate = new Date(at);
      when.textContent = !isNaN(parsedDate.getTime())
        ? parsedDate.toLocaleString()
        : "-";
    } else {
      when.textContent = "-";
    }
  }

  setTrackMapStatus(text, "small");
}

async function setStatus(nextStatus, opts) {
  const status = nextStatus === "port" ? "port" : "transit";
  const at = new Date().toISOString();

  // Obtain position before changing status so backend receives coordinates
  const p = await getFreshPosition();

  if (status === "port") {
    if (!p)
      throw new Error("No location available. Enable GPS to set Port status.");
    stopTracking({ skipNotify: true });
    const item = await postStatus("port", p.lat, p.lng, at);
    state.status = "port";
    state.statusAt = item && item.at ? item.at : at;
    setStatusUi("port", state.statusAt);
    updateTrackMapPosition({
      lat: p.lat,
      lng: p.lng,
      accuracy: p.accuracy,
      at: state.statusAt,
    });
    clearTrackRoute();
    return;
  }

  // Handle 'transit'
  const item = await postStatus(
    "transit",
    p && p.lat != null ? p.lat : undefined,
    p && p.lng != null ? p.lng : undefined,
    at,
  );
  state.status = "transit";
  state.statusAt = item && item.at ? item.at : at;
  setStatusUi("transit", state.statusAt);

  if (!(opts && opts.skipStartTracking)) startTracking();
}

async function loadMyStatus() {
  if (!state.token) return;
  try {
    const r = await fetch("/api/status/me", {
      headers: { Authorization: "Bearer " + state.token },
    });
    const d = await r.json();

    // 1. Recover Status
    const statusObj = d.status || {};
    const status = statusObj.status ? String(statusObj.status) : "transit";
    state.status = status === "port" ? "port" : "transit";
    state.statusAt = statusObj.at ? String(statusObj.at) : null;
    setStatusUi(state.status, state.statusAt);

    // 2. Recover Last Coordinates
    const lastTrack = d.lastTrack;
    const lat =
      lastTrack?.latitude ?? statusObj?.latitude ?? readLastLocation()?.lat;
    const lng =
      lastTrack?.longitude ?? statusObj?.longitude ?? readLastLocation()?.lng;

    if (
      lat != null &&
      lng != null &&
      Number.isFinite(Number(lat)) &&
      Number.isFinite(Number(lng))
    ) {
      const pos = {
        lat: Number(lat),
        lng: Number(lng),
        at: lastTrack?.recorded_at || statusObj?.at,
      };
      state.lastPos = pos;

      const coordsEl = document.getElementById("cur_coords");
      if (coordsEl)
        coordsEl.textContent = `${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}`;

      // Broadcast position to catch logging forms immediately
      broadcastLocationUpdate(pos.lat, pos.lng);
      updateTrackMapPosition(pos);
    }

    // 3. Prevent duplicate starts & align UI with active transit state
    const isCurrentlyTransit = state.status === "transit";

    if (d.isTracking || isCurrentlyTransit) {
      setTrackingUi(
        true,
        isCurrentlyTransit
          ? "In Transit (Tracking Active)"
          : "Resuming GPS tracking...",
        "small success",
      );
      if (!state.watchId && isCurrentlyTransit) {
        startTracking();
      }
    } else {
      setTrackingUi(false, "In Port - Not tracking", "small");
    }
  } catch (err) {
    console.error("Failed to restore status state:", err);
    state.status = state.status || "transit";
    setStatusUi(state.status, state.statusAt || null);
  }
}

function updateTrackMapPosition(p) {
  if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;
  initTrackMap();
  if (!state.trackMap || !window.L) return;
  const isPort = state.status === "port";
  const markerColor = isPort ? "#ff9500" : "#34c759";
  const markerRadius = isPort ? 8 : 7;
  if (!state.trackMarker) {
    state.trackMarker = window.L.circleMarker([p.lat, p.lng], {
      radius: markerRadius,
      color: markerColor,
      weight: 2,
      opacity: 1,
      fillColor: markerColor,
      fillOpacity: 0.9,
    });
    state.trackMarker.addTo(state.trackMap);
  } else {
    state.trackMarker.setLatLng([p.lat, p.lng]);
    try {
      if (state.trackMarker.setRadius)
        state.trackMarker.setRadius(markerRadius);
    } catch {}
    if (state.trackMarker.setStyle) {
      try {
        state.trackMarker.setStyle({
          color: markerColor,
          fillColor: markerColor,
        });
      } catch {}
    }
  }
  if (p.accuracy != null && Number.isFinite(p.accuracy) && p.accuracy > 0) {
    if (!state.trackAccuracyCircle) {
      state.trackAccuracyCircle = window.L.circle([p.lat, p.lng], {
        radius: p.accuracy,
        weight: 1,
        opacity: 0.5,
        fillOpacity: 0.08,
      });
      state.trackAccuracyCircle.addTo(state.trackMap);
    } else {
      state.trackAccuracyCircle.setLatLng([p.lat, p.lng]);
      state.trackAccuracyCircle.setRadius(p.accuracy);
    }
  }
  if (state.status === "transit") {
    ensureTrackRoute();
    const key = p.at || p.recordedAt || String(Date.now());
    if (key && key !== state.trackRouteLastKey) {
      const pts = state.trackRoutePts || [];
      pts.push([p.lat, p.lng]);
      if (pts.length > 300) pts.shift();
      state.trackRoutePts = pts;
      try {
        if (state.trackRoute) state.trackRoute.setLatLngs(pts);
      } catch {}
      state.trackRouteLastKey = key;
    }
  } else {
    clearTrackRoute();
  }
  try {
    state.trackMap.setView(
      [p.lat, p.lng],
      Math.max(state.trackMap.getZoom(), 14),
      { animate: false },
    );
  } catch {}
}

function readLastLocation() {
  try {
    const raw = localStorage.getItem("last_location");
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;
    return p;
  } catch {
    return null;
  }
}

function saveLastLocation(p) {
  try {
    localStorage.setItem(
      "last_location",
      JSON.stringify({
        lat: p.lat,
        lng: p.lng,
        at: p.at || new Date().toISOString(),
      }),
    );
  } catch {}
}

async function ensureGpsAvailable() {
  if (!navigator.geolocation) throw new Error("Geolocation not supported");
  if (navigator.permissions && navigator.permissions.query) {
    try {
      const s = await navigator.permissions.query({ name: "geolocation" });
      if (s && s.state === "denied")
        throw new Error("Location permission denied");
    } catch {}
  }
  return true;
}

async function startTracking() {
  if (!state.token) {
    setTrackingUi(false, "Please login first", "small error");
    return;
  }
  if (state.watchId != null) return;

  setTrackingUi(true, "Acquiring GPS fix...", "small");

  try {
    initTrackMap();
    await ensureGpsAvailable();
  } catch (e) {
    setTrackingUi(false, e.message || "GPS not available", "small error");
    return;
  }

  // Get initial location fix before firing status or tracking endpoints
  const initialPos = await getFreshPosition();
  if (!initialPos) {
    setTrackingUi(false, "Unable to get current location fix", "small error");
    return;
  }

  // Sync state if not currently in transit
  if (state.status !== "transit") {
    try {
      await setStatus("transit", { skipStartTracking: true });
    } catch (e) {
      setTrackingUi(
        false,
        e.message || "Failed to set transit status",
        "small error",
      );
      return;
    }
  }

  const sendTrack = async (payload) => {
    try {
      await fetch("/api/track", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + state.token,
        },
        body: JSON.stringify(payload),
      });
      state.lastTrackSentAt = Date.now();
      state.lastTrackSentPos = { lat: payload.lat, lng: payload.lng };
    } catch (err) {
      console.error("Error sending initial track:", err);
    }
  };

  // Seed application state with initial position
  const p0 = {
    lat: initialPos.lat,
    lng: initialPos.lng,
    accuracy: initialPos.accuracy,
    heading: initialPos.heading,
    speed: initialPos.speed,
    at: new Date().toISOString(),
  };

  state.lastPos = { lat: p0.lat, lng: p0.lng };
  const coordsEl = document.getElementById("cur_coords");
  if (coordsEl)
    coordsEl.textContent = `${p0.lat.toFixed(6)}, ${p0.lng.toFixed(6)}`;

  if (typeof updateCatchCoords === "function")
    updateCatchCoords(p0.lat, p0.lng);
  if (typeof updateLocationState === "function") updateLocationState(true);

  updateTrackMapPosition(p0);
  saveLastLocation(p0);

  // Send initial point to /api/track
  await sendTrack({
    lat: p0.lat,
    lng: p0.lng,
    accuracy: p0.accuracy,
    heading: p0.heading,
    speed: p0.speed,
    recordedAt: p0.at,
  });

  setTrackMapStatus("Following your GPS position", "small");
  setTrackingUi(true, "Tracking active", "small success");

  // Begin watchPosition loop
  const opts = { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 };
  state.watchId = navigator.geolocation.watchPosition(
    async (pos) => {
      if (!pos || !pos.coords) return;
      const lat = Number(pos.coords.latitude);
      const lng = Number(pos.coords.longitude);
      const accuracy =
        pos.coords.accuracy != null ? Number(pos.coords.accuracy) : null;
      const heading =
        pos.coords.heading != null ? Number(pos.coords.heading) : null;
      const speed = pos.coords.speed != null ? Number(pos.coords.speed) : null;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      state.lastPos = { lat, lng };
      if (coordsEl)
        coordsEl.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

      if (typeof updateCatchCoords === "function") updateCatchCoords(lat, lng);
      if (typeof updateLocationState === "function") updateLocationState(true);

      updateTrackMapPosition({ lat, lng, accuracy });
      saveLastLocation({ lat, lng, at: new Date().toISOString() });

      const minDistEl = document.getElementById("min_dist");
      const minIntEl = document.getElementById("min_int");
      const minDist = Math.max(
        0,
        parseFloat(minDistEl ? minDistEl.value : 0) || 0,
      );
      const minInt = Math.max(
        0,
        (parseFloat(minIntEl ? minIntEl.value : 0) || 0) * 1000,
      );
      const now = Date.now();

      const moved = state.lastTrackSentPos
        ? haversineMeters(
            state.lastTrackSentPos.lat,
            state.lastTrackSentPos.lng,
            lat,
            lng,
          )
        : Infinity;
      const okTime = now - (state.lastTrackSentAt || 0) >= minInt;
      const okMove = moved >= minDist;

      if (accuracy != null && Number.isFinite(accuracy) && accuracy > 1500) {
        setTrackingUi(
          true,
          "Poor GPS accuracy. Move to open area or wait...",
          "small warning",
        );
      } else {
        setTrackingUi(true, "Tracking active", "small success");
      }

      if (!okTime || !okMove) return;
      try {
        await sendTrack({
          lat,
          lng,
          accuracy,
          heading,
          speed,
          recordedAt: new Date().toISOString(),
        });
      } catch {}
    },
    (err) => {
      if (err && err.code === 1) {
        setTrackingUi(
          false,
          "Access denied. Allow location permission.",
          "small error",
        );
        stopTracking();
      } else if (err && err.code === 3) {
        setTrackingUi(true, "GPS timeout. Retrying...", "small warning");
      } else {
        setTrackingUi(true, "GPS signal issue.", "small warning");
      }
    },
    opts,
  );
}

async function stopTracking(opts) {
  const wasTracking = state.watchId != null;

  if (state.watchId != null) {
    try {
      navigator.geolocation.clearWatch(state.watchId);
    } catch {}
    state.watchId = null;
  }

  setTrackingUi(false, "Stopping tracking...", "small");

  try {
    // Post "port" status to database to complete the journey record
    if (!(opts && opts.skipNotify)) {
      await setStatus("port", { skipStartTracking: true });
    }
    setTrackingUi(false, "Journey complete (In Port)", "small");
  } catch (err) {
    console.error("Error setting port status:", err);
    setTrackingUi(
      false,
      "Stopped, but failed to update status to Port",
      "small error",
    );
  }

  setTrackMapStatus("Not tracking", "small");
}

window.addEventListener("beforeunload", function () {
  if (!state.token || state.watchId == null) return;
  try {
    fetch("/api/track/stop", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + state.token,
      },
      body: JSON.stringify({ at: new Date().toISOString(), reason: "unload" }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
});

async function handleCatchSubmit() {
  const speciesSel = document.getElementById("species").value;
  if (!speciesSel) {
    showNotification("Please select a species", "error");
    return;
  }

  // 1. Enforce GPS location check for ALL submissions
  const loc = state.catchLoc || state.lastPos;
  if (!loc || loc.lat == null || loc.lng == null) {
    showNotification(
      "No GPS location detected. Please capture location before submitting.",
      "error",
    );
    return;
  }

  const fileInput = document.getElementById("photoFile");
  const file = fileInput ? fileInput.files[0] : null;

  try {
    let response;

    if (file) {
      const fd = new FormData();
      fd.append("species", speciesSel);
      fd.append("photo", file);

      // Explicitly append lat/lng as strings
      fd.append("lat", String(loc.lat));
      fd.append("lng", String(loc.lng));

      appendOptionalFields(fd);

      response = await apiFetch("/api/catches/upload", {
        method: "POST",
        body: fd,
        loaderMessage: "Uploading catch image and data...",
      });
    } else {
      const payload = {
        species: speciesSel,
        photoUrl: document.getElementById("photoUrl").value || null,
        lat: loc.lat,
        lng: loc.lng,
      };

      appendOptionalPayload(payload);

      response = await apiFetch("/api/catches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        loaderMessage: "Logging catch data...",
      });
    }

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Submission failed");

    showNotification("Catch logged successfully!", "success");
    loadMyCatches();
    if (typeof refreshDashboard === "function") refreshDashboard();
    resetCatchForm();
  } catch (e) {
    showNotification(e.message, "error");
  }
}

function resetCatchForm() {
  // 1. Reset standard HTML form elements (inputs, selects, textareas)
  const form = document.getElementById("catchForm"); // Change to your <form> ID if wrapping inputs
  if (form) {
    form.reset();
  } else {
    // Manual fallback if inputs are not inside a <form> tag
    const inputIds = [
      "species",
      "photoFile",
      "photoUrl",
      "fishingGear",
      "netType",
      "catch_vessel_id",
      "note",
      "weight",
      "length",
      "hours_fished",
      "num_hooks_panels",
      "num_hauls",
    ];

    inputIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        if (el.tagName === "SELECT") {
          el.selectedIndex = 0;
        } else {
          el.value = "";
        }
      }
    });
  }

  // 2. Clear state variables for location
  if (typeof state !== "undefined") {
    state.catchLoc = null;
  }

  // 3. Reset image preview UI elements (if applicable)
  const imagePreview = document.getElementById("photoPreview");
  if (imagePreview) {
    imagePreview.src = "";
    imagePreview.style.display = "none";
  }

  // 4. Reset location status indicators/labels in UI
  const locStatus = document.getElementById("locationStatus");
  if (locStatus) {
    locStatus.textContent = "Location cleared. Tap to recapture GPS.";
    locStatus.classList.remove("text-success");
  }
}

// Initialize default month value on page load
document.addEventListener("DOMContentLoaded", () => {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  document.getElementById("reportMonth").value = `${yyyy}-${mm}`;
});

async function generateReport() {
  const selectedMonth = document.getElementById("reportMonth").value;
  if (!selectedMonth) {
    alert("Please select a month");
    return;
  }

  const token =
    localStorage.getItem("fish_token") || sessionStorage.getItem("fish_token");

  if (!token) {
    alert("Session expired or token missing. Please log in again.");
    return;
  }

  try {
    const res = await fetch(`/api/reports/monthly?month=${selectedMonth}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) throw new Error("Failed to load report data");

    const data = await res.json();

    // Toggle container display
    document.getElementById("reportPlaceholder").style.display = "none";
    document.getElementById("reportContainer").style.display = "block";

    // Helper function to set element text content safely
    const setSafeText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    // Update Header Metadata safely
    setSafeText("lblReportMonth", selectedMonth);
    setSafeText("lblEnumerator", data.profile?.name || "N/A");
    setSafeText(
      "lblLandingCenter",
      data.profile?.landing_center ||
        data.profile?.barangay ||
        "Not Identified",
    );
    setSafeText("lblMunicipality", data.profile?.municipality || "N/A");

    // Build the NSAP Form 1 tables and calendar
    renderSampleDatesGrid(data.catches, selectedMonth);
    renderLandingByGearTable(data.catches);
    renderSpeciesTable(data.catches);
  } catch (err) {
    console.error("Report generation error:", err);
    alert("Error generating report: " + err.message);
  }
}

// Updated JS function to render dates as 1-31 in 12 columns matching the form image
function renderSampleDatesGrid(catches, selectedMonth) {
  const grid = document.getElementById("calendarGrid");
  if (!grid) return;

  const sampledDays = new Set(
    catches.map((item) => new Date(item.captured_at).getDate()),
  );

  const [year, month] = selectedMonth.split("-").map(Number);
  const totalDays = selectedMonth ? new Date(year, month, 0).getDate() : 31;

  let html = "";
  for (let d = 1; d <= 31; d++) {
    if (d <= totalDays) {
      const isSampled = sampledDays.has(d);
      const style = isSampled
        ? "display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border:1px solid #000; border-radius:50%; font-weight:bold; line-height:1;"
        : "display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; line-height:1;";
      html += `<span style="${style}">${d}</span>`;
    } else {
      html += `<span></span>`;
    }
  }
  grid.innerHTML = html;
}

// Helper to extract unique sorted days from catches
function getUniqueDates(catches) {
  const dates = catches.map((item) => new Date(item.captured_at).getDate());
  return [...new Set(dates)].sort((a, b) => a - b);
}

// Render Table 1: Landing by Gear
function renderLandingByGearTable(catches) {
  const table = document.getElementById("tblLandingByGear");
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");

  thead.innerHTML = "";
  tbody.innerHTML = "";

  if (catches.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="padding: 10px;">No records found for this month.</td></tr>`;
    return;
  }

  const sortedDays = getUniqueDates(catches);

  // Build Header Row
  let headerHTML = `<tr>
    <th style="width: 20%; text-align: left; padding-left: 6px;">Gear</th>
    <th style="width: 10%;">Date</th>`;
  sortedDays.forEach((day) => {
    headerHTML += `<th style="min-width: 30px;">${day}</th>`;
  });
  headerHTML += `<th style="min-width: 45px;">Total</th></tr>`;
  thead.innerHTML = headerHTML;

  // Aggregate catches
  const gearGroup = {};
  catches.forEach((item) => {
    const gearName = item.gear || item.net_type || "Unspecified";
    const day = new Date(item.captured_at).getDate();
    const weight = Number(item.weight || 0);

    if (!gearGroup[gearName]) gearGroup[gearName] = {};
    if (!gearGroup[gearName][day])
      gearGroup[gearName][day] = { boats: 0, weight: 0 };

    gearGroup[gearName][day].boats += 1;
    gearGroup[gearName][day].weight += weight;
  });

  // Build Table Body Rows
  let bodyHTML = "";
  Object.keys(gearGroup).forEach((gear) => {
    let totalBoats = 0;
    let totalWeight = 0;

    let boatsCells = "";
    let catchCells = "";

    sortedDays.forEach((day) => {
      const data = gearGroup[gear][day];
      if (data) {
        totalBoats += data.boats;
        totalWeight += data.weight;
        boatsCells += `<td>${data.boats}</td>`;
        catchCells += `<td>${data.weight.toFixed(1)}</td>`;
      } else {
        boatsCells += `<td style="color: #ccc;">-</td>`;
        catchCells += `<td style="color: #ccc;">-</td>`;
      }
    });

    bodyHTML += `
      <tr>
        <td rowspan="2" style="font-weight:bold; vertical-align:middle; text-align:left; padding-left: 6px;">${gear}</td>
        <td>Boats</td>
        ${boatsCells}
        <td style="font-weight:bold;">${totalBoats}</td>
      </tr>
      <tr>
        <td>Catch</td>
        ${catchCells}
        <td style="font-weight:bold;">${totalWeight.toFixed(1)}</td>
      </tr>
    `;
  });

  tbody.innerHTML = bodyHTML;
}

// Render Table 2: Length Frequency (Exact layout as Image 1)
function renderSpeciesTable(catches) {
  const table = document.getElementById("tblSpeciesFrequency");
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");

  thead.innerHTML = "";
  tbody.innerHTML = "";

  if (catches.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="padding: 10px;">No species records found.</td></tr>`;
    return;
  }

  const sortedDays = getUniqueDates(catches);

  const dateMeta = {};
  const speciesData = {};

  sortedDays.forEach((day) => {
    dateMeta[day] = { boats: new Set(), totalWeight: 0 };
  });

  catches.forEach((item) => {
    const day = new Date(item.captured_at).getDate();
    const species = item.species || "Unknown Species";
    const weight = Number(item.weight || 0);

    if (item.vessel_name || item.vessel_id) {
      dateMeta[day].boats.add(item.vessel_name || item.vessel_id);
    }
    dateMeta[day].totalWeight += weight;

    if (!speciesData[species]) speciesData[species] = {};
    if (!speciesData[species][day]) speciesData[species][day] = 0;
    speciesData[species][day] += 1;
  });

  // Table header matching reference vertical column spans
  let dateHeaderRow = `<tr>
    <td rowspan="4" class="vertical-header-text" style="width: 25px; vertical-align: middle;">SAMPLE</td>
    <td style="width: 15%; text-align: center; font-weight: bold;">Date</td>`;

  let boatsHeaderRow = `<tr><td style="text-align: center;">Boats</td>`;
  let boxesHeaderRow = `<tr><td style="text-align: center;">Boxes</td>`;
  let kgHeaderRow = `<tr><td style="text-align: center;">Kg.</td>`;

  let grandTotalWeight = 0;

  sortedDays.forEach((day) => {
    const boatCount = dateMeta[day].boats.size || 1;
    const dayWeight = dateMeta[day].totalWeight;
    grandTotalWeight += dayWeight;

    dateHeaderRow += `<th style="min-width: 30px;">${day}</th>`;
    boatsHeaderRow += `<td>${boatCount}</td>`;
    boxesHeaderRow += `<td style="color: #ccc;">-</td>`;
    kgHeaderRow += `<td>${dayWeight.toFixed(1)}</td>`;
  });

  dateHeaderRow += `<th style="min-width: 45px;">Total</th></tr>`;
  boatsHeaderRow += `<td style="color: #ccc;">-</td></tr>`;
  boxesHeaderRow += `<td style="color: #ccc;">-</td></tr>`;
  kgHeaderRow += `<td style="font-weight:bold;">${grandTotalWeight.toFixed(1)}</td></tr>`;

  thead.innerHTML =
    dateHeaderRow + boatsHeaderRow + boxesHeaderRow + kgHeaderRow;

  // Species Matrix Rows with side vertical title matching reference
  let speciesKeys = Object.keys(speciesData);
  let bodyHTML = "";

  speciesKeys.forEach((species, index) => {
    let rowTotal = 0;
    let speciesCells = "";

    sortedDays.forEach((day) => {
      const count = speciesData[species][day] || 0;
      rowTotal += count;
      speciesCells += `<td>${count > 0 ? count : '<span style="color:#ccc;">-</span>'}</td>`;
    });

    let verticalSideCell = "";
    if (index === 0) {
      verticalSideCell = `<td rowspan="${speciesKeys.length}" class="vertical-header-text" style="width: 25px; vertical-align: middle;">NO. OF FISH MEASURED</td>`;
    }

    bodyHTML += `
      <tr>
        ${verticalSideCell}
        <td style="text-align: left; font-style: italic; padding-left: 6px;">${species}</td>
        ${speciesCells}
        <td style="font-weight: bold;">${rowTotal}</td>
      </tr>
    `;
  });

  tbody.innerHTML = bodyHTML;
}

// Action button handlers
function openMonitoringForm() {
  alert("Opening Monitoring Form view...");
}

function openSurveyForm() {
  alert("Opening Survey Form view...");
}

// Helper: Append non-file form values to FormData
function appendOptionalFields(fd) {
  const gearInput = document.getElementById("fishingGear").value || "";
  const netTypeEl = document.getElementById("netType");

  fd.append("netType", netTypeEl ? netTypeEl.value : gearInput);
  fd.append("gear", gearInput);
  fd.append("vesselId", document.getElementById("catch_vessel_id").value || "");
  fd.append("note", document.getElementById("note").value || "");

  const weight = parseFloat(document.getElementById("weight").value);
  const length = parseFloat(document.getElementById("length").value);
  const hours = parseFloat(document.getElementById("hours_fished").value);
  const hooks = parseInt(document.getElementById("num_hooks_panels").value);
  const hauls = parseInt(document.getElementById("num_hauls").value);

  if (isFinite(weight)) fd.append("weightKg", weight);
  if (isFinite(length)) fd.append("lengthCm", length);
  if (isFinite(hours)) fd.append("hoursFished", hours);
  if (isFinite(hooks)) fd.append("numHooksPanels", hooks);
  if (isFinite(hauls)) fd.append("numHauls", hauls);

  const loc = state.catchLoc || state.lastPos;
  if (loc) {
    fd.append("lat", loc.lat);
    fd.append("lng", loc.lng);
  }
}

async function loadMyCatches() {
  try {
    const r = await fetch("/api/catches/me", {
      headers: { Authorization: "Bearer " + state.token },
    });
    if (r.status === 401) {
      handleAuthFailure();
      return;
    }
    const d = await r.json();
    if (!r.ok) return;
    state.myCatchesData = Array.isArray(d) ? d : [];

    // Populate filter species
    const speciesSet = new Set(state.myCatchesData.map((c) => c.species));
    const sel = document.getElementById("filter_species");
    if (sel) {
      const current = sel.value;
      sel.innerHTML = '<option value="">All Species</option>';
      speciesSet.forEach((s) => {
        const opt = document.createElement("option");
        opt.value = s;
        opt.textContent = s;
        sel.appendChild(opt);
      });
      if (speciesSet.has(current)) sel.value = current;
    }

    renderMyCatches();
  } catch (e) {}
}

function renderMyCatches() {
  const raw = state.myCatchesData;
  const d = Array.isArray(raw) ? raw : [];
  const fSpec = (document.getElementById("filter_species") || {}).value || "";
  const fFrom = (document.getElementById("filter_date_from") || {}).value || "";
  const fTo = (document.getElementById("filter_date_to") || {}).value || "";

  let filtered = d.filter((c) => {
    if (fSpec && c.species !== fSpec) return false;
    const date = new Date(c.capturedAt || c.recorded_at || c.created_at || 0);
    if (fFrom && date < new Date(fFrom)) return false;
    if (fTo) {
      const toDate = new Date(fTo);
      toDate.setHours(23, 59, 59, 999);
      if (date > toDate) return false;
    }
    return true;
  });

  filtered.sort(
    (a, b) =>
      new Date(b.capturedAt || b.recorded_at || b.created_at || 0) -
      new Date(a.capturedAt || a.recorded_at || a.created_at || 0),
  );

  const countEl = document.getElementById("catches_count");
  if (countEl) countEl.textContent = `${filtered.length} catches logged`;

  const container = document.getElementById("catches_list");
  container.innerHTML = "";

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px; color: var(--text-muted);">
        <i class="fa-solid fa-fish-fins" style="font-size: 28px; margin-bottom: 8px; display: block; opacity: 0.5;"></i>
        No catches recorded matching your criteria.
      </div>`;
    return;
  }

  const esc = (s) =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const tableWrapper = document.createElement("div");
  tableWrapper.className = "table-container responsive-table-wrapper";

  const rowsHtml = filtered
    .map((c, index) => {
      const dateStr = new Date(
        c.capturedAt || c.recorded_at || c.created_at,
      ).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });

      const photoUrl = c.photoUrl || c.image_url;
      const evidenceHtml = photoUrl
        ? `<img src="${photoUrl}" class="table-evidence-thumb" onclick="window.open('${photoUrl}','_blank')" title="View Evidence" alt="Evidence" />`
        : `<span class="table-no-evidence"><i class="fa-solid fa-image-slash"></i></span>`;

      // Vessel & Coords
      const vName = c.vesselName || c.vessel_name || "";
      const latNum = parseFloat(c.lat != null ? c.lat : c.latitude);
      const lngNum = parseFloat(c.lng != null ? c.lng : c.longitude);
      const hasCoords = !isNaN(latNum) && !isNaN(lngNum);

      const locationStr = hasCoords
        ? `<a href="https://maps.google.com/?q=${latNum},${lngNum}" target="_blank" style="color:var(--primary); text-decoration:none;"><i class="fa-solid fa-location-dot"></i> ${latNum.toFixed(3)}, ${lngNum.toFixed(3)}</a>`
        : "—";

      return `
        <tr>
          <td>${evidenceHtml}</td>
          <td>
            <strong style="font-size: 14px; color: var(--text-main);">${esc(c.species)}</strong>
            ${c.note ? `<div style="font-size: 11px; font-style: italic; color: var(--text-muted); margin-top: 2px;">"${esc(c.note)}"</div>` : ""}
          </td>
          <td style="white-space: nowrap;">${dateStr}</td>
          <td style="white-space: nowrap;">${vName ? esc(vName) : "—"}</td>
          <td style="white-space: nowrap;">${locationStr}</td>
          <td style="white-space: nowrap; text-align: right;">
            <button class="btn-details" onclick="openCatchDetailsModal(${index})">
              <i class="fa-solid fa-circle-info"></i> Details
            </button>
          </td>
        </tr>
      `;
    })
    .join("");

  tableWrapper.innerHTML = `
    <table class="catches-table">
      <thead>
        <tr>
          <th>Evidence</th>
          <th>Species</th>
          <th>Date</th>
          <th>Vessel</th>
          <th>Location</th>
          <th style="text-align: right;">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `;

  container.appendChild(tableWrapper);

  // Store globally so the modal script can access filtered data
  window.currentFilteredCatches = filtered;
}

function openCatchDetailsModal(index) {
  const c = window.currentFilteredCatches
    ? window.currentFilteredCatches[index]
    : null;
  if (!c) return;

  const esc = (s) =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const dateStr = new Date(
    c.capturedAt || c.recorded_at || c.created_at,
  ).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const photoUrl = c.photoUrl || c.image_url;
  const latNum = parseFloat(c.lat != null ? c.lat : c.latitude);
  const lngNum = parseFloat(c.lng != null ? c.lng : c.longitude);
  const hasCoords = !isNaN(latNum) && !isNaN(lngNum);

  closeCatchDetailsModal();

  const modalHtml = `
    <div id="catch_details_modal" class="modal-overlay" onclick="if(event.target === this) closeCatchDetailsModal()">
      <div class="modal-card">
        <div class="modal-header">
          <h3>${esc(c.species)} Details</h3>
          <button type="button" class="modal-close-btn" onclick="closeCatchDetailsModal()" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">
          ${photoUrl ? `<div class="modal-image-container"><img src="${photoUrl}" alt="Catch Photo" /></div>` : ""}
          
          <div class="detail-grid">
            <div class="detail-item">
              <span class="detail-label">Captured Date</span>
              <span class="detail-value">${dateStr}</span>
            </div>
            
            <div class="detail-item">
              <span class="detail-label">Vessel</span>
              <span class="detail-value">${c.vesselName || c.vessel_name || "—"}</span>
            </div>

            <div class="detail-item">
              <span class="detail-label">Catch Metrics</span>
              <span class="detail-value">
                ${c.weightKg ? `<strong>${c.weightKg}</strong> kg` : ""} 
                ${c.weightKg && c.lengthCm ? " / " : ""} 
                ${c.lengthCm ? `<strong>${c.lengthCm}</strong> cm` : ""} 
                ${!c.weightKg && !c.lengthCm ? "—" : ""}
              </span>
            </div>

            <div class="detail-item">
              <span class="detail-label">Fishing Effort</span>
              <span class="detail-value">
                ${c.hoursFished != null ? `${Number(c.hoursFished).toFixed(1)} hrs` : ""} 
                ${c.hoursFished != null && c.numHauls != null ? " / " : ""} 
                ${c.numHauls != null ? `${c.numHauls} hauls` : ""} 
                ${c.hoursFished == null && c.numHauls == null ? "—" : ""}
              </span>
            </div>

            <div class="detail-item">
              <span class="detail-label">Gear Used</span>
              <div class="detail-value gear-wrapper">
                ${c.netType ? `<span class="table-tag">${esc(c.netType)}</span>` : ""} 
                ${c.numHooksPanels != null ? `<span>${c.numHooksPanels} hooks</span>` : ""}
                ${!c.netType && c.numHooksPanels == null ? "—" : ""}
              </div>
            </div>

            <div class="detail-item">
              <span class="detail-label">Location Coordinates</span>
              <span class="detail-value">
                ${hasCoords ? `<a href="https://maps.google.com/?q=${latNum},${lngNum}" target="_blank" style="color:var(--primary); text-decoration:none;"><i class="fa-solid fa-location-dot"></i> ${latNum.toFixed(6)},${lngNum.toFixed(6)}</a>` : "—"}
              </span>
            </div>
          </div>

          ${
            c.note
              ? `
            <div class="modal-notes">
              <span class="detail-label">Notes</span>
              <p>"${esc(c.note)}"</p>
            </div>
          `
              : ""
          }
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", modalHtml);
}

function closeCatchDetailsModal() {
  const modal = document.getElementById("catch_details_modal");
  if (modal) modal.remove();
}

async function loadMyActivity() {
  try {
    const r = await apiFetch("/api/activity_logs/me", {
      loaderMessage: "Loading activity history...",
    });

    if (r.status === 401) {
      if (typeof handleAuthFailure === "function") {
        handleAuthFailure();
      } else {
        showNotification("Session expired. Please log in again.", "error");
      }
      return;
    }

    if (!r.ok) {
      const errData = await r.json().catch(() => ({}));
      throw new Error(errData.error || "Failed to load activity logs.");
    }

    const d = await r.json();
    state.myActivityData = Array.isArray(d) ? d : [];
    renderMyActivity();
  } catch (err) {
    showNotification(err.message || "Unable to fetch activities.", "error");
  }
}

function renderMyActivity() {
  const raw = state.myActivityData;
  const d = Array.isArray(raw) ? raw : [];

  const fCatEl = document.getElementById("filter_act_cat");
  const fCat = fCatEl ? fCatEl.value : "";
  const fFromEl = document.getElementById("filter_act_date_from");
  const fFrom = fFromEl ? fFromEl.value : "";
  const fToEl = document.getElementById("filter_act_date_to");
  const fTo = fToEl ? fToEl.value : "";

  let filtered = d.filter((a) => {
    if (fCat && a.category !== fCat) return false;
    const date = new Date(a.created_at || 0);
    if (fFrom && date < new Date(fFrom)) return false;
    if (fTo) {
      const toDate = new Date(fTo);
      toDate.setHours(23, 59, 59, 999);
      if (date > toDate) return false;
    }
    return true;
  });

  filtered.sort(
    (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0),
  );

  const countEl = document.getElementById("activity_count");
  if (countEl)
    countEl.textContent = `${filtered.length} record${filtered.length === 1 ? "" : "s"} found`;

  const ul = document.getElementById("activity_list");
  if (!ul) return;
  ul.innerHTML = "";

  if (filtered.length === 0) {
    ul.innerHTML = `
      <li style="text-align:center; padding: 32px 16px; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 12px; color: #64748b; font-size: 14px;">
        <i class="fa-solid fa-folder-open" style="font-size: 28px; margin-bottom: 8px; color: #94a3b8; display: block;"></i>
        No activity records match your criteria.
      </li>`;
    return;
  }

  filtered.forEach((a) => {
    const li = document.createElement("li");
    li.className = "coastal-activity-card";

    const dateStr = a.created_at
      ? new Date(a.created_at).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "Unknown date";

    const imgUrl = a.photoUrl || a.image_url;
    const photoHtml = imgUrl
      ? `<div class="coastal-card-thumb" style="background-image:url('${imgUrl}')" onclick="window.open('${imgUrl}','_blank')">
           <i class="fa-solid fa-magnifying-glass-plus hover-icon"></i>
         </div>`
      : "";

    const lat = a.location?.lat ?? a.latitude ?? null;
    const lng = a.location?.lng ?? a.longitude ?? null;
    const locationHtml =
      lat !== null && lng !== null
        ? `<a href="https://maps.google.com/?q=${lat},${lng}" target="_blank" class="location-link">
             <i class="fa-solid fa-location-dot"></i> ${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}
           </a>`
        : `<span class="location-none"><i class="fa-solid fa-location-slash"></i> No coordinates</span>`;

    const noteText =
      typeof a.details === "object" ? a.details?.note : a.details;

    const categoryTag = (a.category || "General").toLowerCase();

    li.innerHTML = `
      <div class="coastal-card-header">
        <div class="coastal-title-group">
          <span class="coastal-badge category-${categoryTag}">${a.category || "General"}</span>
          <h4 class="coastal-activity-title">${(a.type || "Activity").replace(/_/g, " ")}</h4>
        </div>
        <span class="coastal-card-date"><i class="fa-regular fa-clock"></i> ${dateStr}</span>
      </div>

      <div class="coastal-card-body">
        ${photoHtml}
        <div class="coastal-card-details">
          ${
            noteText
              ? `<div class="coastal-note-box">
                   <i class="fa-solid fa-quote-left quote-icon"></i>
                   <span>${noteText}</span>
                 </div>`
              : ""
          }
          <div class="coastal-card-footer">
            ${locationHtml}
            ${
              Array.isArray(a.geom_line || a.line) &&
              (a.geom_line || a.line).length
                ? `<span class="route-tag"><i class="fa-solid fa-route"></i> ${(a.geom_line || a.line).length} waypoints</span>`
                : ""
            }
          </div>
        </div>
      </div>
    `;
    ul.appendChild(li);
  });
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

window.addEventListener("online", () => {});
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", function (e) {
  e.preventDefault();
  deferredPrompt = e;
  var b = document.getElementById("install_btn");
  if (b) b.style.display = "inline-flex";
});
window.addEventListener("appinstalled", function () {
  var b = document.getElementById("install_btn");
  if (b) b.style.display = "none";
});
async function installApp() {
  try {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    var b = document.getElementById("install_btn");
    if (b) b.style.display = "none";
  } catch {}
}

async function enablePush() {
  try {
    if (
      !("serviceWorker" in navigator) ||
      !(location.protocol === "https:" || location.hostname === "localhost") ||
      !window.isSecureContext
    )
      return;
    const cfg = await (await fetch("/api/public/config")).json();
    if (!cfg.vapidPublicKey) return;
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(cfg.vapidPublicKey),
    });
    // await fetch("/api/push/subscribe", {
    //   method: "POST",
    //   headers: {
    //     "Content-Type": "application/json",
    //     Authorization: "Bearer " + state.token,
    //   },
    //   body: JSON.stringify(sub),
    // });
  } catch {}
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
let activityRoute = [];
const ACTIVITY_OPTIONS = {
  fishing: [
    {
      value: "catching_fish",
      label: "Catching fish using nets, traps, or hand lines",
    },
    { value: "unloading_catch", label: "Unloading fish catch at the shore" },
    { value: "boat_launching_docking", label: "Boat launching and docking" },
  ],
  environmental: [
    { value: "mangrove_planting", label: "Mangrove planting" },
    { value: "coastal_cleanup", label: "Coastal clean-up" },
    { value: "monitoring_water_quality", label: "Monitoring water quality" },
    { value: "checking_coral_reef", label: "Checking coral reef conditions" },
  ],
  tourism: [
    { value: "swimming_snorkeling", label: "Swimming and snorkeling" },
    { value: "scuba_diving", label: "Scuba diving" },
    { value: "boating_kayaking", label: "Boating or kayaking" },
    { value: "beach_events", label: "Beach events" },
  ],
  maritime: [
    { value: "cargo_unloading", label: "Cargo unloading near small ports" },
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
    { value: "illegal_fishing", label: "Illegal fishing (dynamite, cyanide)" },
    {
      value: "unauthorized_structures",
      label: "Unauthorized structures along the coastline",
    },
    { value: "illegal_dumping", label: "Illegal dumping of waste" },
  ],
};

function populateActivities() {
  const catEl = document.getElementById("act_cat");
  const sel = document.getElementById("act_type");
  if (!catEl || !sel) return;
  const cat = catEl.value;
  sel.innerHTML = "";
  (ACTIVITY_OPTIONS[cat] || []).forEach((o) => {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  });
}

(function () {
  const el = document.getElementById("act_cat");
  if (el) el.addEventListener("change", populateActivities);
})();
populateActivities();

function addWaypoint() {
  const lp = state.lastPos;
  if (!lp) {
    const errorMsg = "No location yet. Start tracking.";
    document.getElementById("act_msg").textContent = errorMsg;
    document.getElementById("act_msg").className = "small error";
    showNotification(errorMsg, "error");
    return;
  }
  activityRoute.push({ lat: lp.lat, lng: lp.lng });
  document.getElementById("route_count").textContent = String(
    activityRoute.length,
  );

  const successMsg = "Waypoint added";
  document.getElementById("act_msg").textContent = successMsg;
  document.getElementById("act_msg").className = "small success";
  showNotification(successMsg, "success");

  updateRouteMap();
}

function updateRouteMap() {
  return;
}

async function submitActivity() {
  const lp = state.lastPos;
  if (!lp) {
    const errorMsg = "No location yet. Start tracking.";
    document.getElementById("act_msg").textContent = errorMsg;
    document.getElementById("act_msg").className = "small error";
    showNotification(errorMsg, "error");
    return;
  }

  const type = document.getElementById("act_type").value;
  const category = document.getElementById("act_cat").value;
  const note = document.getElementById("act_note").value;

  try {
    const r = await apiFetch("/api/activity_logs", {
      method: "POST",
      loaderMessage: "Logging activity...",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type,
        category,
        lat: lp.lat,
        lng: lp.lng,
        line: activityRoute,
        details: note || null,
      }),
    });

    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Failed to log activity");

    const successMsg = "Activity logged successfully";
    document.getElementById("act_msg").textContent = successMsg;
    document.getElementById("act_msg").className = "small success";
    showNotification(successMsg, "success");

    // Reset Form & State
    activityRoute = [];
    document.getElementById("act_note").value = "";
    document.getElementById("route_count").textContent = "0";

    updateRouteMap();
    if (typeof loadMyActivity === "function") loadMyActivity();
  } catch (e) {
    document.getElementById("act_msg").textContent = e.message;
    document.getElementById("act_msg").className = "small error";
    showNotification(e.message, "error");
  }
}

async function submitActivityUpload() {
  const lp = state.lastPos;
  if (!lp) {
    const errorMsg = "No location yet. Start tracking.";
    document.getElementById("act_msg").textContent = errorMsg;
    document.getElementById("act_msg").className = "small error";
    showNotification(errorMsg, "error");
    return;
  }

  const type = document.getElementById("act_type").value;
  const category = document.getElementById("act_cat").value;
  const note = document.getElementById("act_note").value;
  const f = document.getElementById("act_photo");

  if (!f || !f.files || !f.files[0]) {
    const errorMsg = "Select a photo first";
    document.getElementById("act_msg").textContent = errorMsg;
    document.getElementById("act_msg").className = "small error";
    showNotification(errorMsg, "error");
    return;
  }

  try {
    const fd = new FormData();
    fd.append("type", type);
    fd.append("category", category);
    fd.append("note", note);
    fd.append("lat", lp.lat);
    fd.append("lng", lp.lng);
    fd.append("line", JSON.stringify(activityRoute || []));
    fd.append("photo", f.files[0]);

    // Note: Do NOT set "Content-Type" manually when sending FormData
    const r = await apiFetch("/api/activity_logs/upload", {
      method: "POST",
      loaderMessage: "Uploading activity & evidence photo...",
      body: fd,
    });

    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Upload failed");

    const successMsg = "Activity + photo saved successfully";
    document.getElementById("act_msg").textContent = successMsg;
    document.getElementById("act_msg").className = "small success";
    showNotification(successMsg, "success");

    // Reset Form & State
    activityRoute = [];
    document.getElementById("act_note").value = "";
    document.getElementById("route_count").textContent = "0";
    f.value = "";

    // Reset photo drop area styling if needed
    if (f.parentElement) {
      f.parentElement.style.borderColor = "";
      f.parentElement.style.background = "";
    }

    updateRouteMap();
    if (typeof loadMyActivity === "function") loadMyActivity();
  } catch (e) {
    document.getElementById("act_msg").textContent = e.message;
    document.getElementById("act_msg").className = "small error";
    showNotification(e.message, "error");
  }
}

async function useApproxLocation() {
  try {
    let lat = null,
      lng = null;
    // Attempt 1: ipapi.co
    try {
      const r = await fetch("https://ipapi.co/json/");
      const d = await r.json();
      if (d && d.latitude != null && d.longitude != null) {
        lat = parseFloat(d.latitude);
        lng = parseFloat(d.longitude);
      }
    } catch {}

    // Attempt 2: ipinfo.io
    if (lat == null || lng == null) {
      try {
        const r2 = await fetch("https://ipinfo.io/json");
        const d2 = await r2.json();
        if (d2 && d2.loc) {
          const parts = String(d2.loc).split(",");
          lat = parseFloat(parts[0]);
          lng = parseFloat(parts[1]);
        }
      } catch {}
    }

    // Attempt 3: ipwho.is
    if (lat == null || lng == null) {
      try {
        const r3 = await fetch("https://ipwho.is/");
        const d3 = await r3.json();
        if (d3 && d3.success && d3.latitude && d3.longitude) {
          lat = parseFloat(d3.latitude);
          lng = parseFloat(d3.longitude);
        }
      } catch {}
    }

    // Fallback: Default to Gonzaga, Cagayan
    let isDefault = false;
    if (lat == null || lng == null) {
      lat = 18.256;
      lng = 122.202;
      isDefault = true;
    }

    if (isFinite(lat) && isFinite(lng)) {
      state.lastPos = { lat, lng };
      document.getElementById("cur_coords").textContent =
        `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      updateCatchCoords(lat, lng);
      try {
        initTrackMap();
        updateTrackMapPosition({ lat, lng });
        saveLastLocation({ lat, lng, at: new Date().toISOString() });
      } catch {}
      if (isDefault) {
        document.getElementById("track_msg").textContent =
          "Using default location (Gonzaga)";
        document.getElementById("track_msg").className = "small warning";
      } else {
        document.getElementById("track_msg").textContent =
          "Using approximate location";
        document.getElementById("track_msg").className = "small success";
      }
      updateLocationState(true);
    } else {
      // Should not happen due to default fallback
      document.getElementById("track_msg").textContent = "Location unavailable";
      document.getElementById("track_msg").className = "small error";
    }
  } catch (e) {
    console.error("Approx location error:", e);
    // Absolute final fallback
    const lat = 18.256,
      lng = 122.202;
    state.lastPos = { lat, lng };
    document.getElementById("cur_coords").textContent =
      `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    updateCatchCoords(lat, lng);
    try {
      initTrackMap();
      updateTrackMapPosition({ lat, lng });
      saveLastLocation({ lat, lng, at: new Date().toISOString() });
    } catch {}
    document.getElementById("track_msg").textContent = "Using default location";
    updateLocationState(true);
  }
}

async function loadSpecies() {
  try {
    const r = await fetch("/api/species");
    const d = await r.json();
    const select = document.getElementById("species");
    if (!select) return;

    const current = select.value; // Save current selection
    select.innerHTML = '<option value="">Select species...</option>'; // Reset options

    const arr = Array.isArray(d) ? d : [];
    arr.forEach((s) => {
      const o = document.createElement("option");
      o.value = s.name; // Use unique ID (or name) as the value
      o.textContent = s.name; // Display the human-readable species name
      select.appendChild(o);
    });

    if (current) select.value = current;
  } catch {}
}

function showModule(id) {
  const ids = [
    "dashboard",
    "tracking",
    "vessels",
    "catch",
    "my_catches",
    "activity",
    "reports",
    "ai_assistant",
    "recommendations",
  ];
  ids.forEach((x) => {
    const el = document.getElementById(x);
    if (el) el.style.display = x === id ? "" : "none";
  });
  state.currentModule = id;
  const btns = document.querySelectorAll("#sidebar button");
  btns.forEach((b) => b.classList.toggle("active", b.dataset.module === id));
  if (window.matchMedia("(max-width: 800px)").matches) toggleDrawer(false);

  requestAnimationFrame(() => {
    setTimeout(() => {
      if (id === "dashboard") {
        initDashboardMap();
        refreshDashboard();
      }
      if (id === "tracking") {
        try {
          initTrackMap();
        } catch {}
        try {
          if (state.lastPos)
            updateTrackMapPosition({
              lat: state.lastPos.lat,
              lng: state.lastPos.lng,
            });
        } catch {}
        try {
          setTrackingUi(state.watchId != null);
        } catch {}
      }
      if (id === "vessels") {
        loadVessels();
      }
      if (id === "catch") {
        if (state.lastPos)
          updateCatchCoords(state.lastPos.lat, state.lastPos.lng);
        loadVessels();
      }

      if (id === "my_catches") {
        loadMyCatches();
      }

      if (id === "activity") {
        try {
          loadMyActivity();
          updateRouteMap();
        } catch {}
      }

      if (id === "recommendations") {
        loadRecommendations();
      }
    }, 300);
  });
}

function handleFilterTypeChange() {
  const type = document.getElementById("filter_type").value;
  const container = document.getElementById("filter_value_container");
  const now = new Date();

  if (type === "daily") {
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    container.innerHTML = `<input type="date" id="filter_value" class="filter-input" value="${yyyy}-${mm}-${dd}" onchange="refreshDashboard()" />`;
  } else if (type === "weekly") {
    const target = new Date(now.valueOf());
    const dayNr = (now.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNr + 3);
    const firstThursday = target.valueOf();
    target.setMonth(0, 1);
    if (target.getDay() !== 4) {
      target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
    }
    const weekNr =
      1 + Math.round((firstThursday - target.valueOf()) / 604800000);
    const yyyy = target.getFullYear();
    const ww = String(weekNr).padStart(2, "0");

    container.innerHTML = `<input type="week" id="filter_value" class="filter-input" value="${yyyy}-W${ww}" onchange="refreshDashboard()" />`;
  } else if (type === "monthly") {
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    container.innerHTML = `<input type="month" id="filter_value" class="filter-input" value="${yyyy}-${mm}" onchange="refreshDashboard()" />`;
  }

  refreshDashboard();
}

function resetDashboardFilter() {
  document.getElementById("filter_type").value = "monthly";
  handleFilterTypeChange();
}

async function refreshDashboard() {
  if (!state.token || window._authInvalidated) return;

  const filterType = document.getElementById("filter_type")?.value || "monthly";
  const filterValElem = document.getElementById("filter_value");
  const filterValue = filterValElem ? filterValElem.value : "";

  try {
    const queryParams = new URLSearchParams({
      type: filterType,
      value: filterValue,
    });

    const r = await fetch(`/api/dashboard/stats?${queryParams.toString()}`, {
      headers: { Authorization: "Bearer " + state.token },
    });

    const d = await r.json();
    if (!r.ok) {
      if (r.status === 401) {
        handleAuthFailure();
        return;
      }
      throw new Error(d.error);
    }

    // Update Stats
    document.getElementById("stat_catch_today").textContent =
      `${(d.totalWeightToday || 0).toFixed(1)} kg`;
    document.getElementById("stat_activities_week").textContent =
      d.activitiesWeek || 0;

    // Update Top Species
    const tsList = document.getElementById("top_species_list");
    tsList.innerHTML = "";
    const topArr = Array.isArray(d.topSpecies) ? d.topSpecies : [];
    if (topArr.length) {
      topArr.forEach((s, idx) => {
        const row = document.createElement("div");
        row.style =
          "display:flex; align-items:center; gap:12px; padding:8px 0; border-bottom:1px solid var(--border)";
        if (idx === topArr.length - 1) row.style.borderBottom = "none";
        row.innerHTML = `
          <div style="font-weight:700; color:var(--primary); width:24px">#${idx + 1}</div>
          <div style="flex:1; font-weight:600">${s.name}</div>
          <div class="small">${s.count} catches</div>
        `;
        tsList.appendChild(row);
      });
    } else {
      tsList.innerHTML =
        '<div class="small" style="text-align:center; padding:20px">No catches logged for selected period</div>';
    }

    // Update Chart
    updateDashboardChart(d.trend);

    // Update Map
    updateDashboardMap();
  } catch (e) {
    if (window._authInvalidated) return;
    const msg = e && e.message ? String(e.message) : "";
    const isAbort = e && (e.name === "AbortError" || msg === "Failed to fetch");
    const isAuth =
      msg.indexOf("Invalid token") !== -1 || msg.indexOf("Token") !== -1;
    if (!isAbort && !isAuth) console.error("Dashboard refresh error:", e);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("filter_value_container")) {
    handleFilterTypeChange();
  }
});

function updateDashboardChart(trend) {
  const container = document.getElementById("catchChart");
  if (!container) return;
  const parent = container.parentElement;
  if (state.catchChart) {
    state.catchChart.destroy();
    state.catchChart = null;
  }

  const months = trend && Array.isArray(trend.months) ? trend.months : [];
  const series = trend && Array.isArray(trend.series) ? trend.series : [];

  if (!months.length || !series.length) {
    container.style.display = "none";
    let msg = parent.querySelector(".catch-empty-msg");
    if (!msg) {
      msg = document.createElement("div");
      msg.className = "small catch-empty-msg";
      msg.style =
        "display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted)";
      msg.textContent = "No recorded catch";
      parent.appendChild(msg);
    }
    return;
  }

  container.style.display = "";
  const msg = parent.querySelector(".catch-empty-msg");
  if (msg) msg.remove();

  const ctx = container.getContext("2d");
  const datasets = series.map((s, i) => ({
    label: s.species,
    data: s.data,
    backgroundColor: PALETTE[i % PALETTE.length],
    borderColor: PALETTE[i % PALETTE.length],
    borderWidth: 1,
  }));

  state.catchChart = new Chart(ctx, {
    type: "bar",
    data: { labels: months, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: true, position: "top" },
        tooltip: {
          callbacks: {
            title: (context) => `Month: ${context[0].label}`,
            label: (context) =>
              `${context.dataset.label}: ${context.raw.toFixed(2)} kg`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: "rgba(0,0,0,0.05)" },
          title: { display: true, text: "kg" },
        },
        x: { grid: { display: false } },
      },
    },
  });
}

function initDashboardMap() {
  const el = document.getElementById("dashboard_map");
  if (!el || state.dashboardMap) return;
  const map = window.L.map(el).setView([18.256, 122.202], 11);
  window.L.tileLayer("/api/public/tiles/{z}/{x}/{y}.png", {
    maxZoom: 19,
  }).addTo(map);
  state.dashboardMap = map;
}

async function updateDashboardMap() {
  if (!state.dashboardMap || !state.token) return;
  try {
    const r = await fetch("/api/live_locations", {
      headers: { Authorization: "Bearer " + state.token },
    });
    if (r.status === 401) {
      handleAuthFailure();
      return;
    }
    const d = await r.json();
    if (!r.ok) return;
    const arr = Array.isArray(d) ? d : [];

    // Clear old markers that are no longer active
    const activeIds = new Set(arr.map((p) => p.userId));
    for (const [uid, marker] of state.dashboardMarkers) {
      if (!activeIds.has(uid)) {
        marker.remove();
        state.dashboardMarkers.delete(uid);
      }
    }

    // Add/Update markers
    arr.forEach((p) => {
      const pos = [p.lat, p.lng];
      if (state.dashboardMarkers.has(p.userId)) {
        state.dashboardMarkers.get(p.userId).setLatLng(pos);
      } else {
        const marker = window.L.circleMarker(pos, {
          radius: 8,
          color: p.status === "port" ? "#ff9500" : "#34c759",
          fillColor: p.status === "port" ? "#ff9500" : "#34c759",
          fillOpacity: 0.8,
          weight: 2,
        }).addTo(state.dashboardMap);
        marker.bindPopup(
          `<b>${p.user ? p.user.name : "Unknown"}</b><br>Status: ${p.status}`,
        );
        state.dashboardMarkers.set(p.userId, marker);
      }
    });

    if (arr.length > 0) {
      try {
        const bounds = window.L.latLngBounds(arr.map((p) => [p.lat, p.lng]));
        state.dashboardMap.fitBounds(bounds.pad(0.3), { animate: false });
      } catch {}
    }
  } catch {}
}

function refreshDataUser() {
  if (!state.token || window._authInvalidated) return;
  const m = state.currentModule;
  if (m === "dashboard") {
    try {
      refreshDashboard();
    } catch {}
  }
  if (m === "my_catches") {
    try {
      loadMyCatches();
    } catch {}
  }
  if (m === "catch") {
    try {
      loadSpecies();
    } catch {}
  }
  if (m === "activity") {
    try {
      loadMyActivity();
    } catch {}
  }
}

function setupAutoRefreshUser() {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(refreshDataUser, 30000);
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
async function loadVessels() {
  try {
    const r = await apiFetch("/api/vessels", {
      loaderMessage: "Loading registered vessels...",
    });

    if (r.status === 401) {
      handleAuthFailure();
      return;
    }

    const d = await r.json();
    if (!r.ok) {
      showNotification(d.error || "Failed to load vessels", "error");
      return;
    }

    vesselsData = Array.isArray(d)
      ? d.sort(
          (a, b) =>
            new Date(b.created_at || b.createdAt || 0) -
            new Date(a.created_at || a.createdAt || 0),
        )
      : [];

    renderVessels();
    if (typeof updateCatchVesselOptions === "function") {
      updateCatchVesselOptions();
    }
  } catch (e) {
    showNotification(e.message || "Network error loading vessels", "error");
  }
}

function renderVessels(vessels) {
  const table = document.getElementById("user_vessels_table");
  const countEl = document.getElementById("vessel_list_count");
  const source = Array.isArray(vessels)
    ? vessels
    : Array.isArray(vesselsData)
      ? vesselsData
      : [];

  if (countEl) {
    countEl.textContent = `${source.length} vessel${source.length !== 1 ? "s" : ""}`;
  }

  if (!table) return;

  if (!source.length) {
    table.innerHTML =
      '<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-muted)">No vessels registered yet</td></tr>';
    return;
  }

  const btnBaseStyle = `
    width: auto;
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 500;
    border-radius: 6px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: all 0.2s ease;
  `.replace(/\s+/g, " ");

  table.innerHTML = `
    <thead>
      <tr>
        <th>Registration #</th>
        <th>Vessel Name</th>
        <th>Engine</th>
        <th>Owner</th>
        <th>Barangay</th>
        <th>Created</th>
        <th style="text-align: right;">Actions</th>
      </tr>
    </thead>
    <tbody>
      ${source
        .map(
          (v) => `
        <tr>
          <td>${v.vessel_registration_number || "-"}</td>
          <td>${v.name || v.vessel_name || "-"}</td>
          <td>${v.engine || v.engine_gear || "-"}</td>
          <td>${v.owner_name || "-"}</td>
          <td>${v.barangay || "-"}</td>
          <td>${
            v.created_at || v.createdAt
              ? new Date(v.created_at || v.createdAt).toLocaleDateString(
                  "en-US",
                  { month: "long", day: "2-digit", year: "numeric" },
                )
              : "-"
          }</td>
          <td style="text-align: right; white-space: nowrap;">
            <button 
              onclick="editVessel('${v.id}')" 
              style="${btnBaseStyle} background: var(--surface); color: var(--primary); border: 1px solid var(--primary); margin-right: 6px;">
              <i class="fa-solid fa-pen"></i> Edit
            </button>
            <button 
              onclick="confirmDeleteVessel('${v.id}')" 
              style="${btnBaseStyle} background: var(--error, #ef4444); color: white; border: 1px solid var(--error, #ef4444);">
              <i class="fa-solid fa-trash"></i> Delete
            </button>
          </td>
        </tr>
      `,
        )
        .join("")}
    </tbody>
  `;
}

function filterUserVessels() {
  const q = (document.getElementById("user_vessel_search") || {}).value || "";
  const query = q.toLowerCase().trim();
  if (!query) {
    renderVessels();
    return;
  }
  const src = Array.isArray(vesselsData) ? vesselsData : [];
  const filtered = src.filter(
    (v) =>
      (v.vessel_registration_number || "").toLowerCase().includes(query) ||
      (v.vessel_name || v.name || "").toLowerCase().includes(query) ||
      (v.owner_name || "").toLowerCase().includes(query) ||
      (v.engine || v.engine_gear || "").toLowerCase().includes(query) ||
      (v.barangay || "").toLowerCase().includes(query),
  );
  renderVessels(filtered);
}

async function saveVessel() {
  const regNum = document
    .getElementById("vessel_registration_number")
    .value.trim();
  const name = document.getElementById("vessel_name_input").value.trim();
  const engine = document.getElementById("vessel_engine").value.trim();
  const owner = document.getElementById("vessel_owner_name").value.trim();
  const barangay = document.getElementById("vessel_barangay").value.trim();
  const msgEl = document.getElementById("vessel_form_msg");

  if (!regNum || !name || !owner || !barangay) {
    const errorMsg = "Registration #, Name, Owner, and Barangay are required";
    if (msgEl) {
      msgEl.textContent = errorMsg;
      msgEl.className = "small error";
    }
    showNotification(errorMsg, "error");
    return;
  }

  const payload = {
    vessel_registration_number: regNum,
    vessel_name: name,
    engine,
    owner_name: owner,
    barangay,
  };

  const isEditing = Boolean(editingVesselId);
  const url = isEditing ? `/api/vessels/${editingVesselId}` : "/api/vessels";
  const method = isEditing ? "PATCH" : "POST";
  const loaderMessage = isEditing
    ? "Updating vessel details..."
    : "Saving new vessel...";

  try {
    const r = await apiFetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      loaderMessage,
    });

    const d = await r.json();

    if (!r.ok) {
      throw new Error(d.error || "Failed to save vessel");
    }

    const successMsg = isEditing
      ? "Vessel updated successfully"
      : "Vessel saved successfully";

    if (msgEl) {
      msgEl.textContent = successMsg;
      msgEl.className = "small success";
    }

    showNotification(successMsg, "success");
    resetVesselForm();
    await loadVessels();
  } catch (e) {
    if (msgEl) {
      msgEl.textContent = e.message;
      msgEl.className = "small error";
    }
    showNotification(e.message, "error");
  }
}

function editVessel(id) {
  const vessel = vesselsData.find((v) => String(v.id) === String(id));
  if (!vessel) return;

  editingVesselId = id;
  document.getElementById("vessel_registration_number").value =
    vessel.vessel_registration_number || "";
  document.getElementById("vessel_name_input").value =
    vessel.name || vessel.vessel_name || "";
  document.getElementById("vessel_engine").value =
    vessel.engine || vessel.engine_gear || "";
  document.getElementById("vessel_owner_name").value = vessel.owner_name || "";
  document.getElementById("vessel_barangay").value = vessel.barangay || "";

  const cancelBtn = document.getElementById("vessel_cancel_btn");
  if (cancelBtn) cancelBtn.style.display = "inline-flex"; // Updated from inline-block for Flexbox alignment
}

function resetVesselForm() {
  editingVesselId = null;
  document.getElementById("vessel_registration_number").value = "";
  document.getElementById("vessel_name_input").value = "";
  document.getElementById("vessel_engine").value = "";
  document.getElementById("vessel_owner_name").value = "";
  document.getElementById("vessel_barangay").value = "";

  const cancelBtn = document.getElementById("vessel_cancel_btn");
  if (cancelBtn) cancelBtn.style.display = "none";

  const msgEl = document.getElementById("vessel_form_msg");
  if (msgEl) msgEl.textContent = "";
}

async function confirmDeleteVessel(id) {
  if (!confirm("Are you sure you want to delete this vessel?")) return;
  const msgEl = document.getElementById("vessel_form_msg");

  try {
    const r = await apiFetch(`/api/vessels/${id}`, {
      method: "DELETE",
      loaderMessage: "Deleting vessel record...",
    });

    if (!r.ok) {
      const d = await r.json();
      throw new Error(d.error || "Failed to delete vessel");
    }

    const successMsg = "Vessel deleted successfully";
    if (msgEl) {
      msgEl.textContent = successMsg;
      msgEl.className = "small success";
    }
    showNotification(successMsg, "success");
    await loadVessels();
  } catch (e) {
    if (msgEl) {
      msgEl.textContent = e.message;
      msgEl.className = "small error";
    }
    showNotification(e.message, "error");
  }
}

function handleVesselSearch() {
  const input = document.getElementById("catch_vessel_name");
  const query = input.value.trim().toLowerCase();
  const dropdown = document.getElementById("vesselDropdown");
  const vesselIdInput = document.getElementById("catch_vessel_id");
  const summaryEl = document.getElementById("catch_vessel_summary");

  const src =
    typeof vesselsData !== "undefined" && Array.isArray(vesselsData)
      ? vesselsData
      : [];

  const matches = src.filter((v) => {
    const regNum = (v.vessel_registration_number || "").toLowerCase();
    const name = (v.name || v.vessel_name || "").toLowerCase();
    return regNum.includes(query) || name.includes(query);
  });

  if (matches.length > 0) {
    dropdown.innerHTML = matches
      .map(
        (v) => `
        <div 
          class="vessel-option" 
          onclick="selectVessel('${v.id}')"
          style="
            padding: 10px 14px;
            cursor: pointer;
            border-bottom: 1px solid var(--border, #eee);
            font-size: 0.9rem;
          "
          onmouseover="this.style.background='var(--hover, #f0f4f8)'"
          onmouseout="this.style.background='transparent'"
        >
          <span style="color: var(--text-primary);">${v.vessel_registration_number} - ${v.name || v.vessel_name || "Unnamed"}</span>
        </div>
      `,
      )
      .join("");
    dropdown.style.display = "block";
  } else {
    dropdown.innerHTML = `
      <div style="padding: 10px 14px; color: var(--text-muted); font-size: 0.85rem;">
        No registered vessels found.
      </div>`;
    dropdown.style.display = "block";
  }

  const exactVessel = src.find(
    (v) =>
      (v.vessel_registration_number || "").toLowerCase() === query ||
      (v.name || v.vessel_name || "").toLowerCase() === query,
  );

  if (exactVessel) {
    vesselIdInput.value = exactVessel.id;
    summaryEl.textContent = `${exactVessel.name || exactVessel.vessel_name} - ${exactVessel.owner_name || "No Owner"} (${exactVessel.vessel_registration_number})`;
  } else {
    vesselIdInput.value = "";
    summaryEl.textContent = "Select a registered vessel to link this catch.";
  }
}

function selectVessel(vesselId) {
  const src =
    typeof vesselsData !== "undefined" && Array.isArray(vesselsData)
      ? vesselsData
      : [];
  const vessel = src.find((v) => String(v.id) === String(vesselId));

  if (vessel) {
    document.getElementById("catch_vessel_name").value =
      vessel.vessel_registration_number;
    document.getElementById("catch_vessel_id").value = vessel.id;

    document.getElementById("catch_vessel_summary").textContent =
      `Registration Number: ${vessel.vessel_registration_number || "N/A"}\nVessel Name: ${vessel.name || vessel.vessel_name || "N/A"}\nOwner: ${vessel.owner_name || "No Owner"}`;
  }

  document.getElementById("vesselDropdown").style.display = "none";
}

// --- 1. FETCH ALL FISHING GEARS ---
async function loadFishingGears() {
  try {
    const res = await apiFetch("/api/fishing-gears", { showLoader: false });
    if (!res.ok) throw new Error("Failed to load fishing gears");
    const data = await res.json();
    window.fishingGearsData = Array.isArray(data) ? data : [];
  } catch (err) {
    console.error("Error fetching fishing gears:", err);
    window.fishingGearsData = [];
  }
}

// --- 2. HANDLE SEARCH & DROPDOWN DISPLAY ---
async function handleGearSearch() {
  const input = document.getElementById("fishingGear");
  const query = input ? input.value.trim() : "";
  const dropdown = document.getElementById("gearDropdown");
  const gearIdInput = document.getElementById("fishing_gear_id");

  if (!dropdown) return;

  // 1. Fetch initial array if empty
  if (!window.fishingGearsData || window.fishingGearsData.length === 0) {
    await loadFishingGears();
  }

  let matches = [];

  // 2. Perform local filter against window.fishingGearsData
  if (
    Array.isArray(window.fishingGearsData) &&
    window.fishingGearsData.length > 0
  ) {
    const qLower = query.toLowerCase();
    matches = window.fishingGearsData.filter((g) => {
      if (!query) return true;
      const gearName = (g.gear_name || "").toLowerCase();
      const gearCode = (g.gear_code || "").toLowerCase();
      return gearName.includes(qLower) || gearCode.includes(qLower);
    });
  }

  // 3. Optional Search API Fallback if local list is still empty but query exists
  if (matches.length === 0 && query.length > 0) {
    try {
      const searchRes = await apiFetch(
        `/api/fishing-gears/search?q=${encodeURIComponent(query)}`,
        { showLoader: false },
      );
      if (searchRes.ok) {
        matches = await searchRes.json();
      }
    } catch (err) {
      console.error("Error querying gear search endpoint:", err);
    }
  }

  // 4. Render options inside dropdown
  if (matches && matches.length > 0) {
    dropdown.innerHTML = matches
      .map((g) => {
        const displayText = g.gear_code
          ? `${g.gear_name} (${g.gear_code})`
          : g.gear_name;

        return `
        <div 
          class="gear-option" 
          onclick="selectGear('${g.id}')"
          style="
            padding: 10px 14px;
            cursor: pointer;
            border-bottom: 1px solid var(--border, #eee);
            font-size: 0.9rem;
          "
          onmouseover="this.style.background='var(--hover, #f0f4f8)'"
          onmouseout="this.style.background='transparent'"
        >
          <span style="color: var(--text-primary); font-weight: 500;">${g.gear_name}</span>
          ${g.gear_code ? `<span style="color: var(--text-muted); font-size: 0.8rem; margin-left: 6px;">(${g.gear_code})</span>` : ""}
        </div>
      `;
      })
      .join("");
    dropdown.style.display = "block";
  } else {
    dropdown.innerHTML = `
      <div style="padding: 10px 14px; color: var(--text-muted); font-size: 0.85rem;">
        No fishing gears found.
      </div>`;
    dropdown.style.display = "block";
  }

  // 5. Match exact entry to set the hidden input ID
  const qLower = query.toLowerCase();
  const exactGear = (window.fishingGearsData || []).find((g) => {
    const gearName = (g.gear_name || "").toLowerCase();
    const gearCode = (g.gear_code || "").toLowerCase();
    return gearName === qLower || gearCode === qLower;
  });

  if (exactGear) {
    gearIdInput.value = exactGear.id;
  } else {
    gearIdInput.value = "";
  }
}

// --- 3. SELECT GEAR ITEM ---
function selectGear(gearId) {
  const src = Array.isArray(window.fishingGearsData)
    ? window.fishingGearsData
    : [];
  const gear = src.find((g) => String(g.id) === String(gearId));

  if (gear) {
    const displayText = gear.gear_code
      ? `${gear.gear_name} (${gear.gear_code})`
      : gear.gear_name;

    document.getElementById("fishingGear").value = displayText;
    document.getElementById("fishing_gear_id").value = gear.id;
  }

  const dropdown = document.getElementById("gearDropdown");
  if (dropdown) dropdown.style.display = "none";
}

// --- 4. CLOSE DROPDOWN ON OUTSIDE CLICK ---
document.addEventListener("click", (e) => {
  const gearInput = document.getElementById("fishingGear");
  const gearContainer = gearInput ? gearInput.parentElement : null;

  if (gearContainer && !gearContainer.contains(e.target)) {
    const dropdown = document.getElementById("gearDropdown");
    if (dropdown) dropdown.style.display = "none";
  }
});

// Load backend data immediately
loadFishingGears();

document.addEventListener("click", function (e) {
  const dropdown = document.getElementById("vesselDropdown");
  const input = document.getElementById("catch_vessel_name");

  if (dropdown && !dropdown.contains(e.target) && e.target !== input) {
    dropdown.style.display = "none";
  }
});

function updateCatchVesselSummary() {
  // Keep this for compatibility, but handleVesselSearch now does the work
  handleVesselSearch();
}

function togglePassword(inputId, btnId) {
  const i = document.getElementById(inputId);
  const b = document.getElementById(btnId);
  if (!i || !b) return;
  const isPass = i.type === "password";
  i.type = isPass ? "text" : "password";
  b.textContent = isPass ? "🔓" : "🔒";
}

/* ---------- Vercel AI SDK (BFAR AI Assistant) ---------- */

function _aiAuth() {
  const token = (state && state.token) || localStorage.getItem("fish_token");
  if (!token) alert("Please login first to use the BFAR AI Assistant.");
  return token || null;
}

function _aiHeaders() {
  const token = (state && state.token) || localStorage.getItem("fish_token");
  return token ? { Authorization: "Bearer " + token } : {};
}

function _renderAnalysisCard(a) {
  const color =
    a && a.stockHealth === "HIGH"
      ? "#22c55e"
      : a && a.stockHealth === "MEDIUM"
        ? "#f59e0b"
        : a && a.stockHealth === "LOW"
          ? "#ef4444"
          : "#94a3b8";
  return `
    <div style="margin-bottom:8px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap">
    <b style="font-size:13px; color:var(--text-main)">Stock Health</b>
    <span style="display:inline-flex; align-items:center; gap:6px; color:${color}; font-weight:800; background:${color}22; border:1px solid ${color}66; padding:3px 10px; border-radius:999px; font-size:12px; letter-spacing:.5px; text-transform:uppercase">${(a && a.stockHealth) || "UNKNOWN"}</span>
    </div>
    <div class="small" style="color:var(--text-main); margin:6px 0 10px 0; background:var(--background); padding:10px 12px; border-radius:10px; line-height:1.55"><b>Summary: </b>${(a && a.summary) || "—"}</div>
    <div class="small" style="color:var(--text-muted); margin:0 0 8px 0; line-height:1.55"><b style="color:var(--text-main)">BFAR Notes: </b>${(a && a.bfarNotes) || "—"}</div>
    ${Array.isArray(a && a.recommendedActions) && a.recommendedActions.length ? `<div class="small" style="margin-top:6px"><b style="color:var(--text-main)">Recommended Actions:</b><ul style="margin:6px 0 0 0; padding-left:20px; line-height:1.6; color:var(--text-main)">${a.recommendedActions.map((x) => `<li>${String(x).replace(/</g, "&lt;")}</li>`).join("")}</ul></div>` : ""}
`;
}

async function quickCatchAnalysis() {
  const token = _aiAuth();
  if (!token) return;
  const species =
    (document.getElementById("ai_quick_species") || {}).value || "";
  const weightKgRaw = (document.getElementById("ai_quick_weight") || {}).value;
  const weightKg = weightKgRaw === "" ? null : Number(weightKgRaw);
  const location =
    (document.getElementById("ai_quick_location") || {}).value || "";
  const capturedAt =
    (document.getElementById("ai_quick_captured") || {}).value || "";
  const notes = (document.getElementById("ai_quick_notes") || {}).value || "";
  if (
    !species &&
    (weightKg === null || isNaN(weightKg)) &&
    !location &&
    !notes
  ) {
    alert(
      "Please fill at least one field (species, weight, location, or notes).",
    );
    return;
  }
  const out = document.getElementById("ai_quick_result");
  if (!out) return;
  out.style.display = "";
  out.innerHTML =
    '<div class="small" style="color:var(--text-muted)"><i class="fa-solid fa-spinner fa-spin" style="color:var(--primary)"></i> Running analysis via Vercel AI…</div>';
  try {
    const r = await fetch("/api/ai/catch-analysis", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ species, weightKg, location, notes, capturedAt }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      out.innerHTML = `<div style="color:#b91c1c"><b>Error ${r.status}:</b> ${(data && data.error) || "Request failed"}</div>`;
      return;
    }
    out.innerHTML = _renderAnalysisCard((data && data.analysis) || {});
    if (data && data.usage) {
      out.insertAdjacentHTML(
        "beforeend",
        `<div class="small" style="margin-top:10px; color:var(--text-muted); font-size:11px">Usage tokens: ${JSON.stringify(data.usage)}</div>`,
      );
    }
  } catch (e) {
    out.innerHTML = `<div style="color:#b91c1c"><b>Error:</b> ${String((e && e.message) || e)}</div>`;
  }
}

async function analyzeCatchWithAI() {
  const token = _aiAuth();
  if (!token) return;
  const species = (document.getElementById("species") || {}).value || "";
  const weightKgRaw = (document.getElementById("weight") || {}).value;
  const weightKg = weightKgRaw === "" ? null : Number(weightKgRaw);
  const note = (document.getElementById("note") || {}).value || "";
  const coordsTxt =
    (document.getElementById("catch_coords_text") || {}).textContent || "";
  const capturedAt = new Date().toISOString();
  const vesselName =
    (document.getElementById("catch_vessel_name") || {}).value || "";
  const netType = (document.getElementById("netType") || {}).value || "";
  const gear = (document.getElementById("gear") || {}).value || "";
  const vesselPart = vesselName ? "Vessel: " + vesselName : "";
  const netGearPart = netType ? "Net type: " + netType : "";
  const enginePart = gear ? "Engine: " + gear : "";
  const notes = [note, vesselPart, netGearPart, enginePart]
    .filter(Boolean)
    .join("; ");
  const out = document.getElementById("catch_ai_result");
  if (!out) return;
  out.style.display = "";
  out.innerHTML =
    '<div class="small" style="color:var(--text-muted)"><i class="fa-solid fa-spinner fa-spin" style="color:var(--primary)"></i> Analyzing current form via Vercel AI…</div>';
  let qi = document.getElementById("ai_quick_species");
  if (qi) qi.value = species;
  qi = document.getElementById("ai_quick_weight");
  if (qi) qi.value = weightKg === null || isNaN(weightKg) ? "" : weightKg;
  qi = document.getElementById("ai_quick_location");
  if (qi) qi.value = coordsTxt;
  qi = document.getElementById("ai_quick_notes");
  if (qi) qi.value = note;
  qi = document.getElementById("ai_quick_captured");
  if (qi) {
    try {
      qi.value = new Date().toISOString().slice(0, 16);
    } catch {}
  }
  try {
    const r = await fetch("/api/ai/catch-analysis", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({
        species,
        weightKg,
        location: coordsTxt,
        notes,
        capturedAt,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      out.innerHTML = `<div style="color:#b91c1c"><b>Error ${r.status}:</b> ${(data && data.error) || "Request failed. If status is 503, set OPENAI_API_KEY / ANTHROPIC_API_KEY in env."}</div>`;
      return;
    }
    out.innerHTML = _renderAnalysisCard((data && data.analysis) || {});
    if (data && data.usage) {
      out.insertAdjacentHTML(
        "beforeend",
        `<div class="small" style="margin-top:10px; color:var(--text-muted); font-size:11px">Usage: ${JSON.stringify(data.usage)}</div>`,
      );
    }
  } catch (e) {
    out.innerHTML = `<div style="color:#b91c1c"><b>Error:</b> ${String((e && e.message) || e)}</div>`;
  }
}

function clearAIChat() {
  const box = document.getElementById("ai_chat_messages");
  if (!box) return;
  box.innerHTML = `<div style="align-self:flex-start; max-width:85%; background:#eff6ff; color:#0c4a6e; padding:10px 12px; border-radius:12px 12px 12px 4px; border:1px solid #bfdbfe; font-size:13.5px; line-height:1.5">👋 Chat cleared. Ask me anything about BFAR rules, regulations, zoning, or catch limits.</div>`;
}

const _REC_DISMISS_KEY = "bfar_dismissed_recs_v1";
function _getDismissedRecs() {
  try {
    const raw = localStorage.getItem(_REC_DISMISS_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch (e) {
    return new Set();
  }
}

function _setDismissed(id) {
  const s = _getDismissedRecs();
  s.add(id);
  try {
    localStorage.setItem(_REC_DISMISS_KEY, JSON.stringify(Array.from(s)));
  } catch (e) {}
}

function _renderRecCard(rec, canDismiss) {
  const SEVERITY_STYLES = {
    info: {
      bg: "#0f172a",
      border: "#1e293b",
      title: "#f8fafc",
      sub: "#cbd5e1",
      icon: "#38bdf8",
      iconBox: "#0c4a6e",
    },
    warn: {
      bg: "#1c1917",
      border: "#292524",
      title: "#fef3c7",
      sub: "#fde68a",
      icon: "#f59e0b",
      iconBox: "#78350f",
    },
    success: {
      bg: "#052e16",
      border: "#14532d",
      title: "#dcfce7",
      sub: "#bbf7d0",
      icon: "#34d399",
      iconBox: "#064e3b",
    },
    danger: {
      bg: "#450a0a",
      border: "#7f1d1d",
      title: "#fee2e2",
      sub: "#fecaca",
      icon: "#ef4444",
      iconBox: "#7f1d1d",
    },
  };
  const st = SEVERITY_STYLES[rec.severity] || SEVERITY_STYLES.info;
  const dismissHtml = canDismiss
    ? `
    <button type="button" aria-label="Dismiss" onclick="dismissRecommendation('${rec.id}', this)" style="position:absolute; top:10px; right:10px; width:32px; height:32px; border-radius:50%; border:1px solid ${st.border}; background:${st.bg}; color:${st.sub}; cursor:pointer; display:flex; align-items:center; justify-content:center; padding:0; line-height:1; font-size:16px" onmouseover="this.style.color='${st.title}';this.style.borderColor='${st.title}'" onmouseout="this.style.color='${st.sub}';this.style.borderColor='${st.border}'">
    <i class="fa-solid fa-xmark" style="font-size:14px; line-height:1"></i>
    </button>`
    : "";
  return `<div data-rec-id="${rec.id}" style="position:relative; display:flex; gap:14px; align-items:flex-start; padding:22px 22px 22px 20px; border-radius:14px; border:1px solid ${st.border}; background:${st.bg}; color:${st.title}; box-shadow:0 1px 2px rgba(0,0,0,0.3)">
    ${dismissHtml}
    <div style="width:42px; height:42px; flex:none; border-radius:10px; background:${st.iconBox}; display:flex; align-items:center; justify-content:center; color:${st.icon}">
    <i class="fa-solid ${rec.icon}" style="font-size:18px; line-height:1"></i>
    </div>
    <div style="flex:1; min-width:0; padding-right:${canDismiss ? "34px" : "0"}">
    <div style="font-weight:800; font-size:16.5px; line-height:1.35; margin-bottom:6px; letter-spacing:0.1px">${rec.title}</div>
    <div style="color:${st.sub}; font-size:13.5px; line-height:1.55; letter-spacing:0.1px">${rec.body}</div>
    ${rec.footer ? `<div style="margin-top:10px; font-size:11.5px; color:${st.sub}; opacity:0.75; text-transform:uppercase; letter-spacing:0.5px"><i class="fa-solid fa-circle-info"></i> ${rec.footer}</div>` : ""}
    </div>
</div>`;
}

function dismissRecommendation(id, btnEl) {
  _setDismissed(id);
  const card = btnEl && btnEl.closest ? btnEl.closest("[data-rec-id]") : null;
  if (card) {
    card.style.transition = "opacity 250ms ease, transform 250ms ease";
    card.style.opacity = "0";
    card.style.transform = "translateY(4px) scale(0.98)";
    setTimeout(() => card.remove(), 240);
  }
  setTimeout(() => {
    const c = document.getElementById("recs_cards");
    if (c && c.children.length === 0) {
      const e = document.getElementById("recs_empty");
      if (e) e.style.display = "";
    }
  }, 300);
}

async function loadRecommendations() {
  const wrap = document.getElementById("recs_cards");
  if (!wrap) return;
  const empty = document.getElementById("recs_empty");
  if (empty) empty.style.display = "none";
  const dismissed = _getDismissedRecs();
  const staticRecs = [
    {
      id: "rec_ra8550_sec89",
      severity: "warn",
      icon: "fa-scale-balanced",
      title: "RA 8550 Sec. 89: Catch Size Minimums for Commercial Species",
      body: "Always verify the legal minimum size before logging high-value commercial species (e.g., Yellowfin Tuna ≥ 70 cm fork length; Skipjack ≥ 30 cm). Undersized individuals must be released and recorded as bycatch with a note.",
      footer: "Philippine Fisheries Code of 1998",
    },
    {
      id: "rec_municipal_15km",
      severity: "danger",
      icon: "fa-location-dot",
      title:
        "Commercial Vessels: Stay Outside 15 km From Shoreline (Municipal Waters)",
      body: "Per RA 8550 Sec. 90, commercial fishing vessels may NOT operate within 15 km from the shoreline of municipal waters unless the municipal council issues a prior written permit. Violations carry heavy fines and license revocation.",
      footer: "Confirm vessel license zone before each trip",
    },
    {
      id: "rec_season_closed",
      severity: "warn",
      icon: "fa-ban",
      title: "Respect Closed Seasons & Spawning Aggregations (SAGs)",
      body: "Avoid logging catch of species during their declared spawning seasons: Yellowfin/Bluefin Tuna (Nov–Feb in Davao Gulf), Milkfish (milk fry: Apr–Jun), and Frigate Tuna in shallow bays during full moon windows.",
      footer: "Match catch date with site-specific SAG windows",
    },
    {
      id: "rec_vessel_registration",
      severity: "info",
      icon: "fa-passport",
      title: "Re-Register All Vessel Changes Before 10 Working Days",
      body: "Per BFAR MC 2021-0201, any material change in vessel specifications, CFR number, license, or owner details must be filed to BFAR Regional Office within 10 working days. Prevents citation during at-sea boardings.",
      footer: "Click Vessel Information > Edit to update",
    },
    {
      id: "rec_bycatch_reporting",
      severity: "success",
      icon: "fa-book-medical",
      title: "Report Protected & Bycatch Species Within 72 Hours",
      body: "Whenever you encounter sea turtles (RA 9147), marine mammals, whale sharks, manta rays, or juvenile megafauna as bycatch, log a Protected Species Encounter report with GPS coordinates, photo (if available), and release method within 72 hours.",
      footer: "AI Assistant can generate the BFAR form body in 1 click",
    },
    {
      id: "rec_catch_log_accuracy",
      severity: "info",
      icon: "fa-file-lines",
      title: "Log Catch Entries At Sea (Same-Hour) To Prevent Data Drift",
      body: "Data integrity studies show catches logged > 6 hours after retrieval lose 22% of size/weight accuracy and 40% of GPS coordinates. Tap Start Tracking, then Log Catch immediately after pulling the net.",
      footer: 'Use the Catch form inline "Analyze with BFAR AI" for instant QA',
    },
    {
      id: "rec_stock_rotational",
      severity: "success",
      icon: "fa-arrows-rotate",
      title:
        "Rotate Fishing Sites — Avoid Consecutive Sets Within 3 NM For 7 Days",
      body: "For artisanal and small commercial vessels, rotational fishing prevents site-wide stock depletion. If you logged > 2 t of the same species at a single GPS point in the last 3 days, rotate to your backup grounds before re-returning.",
      footer: "Track past sets via Catches > Date range filter",
    },
    {
      id: "rec_juvenile_release",
      severity: "danger",
      icon: "fa-fish",
      title: "Release All Juvenile & Egg-Bearing Crustaceans Immediately",
      body: "RA 10654 Sec. 91 strictly prohibits retention of berried (egg-bearing) crabs, prawns, and lobsters. All undersized crustaceans (crab carapace < 10 cm CW, prawn < 16 cm TL) must be released at the capture point. Logged release events improve compliance scores.",
      footer: 'Report in Coastal Activity with method="Live Release"',
    },
  ];
  const finalRecs = staticRecs.filter((r) => !dismissed.has(r.id));
  let catches = [];
  try {
    const r = await fetch("/api/catches/me", { headers: _aiHeaders() });
    if (r.ok) catches = await r.json();
  } catch (e) {
    console.warn(
      "[Recommendations] /api/catches/me failed:",
      e && e.message ? e.message : e,
    );
  }
  const dynamicRecs = [];
  if (catches && Array.isArray(catches)) {
    const totalKg = catches.reduce((a, c) => a + (Number(c.weightKg) || 0), 0);
    const speciesMap = new Map();
    catches.forEach((c) => {
      const n = (c.species || "Unspecified").toLowerCase();
      if (!speciesMap.has(n))
        speciesMap.set(n, { kg: 0, count: 0, last: c.capturedAt });
      const x = speciesMap.get(n);
      x.kg += Number(c.weightKg) || 0;
      x.count += 1;
      if (!x.last || c.capturedAt > x.last) x.last = c.capturedAt;
    });
    const overWeightSpecies = [...speciesMap.entries()].filter(
      ([, s]) => s.kg >= 1500,
    );
    overWeightSpecies.forEach(([name, s]) => {
      const id = "rec_heavy_" + name.replace(/\W+/g, "_");
      if (dismissed.has(id)) return;
      dynamicRecs.push({
        id,
        severity: "warn",
        icon: "fa-weight-hanging",
        title:
          "High Recent Volume for " +
          (name.charAt(0).toUpperCase() + name.slice(1)) +
          ": " +
          s.kg.toFixed(0) +
          " kg",
        body:
          "You have logged " +
          s.count +
          " catches totaling " +
          s.kg.toFixed(0) +
          " kg of " +
          (name.charAt(0).toUpperCase() + name.slice(1)) +
          " in your active records. Verify this volume matches the licensed quota for your vessel class and municipality; consider submitting a supplemental stock assessment via BFAR AI Assistant if this is > 80% of monthly cap.",
        footer: "Click Run Analysis in Quick Catch with this species",
      });
    });
    const hasTunaOver = [...speciesMap.entries()].some(
      ([n, s]) =>
        (n.includes("tuna") ||
          n.includes("yellowfin") ||
          n.includes("bluefin") ||
          n.includes("skipjack")) &&
        s.kg >= 1000,
    );
    if (hasTunaOver && !dismissed.has("rec_tuna_chain_of_custody")) {
      dynamicRecs.push({
        id: "rec_tuna_chain_of_custody",
        severity: "info",
        icon: "fa-chain",
        title: "Tuna Chain of Custody Form (BFAR MC 2019-07) — Complete",
        body: "Your catch log includes ≥ 1 ton of tuna-family species. For export-grade lots attach a complete Catch Certificate, traceability GPS log, and unloading/transshipment slip. Use the AI Assistant to autogenerate the header data with 1 prompt.",
        footer: "Required for commercial export licensing",
      });
    }
    const now = new Date();
    const cutoff = new Date();
    cutoff.setDate(now.getDate() - 10);
    const anyOld = catches.some(
      (c) =>
        c.capturedAt &&
        new Date(c.capturedAt) > cutoff &&
        !(c.vesselId || c.vesselName),
    );
    if (anyOld && !dismissed.has("rec_vessel_link_recent")) {
      dynamicRecs.push({
        id: "rec_vessel_link_recent",
        severity: "warn",
        icon: "fa-ship",
        title: "Link Recent Catches To A Registered Vessel",
        body:
          "You have " +
          catches.filter(
            (c) =>
              c.capturedAt &&
              new Date(c.capturedAt) > cutoff &&
              !(c.vesselId || c.vesselName),
          ).length +
          " catches in the last 10 days without an assigned vessel. BFAR compliance scoring requires each catch to carry a CFR-numbered vessel. Open a catch row, click Edit, and assign the vessel.",
        footer: "Open Catches → tap any row → Edit",
      });
    }
    if (totalKg === 0 && !dismissed.has("rec_zero_catch")) {
      dynamicRecs.unshift({
        id: "rec_zero_catch",
        severity: "info",
        icon: "fa-plus-circle",
        title: "Log Your First Catch",
        body: "No catches detected on your account yet. Start tracking to unlock personal recommendations, stock health reports, and automated compliance reminders.",
        footer: "Sidebar → Log Catch",
      });
    }
  }
  dynamicRecs.forEach((r) => finalRecs.push(r));
  wrap.innerHTML = "";
  if (finalRecs.length === 0) {
    if (empty) empty.style.display = "";
    return;
  }
  finalRecs.forEach((rec) => {
    const row = document.createElement("div");
    row.innerHTML = _renderRecCard(rec, true);
    wrap.appendChild(row.children[0]);
  });
}

function _appendChat(role, text) {
  const box = document.getElementById("ai_chat_messages");
  if (!box) return;
  const el = document.createElement("div");
  const isUser = role === "user";
  el.style.alignSelf = isUser ? "flex-end" : "flex-start";
  el.style.maxWidth = "88%";
  el.style.padding = "10px 12px";
  el.style.borderRadius = isUser ? "12px 12px 4px 12px" : "12px 12px 12px 4px";
  el.style.fontSize = "13.5px";
  el.style.lineHeight = "1.6";
  el.style.border = isUser ? "1px solid var(--primary)" : "1px solid #bfdbfe";
  el.style.background = isUser ? "var(--primary)" : "#eff6ff";
  el.style.color = isUser ? "#fff" : "#0c4a6e";
  el.style.whiteSpace = "pre-wrap";
  el.textContent = text;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return el;
}

async function sendAIChat() {
  const token = _aiAuth();
  if (!token) return;
  const input = document.getElementById("ai_chat_input");
  if (!input) return;
  const text = (input.value || "").trim();
  if (!text) return;
  const sendBtn = document.getElementById("ai_chat_send");
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.style.opacity = "0.6";
  }
  input.value = "";
  _appendChat("user", text);
  const assistantEl = _appendChat("assistant", "");
  assistantEl.textContent = "…";
  try {
    const r = await fetch("/api/ai/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ messages: [{ role: "user", content: text }] }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      let msg = `Error ${r.status}`;
      try {
        const j = JSON.parse(t);
        if (j && j.error) msg = j.error;
      } catch {}
      assistantEl.textContent =
        "❌ " +
        msg +
        (r.status === 503
          ? " — add OPENAI_API_KEY or ANTHROPIC_API_KEY to env vars."
          : "");
      return;
    }
    assistantEl.textContent = "";
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      assistantEl.textContent = buf;
      const box = document.getElementById("ai_chat_messages");
      if (box) box.scrollTop = box.scrollHeight;
    }
  } catch (e) {
    assistantEl.textContent =
      "❌ Network error: " + String((e && e.message) || e);
  } finally {
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.style.opacity = "1";
    }
    const box = document.getElementById("ai_chat_messages");
    if (box) box.scrollTop = box.scrollHeight;
  }
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
