const DB_NAME = "meeting-notes-db";
const STORE_NAME = "drafts";
const ACTIVE_KEY = "active-meeting";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const elements = {
  title: document.querySelector("#meetingTitle"),
  participants: document.querySelector("#participants"),
  start: document.querySelector("#startButton"),
  pause: document.querySelector("#pauseButton"),
  stop: document.querySelector("#stopButton"),
  mark: document.querySelector("#markImportantButton"),
  transcript: document.querySelector("#transcript"),
  interim: document.querySelector("#interimTranscript"),
  notes: document.querySelector("#personalNotes"),
  status: document.querySelector("#recognitionStatus"),
  dot: document.querySelector("#listeningDot"),
  timer: document.querySelector("#meetingTimer"),
  connectDrive: document.querySelector("#connectDriveButton"),
  saveDrive: document.querySelector("#saveDriveButton"),
  download: document.querySelector("#downloadButton"),
  driveStatus: document.querySelector("#driveStatus"),
  saveResult: document.querySelector("#saveResult"),
  newMeeting: document.querySelector("#newMeetingButton"),
  clearLocal: document.querySelector("#clearLocalButton"),
  compatibility: document.querySelector("#compatibilityWarning"),
  network: document.querySelector("#networkStatus")
};

let recognition = null;
let shouldListen = false;
let state = defaultState();
let accessToken = null;
let tokenClient = null;
let saveTimer = null;
let clockTimer = null;
let lastFinalNormalized = "";

