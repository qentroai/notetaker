const SCOPE = "openid email profile https://www.googleapis.com/auth/drive.file";
const DB = "simple-meeting-notes-v2", STORE = "meeting", KEY = "active";
const SILENCE_LIMIT_MS = 10 * 60 * 1000; // auto-stop the meeting after this long with no detected voice
const WATCHDOG_MS = 8000;                // how often we make sure the mic is actually still listening
const RECONNECT_FLICKER_MS = 1200;       // only show "reconnecting" if a restart takes longer than this
const $ = id => document.getElementById(id);

const e = {
  signIn: $("signIn"), switchAccount: $("switchAccount"), signOut: $("signOut"), account: $("account"),
  userName: $("userName"), userEmail: $("userEmail"), ready: $("ready"), active: $("active"), paused: $("paused"),
  done: $("done"), meetingWith: $("meetingWith"), start: $("start"), hint: $("hint"), activeName: $("activeName"),
  pausedName: $("pausedName"), pause: $("pause"), stop: $("stop"), resume: $("resume"), pausedStop: $("pausedStop"),
  notes: $("notes"), pausedNotes: $("pausedNotes"), showTranscript: $("showTranscript"), hideTranscript: $("hideTranscript"),
  transcriptPanel: $("transcriptPanel"), transcript: $("transcript"), interim: $("interim"),
  showPausedTranscript: $("showPausedTranscript"), hidePausedTranscript: $("hidePausedTranscript"),
  pausedTranscriptPanel: $("pausedTranscriptPanel"), pausedTranscript: $("pausedTranscript"),
  timer: $("timer"), pausedTimer: $("pausedTimer"), filename: $("filename"), saveStatus: $("saveStatus"),
  openDrive: $("openDrive"), viewDoneTranscript: $("viewDoneTranscript"), hideDoneTranscript: $("hideDoneTranscript"),
  doneTranscriptPanel: $("doneTranscriptPanel"), doneTranscript: $("doneTranscript"), newMeeting: $("newMeeting"),
  warning: $("warning"), micStatus: $("micStatus")
};

let state = fresh();
let recognition = null;
let recognitionActive = false;   // true between the recognizer's onstart and onend
let shouldListen = false;        // true whenever the meeting is supposed to be recording
let accessToken = null, tokenClient = null;
let timerId = null, watchdogId = null, silenceId = null, reconnectFlickerTimer = null;
let lastFinal = "";
let lastSpeechAt = null;
let wakeLock = null;

function fresh() {
  return { id: crypto.randomUUID(), meetingWith: "", startedAt: null, endedAt: null, segments: [], notes: "", status: "ready", filename: null, driveUrl: null };
}
function show(view) { [e.ready, e.active, e.paused, e.done].forEach(x => x.classList.add("hidden")); view.classList.remove("hidden") }
function openDb() { return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE) }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) }) }
async function saveLocal() { const db = await openDb(); await new Promise((res, rej) => { const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).put(state, KEY); tx.oncomplete = res; tx.onerror = () => rej(tx.error) }); db.close() }
async function loadLocal() { const db = await openDb(); const saved = await new Promise((res, rej) => { const tx = db.transaction(STORE, "readonly"), r = tx.objectStore(STORE).get(KEY); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) }); db.close(); if (saved) state = saved }

function render() {
  show(state.status === "recording" ? e.active : state.status === "paused" ? e.paused : state.status === "done" ? e.done : e.ready);
  e.meetingWith.value = state.meetingWith;
  e.activeName.textContent = state.meetingWith;
  e.pausedName.textContent = state.meetingWith;
  e.notes.value = state.notes;
  e.pausedNotes.value = state.notes;
  e.filename.textContent = state.filename || "";
  const text = state.segments.map(x => x.text).join("\n\n");
  e.transcript.textContent = text;
  e.pausedTranscript.textContent = text;
  e.doneTranscript.textContent = text;
  if (state.driveUrl) { e.openDrive.href = state.driveUrl; e.openDrive.classList.remove("hidden") } else e.openDrive.classList.add("hidden");
  updateStart();
  updateTimer();
}
function updateStart() {
  const ok = !!(accessToken && recognition && e.meetingWith.value.trim());
  e.start.disabled = !ok;
  e.hint.textContent = !accessToken ? "Sign in with Google first." : !e.meetingWith.value.trim() ? "Enter who you are meeting with." : "Ready to start.";
}
function norm(t) { return t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim() }

