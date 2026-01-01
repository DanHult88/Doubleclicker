const els = {
  testArea: document.getElementById("testArea"),
  statusPill: document.getElementById("statusPill"),

  pressCount: document.getElementById("pressCount"),
  badDoubleCount: document.getElementById("badDoubleCount"),
  normalDoubleCount: document.getElementById("normalDoubleCount"),
  lastInterval: document.getElementById("lastInterval"),

  // per button cells
  pLeft: document.getElementById("pLeft"),
  bLeft: document.getElementById("bLeft"),
  nLeft: document.getElementById("nLeft"),
  iLeft: document.getElementById("iLeft"),

  pMiddle: document.getElementById("pMiddle"),
  bMiddle: document.getElementById("bMiddle"),
  nMiddle: document.getElementById("nMiddle"),
  iMiddle: document.getElementById("iMiddle"),

  pRight: document.getElementById("pRight"),
  bRight: document.getElementById("bRight"),
  nRight: document.getElementById("nRight"),
  iRight: document.getElementById("iRight"),

  // settings
  testLeft: document.getElementById("testLeft"),
  testMiddle: document.getElementById("testMiddle"),
  testRight: document.getElementById("testRight"),

  fastThreshold: document.getElementById("fastThreshold"),
  fastThresholdNumber: document.getElementById("fastThresholdNumber"),

  normalThreshold: document.getElementById("normalThreshold"),
  normalThresholdNumber: document.getElementById("normalThresholdNumber"),

  requireSameTarget: document.getElementById("requireSameTarget"),

  resetBtn: document.getElementById("resetBtn"),
  copyBtn: document.getElementById("copyBtn"),
  log: document.getElementById("log"),
};

const BUTTONS = {
  0: "Left",
  1: "Middle",
  2: "Right",
};

function freshPerButtonState() {
  return {
    presses: 0,
    badDoubles: 0,
    normalDoubles: 0,
    lastPressTime: null,
    lastTarget: null,
    lastIntervalMs: null,
  };
}

let state = {
  totalPresses: 0,
  totalBadDoubles: 0,
  totalNormalDoubles: 0,
  lastIntervalMs: null,

  perButton: {
    0: freshPerButtonState(),
    1: freshPerButtonState(),
    2: freshPerButtonState(),
  },

  logItems: [],
};

const MAX_LOG = 40;

function nowMs() {
  return performance.now();
}

function setPill(text, kind = "neutral") {
  els.statusPill.textContent = text;
  if (kind === "good") els.statusPill.style.color = "var(--good)";
  else if (kind === "warn") els.statusPill.style.color = "var(--warn)";
  else if (kind === "bad") els.statusPill.style.color = "var(--bad)";
  else els.statusPill.style.color = "var(--muted)";
}

function flash(kind) {
  els.testArea.classList.remove("bad-flash", "good-flash");
  if (kind === "bad") els.testArea.classList.add("bad-flash");
  if (kind === "good") els.testArea.classList.add("good-flash");

  window.clearTimeout(flash._t);
  flash._t = window.setTimeout(() => {
    els.testArea.classList.remove("bad-flash", "good-flash");
  }, 180);
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[m]));
}

function pushLog(message) {
  const ts = new Date().toLocaleTimeString();
  state.logItems.unshift(`${ts} — ${message}`);
  state.logItems = state.logItems.slice(0, MAX_LOG);
  els.log.innerHTML = state.logItems.map((t) => `<li>${escapeHtml(t)}</li>`).join("");
}

function getFastThreshold() {
  return Number(els.fastThreshold.value);
}

function getNormalThreshold() {
  return Number(els.normalThreshold.value);
}

function isButtonEnabled(button) {
  if (button === 0) return els.testLeft.checked;
  if (button === 1) return els.testMiddle.checked;
  if (button === 2) return els.testRight.checked;
  return false;
}