function defaultState() {
  return {
    id: crypto.randomUUID(),
    title: "",
    participants: "",
    startedAt: null,
    endedAt: null,
    transcriptSegments: [],
    importantMarkers: [],
    notes: "",
    driveFileId: null,
    driveWebViewLink: null,
    updatedAt: new Date().toISOString()
  };
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveLocal() {
  state.title = elements.title.value.trim();
  state.participants = elements.participants.value.trim();
  state.notes = elements.notes.value;
  state.updatedAt = new Date().toISOString();

  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(state, ACTIVE_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function loadLocal() {
  const db = await openDatabase();
  const saved = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(ACTIVE_KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  if (saved) state = saved;
  renderState();
}

async function clearLocal() {
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(ACTIVE_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function normalizeText(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

function formatClock(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function renderState() {
  elements.title.value = state.title || "";
  elements.participants.value = state.participants || "";
  elements.notes.value = state.notes || "";
  elements.transcript.innerHTML = "";

  state.transcriptSegments.forEach((segment, index) => {
    const span = document.createElement("span");
    span.textContent = `${segment.text} `;
    if (state.importantMarkers.includes(index)) {
      span.className = "important-line";
      span.textContent = `★ ${segment.text} `;
    }
    elements.transcript.appendChild(span);
  });
  elements.transcript.scrollTop = elements.transcript.scrollHeight;

  if (state.startedAt) {
    updateClock();
  }
}

function setRecognitionStatus(text, active = false) {
  elements.status.textContent = text;
  elements.dot.classList.toggle("active", active);
}

function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    elements.compatibility.textContent =
      "This browser does not support the required SpeechRecognition API. Use current Chrome on Android or test Safari on iPhone before relying on it.";
    elements.compatibility.classList.remove("hidden");
    elements.start.disabled = true;
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";
  recognition.maxAlternatives = 1;

  recognition.onstart = () => setRecognitionStatus("Listening", true);

  recognition.onresult = async (event) => {
    let interimText = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result[0].transcript.trim();
      if (!text) continue;

      if (result.isFinal) {
        const normalized = normalizeText(text);
        if (normalized && normalized !== lastFinalNormalized) {
          state.transcriptSegments.push({
            text,
            capturedAt: new Date().toISOString(),
            confidence: Number.isFinite(result[0].confidence) ? result[0].confidence : null
          });
          lastFinalNormalized = normalized;
          elements.interim.textContent = "";
          renderState();
          await saveLocal();
        }
      } else {
        interimText += `${text} `;
      }
    }
    elements.interim.textContent = interimText.trim();
  };

  recognition.onerror = (event) => {
    const fatal = ["not-allowed", "service-not-allowed", "audio-capture"];
    setRecognitionStatus(`Speech error: ${event.error}`, false);
    if (fatal.includes(event.error)) shouldListen = false;
  };

  recognition.onend = () => {
    setRecognitionStatus(shouldListen ? "Restarting…" : "Paused", false);
    if (shouldListen) {
      window.setTimeout(() => {
        try { recognition.start(); } catch (_) {}
      }, 450);
    }
  };
}

async function startMeeting() {
  if (!recognition) return;
  if (!state.startedAt) state.startedAt = new Date().toISOString();
  state.endedAt = null;
  shouldListen = true;
  elements.start.disabled = true;
  elements.pause.disabled = false;
  elements.stop.disabled = false;
  elements.mark.disabled = false;
  startClock();
  await saveLocal();
  try { recognition.start(); } catch (_) {}
}

function pauseMeeting() {
  shouldListen = false;
  elements.start.disabled = false;
  elements.pause.disabled = true;
  setRecognitionStatus("Paused", false);
  try { recognition.stop(); } catch (_) {}
}

async function stopMeeting() {
  shouldListen = false;
  state.endedAt = new Date().toISOString();
  elements.start.disabled = false;
  elements.pause.disabled = true;
  elements.stop.disabled = true;
  elements.mark.disabled = true;
  setRecognitionStatus("Stopped", false);
  stopClock();
  try { recognition.stop(); } catch (_) {}
  await saveLocal();
}

async function markImportant() {
  if (!state.transcriptSegments.length) return;
  const index = state.transcriptSegments.length - 1;
  if (!state.importantMarkers.includes(index)) {
    state.importantMarkers.push(index);
    renderState();
    await saveLocal();
  }
}

function updateClock() {
  if (!state.startedAt) {
    elements.timer.textContent = "00:00:00";
    return;
  }
  const end = state.endedAt ? new Date(state.endedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.floor((end - new Date(state.startedAt).getTime()) / 1000));
  elements.timer.textContent = formatClock(seconds);
}

function startClock() {
  stopClock();
  updateClock();
  clockTimer = window.setInterval(updateClock, 1000);
}

function stopClock() {
  if (clockTimer) window.clearInterval(clockTimer);
  clockTimer = null;
  updateClock();
}

function escapeMarkdown(value) {
  return String(value || "").replace(/\r/g, "").trim();
}

function createMarkdown() {
  const title = escapeMarkdown(elements.title.value) || "Untitled Meeting";
  const participants = escapeMarkdown(elements.participants.value) || "Not specified";
  const started = state.startedAt ? new Date(state.startedAt).toLocaleString() : new Date().toLocaleString();
  const ended = state.endedAt ? new Date(state.endedAt).toLocaleString() : "Not stopped";
  const transcript = state.transcriptSegments.map((segment, index) =>
    state.importantMarkers.includes(index) ? `> **Important:** ${segment.text}` : segment.text
  ).join("\n\n");

  return `# ${title}

**Started:** ${started}  
**Ended:** ${ended}  
**Participants:** ${participants}

## Important Points

${state.importantMarkers.length
  ? state.importantMarkers.map(index => `- ${state.transcriptSegments[index]?.text || ""}`).join("\n")
  : "_No points marked._"}

## Personal Notes

${escapeMarkdown(elements.notes.value) || "_No personal notes._"}

## Transcript

${transcript || "_No transcript captured._"}

---
Created with Personal Meeting Notes. No audio file was saved by the application.
`;
}

function slugify(value) {
  return value.toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60) || "meeting";
}

function buildFilename() {
  const date = (state.startedAt ? new Date(state.startedAt) : new Date()).toISOString().slice(0, 10);
  return `${date}-${slugify(elements.title.value || "meeting")}.md`;
}

function downloadMarkdown() {
  const blob = new Blob([createMarkdown()], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = buildFilename();
  anchor.click();
  URL.revokeObjectURL(url);
}

function waitForGoogleLibrary() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 10000;
    const check = () => {
      if (window.google?.accounts?.oauth2) return resolve();
      if (Date.now() > deadline) return reject(new Error("Google authorization library did not load."));
      window.setTimeout(check, 150);
    };
    check();
  });
}

async function connectDrive() {
  const clientId = window.APP_CONFIG?.GOOGLE_CLIENT_ID;
  if (!clientId || clientId.startsWith("YOUR_")) {
    throw new Error("Add your Google OAuth Client ID to config.js first.");
  }

  await waitForGoogleLibrary();

  if (!tokenClient) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: () => {}
    });
  }

  accessToken = await new Promise((resolve, reject) => {
    tokenClient.callback = (response) => {
      if (response.error) return reject(new Error(response.error_description || response.error));
      resolve(response.access_token);
    };
    tokenClient.requestAccessToken({ prompt: accessToken ? "" : "consent" });
  });

  elements.driveStatus.textContent = "Connected";
  elements.driveStatus.classList.remove("muted");
  elements.saveDrive.disabled = false;
  elements.saveResult.textContent = "Google Drive connected.";
}

async function driveFetch(url, options = {}) {
  if (!accessToken) throw new Error("Connect Google Drive first.");
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (response.status === 401) {
    accessToken = null;
    elements.driveStatus.textContent = "Reconnect required";
    elements.driveStatus.classList.add("muted");
    elements.saveDrive.disabled = true;
  }
  return response;
}