// ---- Live mic status: always tells the user whether we're actually capturing audio ----
function micStatus(mode, message) {
  if (!e.micStatus) return;
  e.micStatus.classList.remove("mic-listening", "mic-reconnecting", "mic-error", "mic-off");
  if (mode === "listening") { e.micStatus.textContent = "🎙️ Listening"; e.micStatus.classList.add("mic-listening") }
  else if (mode === "reconnecting") { e.micStatus.textContent = "⏳ Reconnecting mic…"; e.micStatus.classList.add("mic-reconnecting") }
  else if (mode === "error") { e.micStatus.textContent = "⚠️ " + (message || "Microphone error"); e.micStatus.classList.add("mic-error") }
  else { e.micStatus.textContent = "Mic paused"; e.micStatus.classList.add("mic-off") }
  if (mode === "error" && message) { e.warning.textContent = message; e.warning.classList.remove("hidden") }
}

function safeStartRecognition() {
  if (!recognition || recognitionActive) return;
  try { recognition.start() } catch (err) { /* already starting, or a transient race — the watchdog will retry */ }
}
function safeStopRecognition() {
  if (!recognition) return;
  try { recognition.stop() } catch {}
}

function setupSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { e.warning.textContent = "This browser does not support live speech recognition. Current Chrome on Android is the primary target."; e.warning.classList.remove("hidden"); return }
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  recognition.onstart = () => {
    recognitionActive = true;
    clearTimeout(reconnectFlickerTimer);
    micStatus("listening");
  };

  recognition.onresult = async ev => {
    lastSpeechAt = Date.now(); // any result — interim or final — means the mic is picking up speech
    if (!e.micStatus?.classList.contains("mic-listening")) micStatus("listening");
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i], t = r[0].transcript.trim();
      if (!t) continue;
      if (r.isFinal) {
        const n = norm(t);
        if (n && n !== lastFinal) { state.segments.push({ text: t, capturedAt: new Date().toISOString() }); lastFinal = n; e.interim.textContent = ""; render(); await saveLocal() }
      } else interim += t + " ";
    }
    e.interim.textContent = interim.trim();
  };

  recognition.onerror = ev => {
    console.warn("speech recognition error:", ev.error);
    if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
      shouldListen = false;
      micStatus("error", "Microphone access was blocked. Allow the mic for this site, then press Resume.");
    } else if (ev.error === "audio-capture") {
      shouldListen = false;
      micStatus("error", "No microphone was found. Check your device, then press Resume.");
    }
    // other errors (no-speech, network, aborted) are recoverable — onend fires next and we restart there
  };

  recognition.onend = () => {
    recognitionActive = false;
    if (!shouldListen) { micStatus("off"); return }
    // Chrome's recognizer stops itself on its own every so often even mid-meeting; restart quietly.
    clearTimeout(reconnectFlickerTimer);
    reconnectFlickerTimer = setTimeout(() => { if (shouldListen && !recognitionActive) micStatus("reconnecting") }, RECONNECT_FLICKER_MS);
    setTimeout(() => { if (shouldListen) safeStartRecognition() }, 450);
  };
}

// Belt-and-suspenders: if the recognizer should be running but silently died
// (start() threw, or the browser dropped it without ever firing onend), bring it back.
function watchdogTick() {
  if (!shouldListen || recognitionActive) return;
  micStatus("reconnecting");
  safeStartRecognition();
}

function startSilenceWatchdog() {
  clearInterval(silenceId);
  lastSpeechAt = Date.now();
  silenceId = setInterval(async () => {
    if (state.status !== "recording" || !lastSpeechAt) return;
    if (Date.now() - lastSpeechAt >= SILENCE_LIMIT_MS) {
      clearInterval(silenceId); silenceId = null;
      e.warning.textContent = "No voice detected for 10 minutes — meeting stopped automatically.";
      e.warning.classList.remove("hidden");
      await stopMeeting(false);
    }
  }, 15000);
}
function stopSilenceWatchdog() { clearInterval(silenceId); silenceId = null }

async function acquireWakeLock() {
  try { if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen") } catch (err) { console.warn("screen wake lock unavailable:", err) }
}
function releaseWakeLock() { try { wakeLock?.release() } catch {} wakeLock = null }
// Wake locks are released by the browser whenever the tab is hidden; grab it back once it's visible again.
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && state.status === "recording" && !wakeLock) acquireWakeLock() });