function fmtInterval(ms) {
  return ms == null ? "—" : `${Math.round(ms)} ms`;
}

function renderStats() {
  els.pressCount.textContent = String(state.totalPresses);
  els.badDoubleCount.textContent = String(state.totalBadDoubles);
  els.normalDoubleCount.textContent = String(state.totalNormalDoubles);
  els.lastInterval.textContent = fmtInterval(state.lastIntervalMs);

  // left
  els.pLeft.textContent = String(state.perButton[0].presses);
  els.bLeft.textContent = String(state.perButton[0].badDoubles);
  els.nLeft.textContent = String(state.perButton[0].normalDoubles);
  els.iLeft.textContent = fmtInterval(state.perButton[0].lastIntervalMs);

  // middle
  els.pMiddle.textContent = String(state.perButton[1].presses);
  els.bMiddle.textContent = String(state.perButton[1].badDoubles);
  els.nMiddle.textContent = String(state.perButton[1].normalDoubles);
  els.iMiddle.textContent = fmtInterval(state.perButton[1].lastIntervalMs);

  // right
  els.pRight.textContent = String(state.perButton[2].presses);
  els.bRight.textContent = String(state.perButton[2].badDoubles);
  els.nRight.textContent = String(state.perButton[2].normalDoubles);
  els.iRight.textContent = fmtInterval(state.perButton[2].lastIntervalMs);
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function syncPair(rangeEl, numberEl, min, max, step, label) {
  rangeEl.addEventListener("input", () => {
    numberEl.value = rangeEl.value;
    pushLog(`${label} set to ${rangeEl.value} ms`);
  });

  numberEl.addEventListener("change", () => {
    let v = Number(numberEl.value);
    if (Number.isNaN(v)) v = Number(rangeEl.value);
    v = clamp(v, min, max);
    v = Math.round(v / step) * step;
    rangeEl.value = String(v);
    numberEl.value = String(v);
    pushLog(`${label} set to ${v} ms`);
  });
}

/**
 * Core detection:
 * - We listen on pointerdown so left/right/middle are all captured.
 * - Each button tracks its own lastPressTime.
 * - If interval <= fast => BAD (red)
 * - Else if interval <= normal => normal double (green-ish)
 */
function handlePress(ev) {
  const button = ev.button; // 0 left, 1 middle, 2 right
  const name = BUTTONS[button] ?? `Button ${button}`;

  // Ignore extra buttons (back/forward etc.) unless you want to add them later
  if (!(button in BUTTONS)) return;

  // Allow user to select which buttons are being tested
  if (!isButtonEnabled(button)) {
    setPill(`${name} ignored (disabled)`, "warn");
    pushLog(`${name} press ignored (disabled)`);
    return;
  }

  // Stop browser behaviors that interfere (context menu, autoscroll)
  // (We also block contextmenu separately)
  ev.preventDefault();

  const t = nowMs();
  const fast = getFastThreshold();
  const normal = getNormalThreshold();

  state.totalPresses += 1;
  const pb = state.perButton[button];
  pb.presses += 1;

  const sameTargetOk =
    !els.requireSameTarget.checked ||
    pb.lastTarget === null ||
    pb.lastTarget === ev.currentTarget;

  if (pb.lastPressTime != null && sameTargetOk) {
    const delta = t - pb.lastPressTime;

    // update last interval (global + per-button)
    pb.lastIntervalMs = delta;
    state.lastIntervalMs = delta;

    if (delta <= fast) {
      pb.badDoubles += 1;
      state.totalBadDoubles += 1;

      setPill(`BAD fast double (${name}) ≤ ${fast} ms`, "bad");
      flash("bad");
      pushLog(`BAD fast double (${name}): ${Math.round(delta)} ms (fast ≤ ${fast})`);

      // reset this button’s last press so triple doesn’t cascade
      pb.lastPressTime = null;
      pb.lastTarget = null;
      renderStats();
      return;
    }

    if (delta <= normal) {
      pb.normalDoubles += 1;
      state.totalNormalDoubles += 1;

      setPill(`Normal double (${name}) ≤ ${normal} ms`, "good");
      flash("good");
      pushLog(`Normal double (${name}): ${Math.round(delta)} ms (normal ≤ ${normal})`);

      pb.lastPressTime = null;
      pb.lastTarget = null;
      renderStats();
      return;
    }
  }

  // plain press
  setPill(`${name} press`, "neutral");
  pushLog(`${name} press`);

  pb.lastPressTime = t;
  pb.lastTarget = ev.currentTarget;
  renderStats();
}

function resetAll() {
  state = {
    totalPresses: 0,
    totalBadDoubles: 0,
    totalNormalDoubles: 0,
    lastIntervalMs: null,

    perButton: {
      0: freshPerButtonState(),
      1: freshPerButtonState(),
      2: freshPerButtonState(),
    },

    logItems: [],
  };

  els.log.innerHTML = "";
  els.testArea.classList.remove("bad-flash", "good-flash");
  setPill("Ready", "neutral");
  renderStats();
  pushLog("Reset");
}

async function copyResults() {
  const lines = [
    "Double Click Test Results",
    `- Fast (bad) interval: ${getFastThreshold()} ms`,
    `- Normal double max: ${getNormalThreshold()} ms`,
    `- Require same area: ${els.requireSameTarget.checked}`,
    `- Buttons enabled: ${[
      els.testLeft.checked ? "Left" : null,
      els.testMiddle.checked ? "Middle" : null,
      els.testRight.checked ? "Right" : null,
    ].filter(Boolean).join(", ") || "None"}`,
    "",
    `Totals`,
    `- Total presses: ${state.totalPresses}`,
    `- Bad fast doubles: ${state.totalBadDoubles}`,
    `- Normal doubles: ${state.totalNormalDoubles}`,
    `- Last interval: ${fmtInterval(state.lastIntervalMs)}`,
    "",
    `Per button`,
    `- Left: presses ${state.perButton[0].presses}, bad ${state.perButton[0].badDoubles}, normal ${state.perButton[0].normalDoubles}, last ${fmtInterval(state.perButton[0].lastIntervalMs)}`,
    `- Middle: presses ${state.perButton[1].presses}, bad ${state.perButton[1].badDoubles}, normal ${state.perButton[1].normalDoubles}, last ${fmtInterval(state.perButton[1].lastIntervalMs)}`,
    `- Right: presses ${state.perButton[2].presses}, bad ${state.perButton[2].badDoubles}, normal ${state.perButton[2].normalDoubles}, last ${fmtInterval(state.perButton[2].lastIntervalMs)}`,
    "",
  ];

  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    setPill("Copied results", "good");
    pushLog("Copied results to clipboard");
  } catch {
    setPill("Copy failed (browser blocked)", "warn");
    pushLog("Copy failed (clipboard permission blocked)");
  }
}

function init() {
  // Prevent context menu inside test area so right-click is usable
  els.testArea.addEventListener("contextmenu", (e) => e.preventDefault());

  // Capture all mouse buttons
  els.testArea.addEventListener("pointerdown", handlePress);

  // Keyboard support: triggers a left press simulation (not true right/middle)
  els.testArea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      // simulate a left button pointerdown-like call
      handlePress({
        button: 0,
        currentTarget: els.testArea,
        preventDefault: () => {},
      });
    }
  });

  syncPair(els.fastThreshold, els.fastThresholdNumber, 10, 200, 1, "Fast threshold");
  syncPair(els.normalThreshold, els.normalThresholdNumber, 150, 900, 10, "Normal threshold");

  els.resetBtn.addEventListener("click", resetAll);
  els.copyBtn.addEventListener("click", copyResults);

  renderStats();
  pushLog("App loaded");
}

init();