function escapeDriveQuery(value) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findOrCreateFolder() {
  const folderName = window.APP_CONFIG?.DRIVE_FOLDER_NAME || "Meeting Notes";
  const q = `name='${escapeDriveQuery(folderName)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchUrl = new URL("https://www.googleapis.com/drive/v3/files");
  searchUrl.searchParams.set("q", q);
  searchUrl.searchParams.set("spaces", "drive");
  searchUrl.searchParams.set("fields", "files(id,name)");
  searchUrl.searchParams.set("pageSize", "10");

  const searchResponse = await driveFetch(searchUrl);
  if (!searchResponse.ok) throw new Error(`Folder search failed (${searchResponse.status}).`);
  const searchResult = await searchResponse.json();
  if (searchResult.files?.length) return searchResult.files[0].id;

  const createResponse = await driveFetch(
    "https://www.googleapis.com/drive/v3/files?fields=id,name",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: folderName,
        mimeType: "application/vnd.google-apps.folder"
      })
    }
  );
  if (!createResponse.ok) throw new Error(`Folder creation failed (${createResponse.status}).`);
  return (await createResponse.json()).id;
}

function multipartBody(metadata, content, mimeType) {
  const boundary = `meeting_notes_${crypto.randomUUID()}`;
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${mimeType}; charset=UTF-8`,
    "",
    content,
    `--${boundary}--`
  ].join("\r\n");

  return { boundary, body };
}

async function createDriveFile(folderId, filename, markdown) {
  const { boundary, body } = multipartBody({
    name: filename,
    parents: [folderId],
    mimeType: "text/markdown"
  }, markdown, "text/markdown");

  const response = await driveFetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,modifiedTime",
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body
    }
  );
  if (!response.ok) throw new Error(`Drive upload failed (${response.status}): ${await response.text()}`);
  return response.json();
}

async function updateDriveFile(fileId, filename, markdown) {
  const { boundary, body } = multipartBody({
    name: filename,
    mimeType: "text/markdown"
  }, markdown, "text/markdown");

  const response = await driveFetch(
    `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id,name,webViewLink,modifiedTime`,
    {
      method: "PATCH",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body
    }
  );
  if (!response.ok) throw new Error(`Drive update failed (${response.status}): ${await response.text()}`);
  return response.json();
}

async function saveToDrive() {
  elements.saveDrive.disabled = true;
  elements.saveResult.textContent = "Saving...";
  try {
    await saveLocal();
    const folderId = await findOrCreateFolder();
    const markdown = createMarkdown();
    const filename = buildFilename();

    const file = state.driveFileId
      ? await updateDriveFile(state.driveFileId, filename, markdown)
      : await createDriveFile(folderId, filename, markdown);

    state.driveFileId = file.id;
    state.driveWebViewLink = file.webViewLink || null;
    await saveLocal();

    elements.saveResult.innerHTML = state.driveWebViewLink
      ? `Saved as <strong>${file.name}</strong>. <a href="${state.driveWebViewLink}" target="_blank" rel="noopener">Open in Drive</a>`
      : `Saved as ${file.name}.`;
  } catch (error) {
    elements.saveResult.textContent = error.message || "Unable to save to Drive.";
  } finally {
    elements.saveDrive.disabled = !accessToken;
  }
}

async function resetMeeting() {
  shouldListen = false;
  try { recognition?.stop(); } catch (_) {}
  stopClock();
  state = defaultState();
  lastFinalNormalized = "";
  renderState();
  setRecognitionStatus("Ready", false);
  elements.interim.textContent = "";
  elements.start.disabled = !recognition;
  elements.pause.disabled = true;
  elements.stop.disabled = true;
  elements.mark.disabled = true;
  elements.saveResult.textContent = "";
  await saveLocal();
}

async function deleteLocalCopy() {
  if (!confirm("Clear the local meeting copy from this device? This does not delete any file already saved in Google Drive.")) return;
  await clearLocal();
  await resetMeeting();
}

function updateNetworkStatus() {
  const online = navigator.onLine;
  elements.network.textContent = online ? "Online" : "Offline";
  elements.network.classList.toggle("muted", !online);
}

function scheduleLocalSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => saveLocal().catch(console.error), 400);
}

elements.start.addEventListener("click", () => startMeeting().catch(console.error));
elements.pause.addEventListener("click", pauseMeeting);
elements.stop.addEventListener("click", () => stopMeeting().catch(console.error));
elements.mark.addEventListener("click", () => markImportant().catch(console.error));
elements.connectDrive.addEventListener("click", () => connectDrive().catch(error => {
  elements.saveResult.textContent = error.message;
}));
elements.saveDrive.addEventListener("click", saveToDrive);
elements.download.addEventListener("click", downloadMarkdown);
elements.newMeeting.addEventListener("click", () => resetMeeting().catch(console.error));
elements.clearLocal.addEventListener("click", () => deleteLocalCopy().catch(console.error));
elements.title.addEventListener("input", scheduleLocalSave);
elements.participants.addEventListener("input", scheduleLocalSave);
elements.notes.addEventListener("input", scheduleLocalSave);
window.addEventListener("online", updateNetworkStatus);
window.addEventListener("offline", updateNetworkStatus);
window.addEventListener("beforeunload", () => {
  state.title = elements.title.value.trim();
  state.participants = elements.participants.value.trim();
  state.notes = elements.notes.value;
});

setupSpeechRecognition();
updateNetworkStatus();
await loadLocal();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./service-worker.js").catch(console.error);
}