function waitGoogle() { return new Promise((res, rej) => { const end = Date.now() + 10000; (function c() { if (window.google?.accounts?.oauth2) return res(); if (Date.now() > end) return rej(new Error("Google sign-in library did not load.")); setTimeout(c, 150) })() }) }
async function requestGoogleToken() { const id = window.APP_CONFIG?.GOOGLE_CLIENT_ID; if (!id || id.startsWith("YOUR_")) throw new Error("Add your Google OAuth Client ID to config.js first."); await waitGoogle(); if (!tokenClient) tokenClient = google.accounts.oauth2.initTokenClient({ client_id: id, scope: SCOPE, callback: () => {}, error_callback: err => console.error("Google OAuth popup error:", err) }); return await new Promise((res, rej) => { tokenClient.callback = r => r?.error ? rej(new Error(r.error_description || r.error)) : res(r.access_token); tokenClient.error_callback = err => { const m = err?.type === "popup_closed" ? "Google sign-in was canceled. You can try again." : err?.type === "popup_failed_to_open" ? "Google sign-in popup was blocked. Allow popups and try again." : "Google sign-in failed. Please try again."; rej(new Error(m)) }; tokenClient.requestAccessToken({ prompt: "select_account" }) }) }
async function loadGoogleUser() { const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } }); if (!r.ok) throw new Error("Could not read Google account profile."); return await r.json() }
async function signIn() { e.signIn.disabled = true; e.signIn.textContent = "Signing in…"; try { accessToken = await requestGoogleToken(); const u = await loadGoogleUser(); e.userName.textContent = u.name || "Google user"; e.userEmail.textContent = u.email || ""; e.account.classList.remove("hidden"); e.signIn.classList.add("hidden"); updateStart() } finally { e.signIn.disabled = false; e.signIn.textContent = "Sign in with Google" } }
async function switchAccount() { try { accessToken = await requestGoogleToken(); const u = await loadGoogleUser(); e.userName.textContent = u.name || "Google user"; e.userEmail.textContent = u.email || ""; updateStart() } catch (err) { alert(err.message || "Could not switch Google account.") } }
function signOut() { accessToken = null; e.userName.textContent = ""; e.userEmail.textContent = ""; e.account.classList.add("hidden"); e.signIn.classList.remove("hidden"); updateStart() }
function fmt(sec) { const h = Math.floor(sec / 3600).toString().padStart(2, "0"), m = Math.floor(sec % 3600 / 60).toString().padStart(2, "0"), s = Math.floor(sec % 60).toString().padStart(2, "0"); return `${h}:${m}:${s}` }
function updateTimer() { if (!state.startedAt) return; const end = state.endedAt ? new Date(state.endedAt).getTime() : Date.now(), v = fmt(Math.max(0, Math.floor((end - new Date(state.startedAt).getTime()) / 1000))); e.timer.textContent = v; e.pausedTimer.textContent = v }
function startTimer() { clearInterval(timerId); updateTimer(); timerId = setInterval(updateTimer, 1000) }
function stopTimer() { clearInterval(timerId); timerId = null; updateTimer() }

async function startMeeting() {
  state = { ...fresh(), meetingWith: e.meetingWith.value.trim(), startedAt: new Date().toISOString(), status: "recording" };
  shouldListen = true; lastFinal = "";
  render(); startTimer(); startSilenceWatchdog(); acquireWakeLock();
  micStatus("reconnecting");
  await saveLocal();
  safeStartRecognition();
}
async function pauseMeeting() {
  shouldListen = false; state.notes = e.notes.value; state.status = "paused";
  safeStopRecognition(); stopSilenceWatchdog(); releaseWakeLock();
  render(); await saveLocal();
}
async function resumeMeeting() {
  state.notes = e.pausedNotes.value; state.status = "recording"; shouldListen = true;
  render(); startSilenceWatchdog(); acquireWakeLock();
  micStatus("reconnecting");
  await saveLocal();
  safeStartRecognition();
}
function pad(n) { return String(n).padStart(2, "0") }
function stamp(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}` }
function slug(v) { return v.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 60) || "meeting" }
function filename() { return `${stamp(new Date(state.endedAt))}-meeting-with-${slug(state.meetingWith)}.md` }
function markdown() { const transcript = state.segments.map(x => x.text).join("\n\n") || "_No transcript captured._", notes = state.notes.trim() || "_No personal notes._"; return `# Meeting with ${state.meetingWith}\n\n**Started:** ${new Date(state.startedAt).toLocaleString()}  \n**Ended:** ${new Date(state.endedAt).toLocaleString()}\n\n## Personal Notes\n\n${notes}\n\n## Transcript\n\n${transcript}\n` }
async function driveFetch(url, opt = {}) { if (!accessToken) throw new Error("Google sign-in expired. Please sign in again."); return fetch(url, { ...opt, headers: { ...(opt.headers || {}), Authorization: `Bearer ${accessToken}` } }) }
function esc(v) { return v.replace(/\\/g, "\\\\").replace(/'/g, "\\'") }
async function folder() { const name = window.APP_CONFIG?.DRIVE_FOLDER_NAME || "Meeting Notes", url = new URL("https://www.googleapis.com/drive/v3/files"); url.searchParams.set("q", `name='${esc(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`); url.searchParams.set("fields", "files(id,name)"); const r = await driveFetch(url); if (!r.ok) throw new Error("Could not search Drive folder."); const d = await r.json(); if (d.files?.length) return d.files[0].id; const c = await driveFetch("https://www.googleapis.com/drive/v3/files?fields=id", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder" }) }); if (!c.ok) throw new Error("Could not create Drive folder."); return (await c.json()).id }
function multi(meta, content) { const b = `notes_${crypto.randomUUID()}`; return { b, body: [`--${b}`, "Content-Type: application/json; charset=UTF-8", "", JSON.stringify(meta), `--${b}`, "Content-Type: text/markdown; charset=UTF-8", "", content, `--${b}--`].join("\r\n") } }
async function upload() { const fid = await folder(), m = multi({ name: state.filename, parents: [fid], mimeType: "text/markdown" }, markdown()); const r = await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink", { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${m.b}` }, body: m.body }); if (!r.ok) throw new Error(`Drive upload failed (${r.status}).`); return r.json() }
async function stopMeeting(paused = false) {
  shouldListen = false;
  state.notes = paused ? e.pausedNotes.value : e.notes.value;
  state.endedAt = new Date().toISOString();
  state.status = "done";
  state.filename = filename();
  safeStopRecognition(); stopTimer(); stopSilenceWatchdog(); releaseWakeLock();
  render();
  e.saveStatus.textContent = "Saving Markdown to Google Drive…";
  await saveLocal();
  try { const f = await upload(); state.driveUrl = f.webViewLink || null; e.saveStatus.textContent = "Saved to your Google Drive."; render(); await saveLocal() }
  catch (err) { e.saveStatus.textContent = `Could not save to Drive: ${err.message}` }
}
async function newMeeting() { state = fresh(); lastFinal = ""; render(); await saveLocal() }
function toggle(panel) { panel.classList.toggle("hidden") }

e.signIn.onclick = () => signIn().catch(err => alert(err.message));
e.switchAccount.onclick = () => switchAccount();
e.signOut.onclick = signOut;
e.meetingWith.oninput = updateStart;
e.start.onclick = () => startMeeting();
e.pause.onclick = () => pauseMeeting();
e.resume.onclick = () => resumeMeeting();
e.stop.onclick = () => stopMeeting(false);
e.pausedStop.onclick = () => stopMeeting(true);
e.notes.oninput = x => { state.notes = x.target.value; e.pausedNotes.value = state.notes; saveLocal() };
e.pausedNotes.oninput = x => { state.notes = x.target.value; e.notes.value = state.notes; saveLocal() };
e.showTranscript.onclick = () => toggle(e.transcriptPanel);
e.hideTranscript.onclick = () => toggle(e.transcriptPanel);
e.showPausedTranscript.onclick = () => toggle(e.pausedTranscriptPanel);
e.hidePausedTranscript.onclick = () => toggle(e.pausedTranscriptPanel);
e.viewDoneTranscript.onclick = () => toggle(e.doneTranscriptPanel);
e.hideDoneTranscript.onclick = () => toggle(e.doneTranscriptPanel);
e.newMeeting.onclick = () => newMeeting();

setupSpeech();
await loadLocal();
if (state.status === "recording") { state.status = "paused"; await saveLocal() } // recognition can't survive a reload — resume manually
render();
watchdogId = setInterval(watchdogTick, WATCHDOG_MS);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(() => {});
