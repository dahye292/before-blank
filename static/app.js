// 비포블랭크(Before Blank, 비비) — 프론트엔드 (프레임워크 없이 해시 라우팅)
//   #/login, #/signup        로그인 · 회원가입 (로그인 전에는 이 화면만 보인다)
//   #/forgot, #/reset?token= 비밀번호 찾기 · 새 비밀번호 정하기
//   #/                       홈: 주제 목록
//   #/new                    새 주제 시작
//   #/topic/:id              주제 > 대화 탭  (?turn=ID 로 특정 대화 위치로 이동)
//   #/topic/:id/map          주제 > 마인드맵 탭
const $app = document.getElementById("app");
const cfg = { min_thought: 20, demo: false };
const state = {
  q: "",              // 홈 검색어
  filter: "all",      // all | starred | in_progress | done
  folder: "all",      // all | none(폴더 없음) | 폴더 id
  folders: null,
  drafts: {},         // 주제별 작성 중인 질문/생각 (탭을 오가도 유지)
  user: undefined,    // 로그인한 사람 (undefined: 아직 모름, null: 로그인 안 함)
};
let resizeObs = null;

// ---------- 공통 ----------
const api = async (path, opts = {}) => {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith("/api/login") && !path.startsWith("/api/me")) {
    // 로그인이 풀렸으면 로그인 화면으로
    state.user = null;
    if (!["#/login", "#/signup"].includes(location.hash)) location.hash = "#/login";
  }
  if (!res.ok) throw new Error(data.error || "요청에 실패했어요.");
  return data;
};

const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fmtDate = (iso, withTime = true) => {
  if (!iso) return "";
  const d = new Date(iso);
  const date = `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
  return withTime ? `${date} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : date;
};

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

// 확인·입력 대화상자. 확인하면 true(입력칸이 있으면 입력한 글), 취소하면 null
function ask({ title, message = "", input = null, confirmText = "확인", cancelText = "취소", danger = false }) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const wrap = document.createElement("div");
    wrap.className = "dlg-backdrop";
    wrap.innerHTML = `
      <form class="dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <h2 id="dlg-title">${esc(title)}</h2>
        ${message ? `<p class="dlg-msg">${esc(message)}</p>` : ""}
        ${input ? `<input class="dlg-input" type="${input.type || "text"}" maxlength="${input.maxlength || 40}"
            value="${esc(input.value || "")}" placeholder="${esc(input.placeholder || "")}" aria-label="${esc(title)}" autocomplete="off">` : ""}
        <p class="form-err" role="alert"></p>
        <div class="dlg-btns">
          <button type="button" class="btn" data-dlg="cancel">${esc(cancelText)}</button>
          <button type="submit" class="btn btn-primary ${danger ? "danger-solid" : ""}">${esc(confirmText)}</button>
        </div>
      </form>`;
    document.body.appendChild(wrap);
    const form = wrap.querySelector("form");
    const $in = wrap.querySelector(".dlg-input");
    const close = (val) => { wrap.remove(); document.removeEventListener("keydown", onKey); prevFocus?.focus?.(); resolve(val); };
    const onKey = (e) => { if (e.key === "Escape") close(null); };
    document.addEventListener("keydown", onKey);
    wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) close(null); });
    wrap.querySelector('[data-dlg="cancel"]').onclick = () => close(null);
    form.onsubmit = (e) => {
      e.preventDefault();
      if ($in) {
        const v = $in.value.trim();
        if (!v) { wrap.querySelector(".form-err").textContent = "내용을 입력해 주세요."; $in.focus(); return; }
        close(v);
      } else close(true);
    };
    ($in || form.querySelector("[type=submit]")).focus();
    if ($in) $in.select();
  });
}

// 비포블랭크 아이콘: 빈칸(점선 상자) 앞에 먼저 놓인 내 생각(호박색 점). 테마에 맞게 색이 바뀐다
const LOGO = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true">
  <rect x="13" y="8.5" width="12.5" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="3 2.4"/>
  <circle cx="8" cy="16" r="3.3" fill="var(--mine)"/></svg>`;

const statusBadge = (s) =>
  s === "done" ? `<span class="status done"><i></i>완료</span>` : `<span class="status in_progress"><i></i>진행중</span>`;

function paintStatusToggle($btn, s) {
  $btn.dataset.status = s;
  $btn.className = `status status-toggle ${s}`;
  $btn.innerHTML = s === "done" ? "<i></i>완료" : "<i></i>진행중";
  $btn.title = s === "done" ? "누르면 다시 진행중으로 바뀌어요" : "누르면 완료로 바뀌어요";
  $btn.setAttribute("aria-label", s === "done" ? "완료 상태. 눌러서 진행중으로 바꾸기" : "진행중 상태. 눌러서 완료로 바꾸기");
}

// 테마: 기본은 어두운 화면. 고른 값은 이 브라우저에 기억한다
const currentTheme = () => document.documentElement.dataset.theme === "light" ? "light" : "dark";
// 계정 버튼(로그아웃·탈퇴)과 헷갈리지 않게, 글자 버튼이 아니라 해·달 모양 스위치로 만든다
const SUN = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.2"/><path d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M3.2 12.8l1.1-1.1M11.7 4.3l1.1-1.1"/></svg>`;
const MOON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.2 10.1A5.6 5.6 0 0 1 5.9 2.8a5.6 5.6 0 1 0 7.3 7.3z"/></svg>`;
const themeToggle = () => {
  const dark = currentTheme() === "dark";
  return `<button class="theme-switch" data-theme-toggle role="switch" aria-checked="${dark}" aria-label="어두운 화면" title="${dark ? "밝은 화면으로" : "어두운 화면으로"}">
    <span class="ts-icon ts-sun">${SUN}</span><span class="ts-icon ts-moon">${MOON}</span><span class="ts-knob"></span>
  </button>`;
};
document.addEventListener("click", (e) => {
  if (!e.target.closest("[data-theme-toggle]")) return;
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("tf-theme", next); } catch { /* 기억 못 해도 괜찮음 */ }
  document.querySelectorAll("[data-theme-toggle]").forEach((b) => {
    b.setAttribute("aria-checked", String(next === "dark"));
    b.title = next === "dark" ? "밝은 화면으로" : "어두운 화면으로";
  });
  const $map = document.getElementById("cmap");
  if ($map) drawMapLines($map);
});

const starBtn = (on, label) =>
  `<button class="star ${on ? "on" : ""}" data-star aria-pressed="${on ? "true" : "false"}" title="${on ? "중요 표시 해제" : "중요 표시"}" aria-label="${esc(label)} 중요 표시">${on ? "★" : "☆"}</button>`;

// 아주 작은 마크다운 렌더러 (먼저 HTML을 이스케이프해서 안전하게)
function md(src) {
  const lines = esc(src).split("\n");
  let html = "", list = null, inCode = false, code = [];
  const inline = (s) =>
    s.replace(/`([^`]+)`/g, "<code>$1</code>")
     .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
     .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCode) { html += `<pre><code>${code.join("\n")}</code></pre>`; code = []; inCode = false; }
      else { closeList(); inCode = true; }
      continue;
    }
    if (inCode) { code.push(line); continue; }
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)/))) { closeList(); html += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`; }
    else if ((m = line.match(/^\s*[-*]\s+(.*)/))) { if (list !== "ul") { closeList(); html += "<ul>"; list = "ul"; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = line.match(/^\s*\d+\.\s+(.*)/))) { if (list !== "ol") { closeList(); html += "<ol>"; list = "ol"; } html += `<li>${inline(m[1])}</li>`; }
    else if (!line.trim()) { closeList(); }
    else { closeList(); html += `<p>${inline(line)}</p>`; }
  }
  if (inCode) html += `<pre><code>${code.join("\n")}</code></pre>`;
  closeList();
  return html;
}

const THOUGHT_PROMPTS = ["내가 생각하는 답은 …", "그렇게 생각하는 이유는 …", "확실하지 않은 부분은 …", "AI에게 특히 확인하고 싶은 건 …"];

// 생각 입력칸: 문장 시작 버튼 + 글자 수 카운터
function bindThought($t, $counter, onChange) {
  const update = () => {
    const n = $t.value.trim().length;
    $counter.textContent = n >= cfg.min_thought ? `${n}자 · 이제 AI 답을 볼 수 있어요` : `${cfg.min_thought - n}자 더 쓰면 AI 답이 열려요`;
    $counter.classList.toggle("ok", n >= cfg.min_thought);
    onChange?.();
  };
  $t.addEventListener("input", update);
  $t.parentElement.querySelectorAll("[data-p]").forEach((b) => {
    b.onclick = () => {
      const sep = $t.value && !$t.value.endsWith("\n") ? "\n" : "";
      $t.value += sep + b.dataset.p.replace(" …", " ");
      $t.focus();
      update();
    };
  });
  update();
}
const promptButtons = () => `<div class="prompts">${THOUGHT_PROMPTS.map((p) => `<button type="button" data-p="${p}">${p}</button>`).join("")}</div>`;

// ---------- 홈: 주제 목록 ----------
async function viewHome() {
  const mascot = document.getElementById("mascot-template").innerHTML;
  $app.innerHTML = `
    <div class="home">
      <div class="home-top">
        <span class="wordmark">${LOGO}<span><b>비포블랭크</b> Before Blank</span>${cfg.demo ? `<span class="demo-pill">데모 모드</span>` : ""}</span>
        <div class="top-right">
          <div class="account">
            <span class="who">${esc(state.user?.name || "")}</span>
            <button class="btn btn-ghost btn-sm" id="logout">로그아웃</button>
            <button class="btn btn-ghost btn-sm danger" id="delete-account">탈퇴</button>
          </div>
          <span class="top-sep" aria-hidden="true"></span>
          ${themeToggle()}
        </div>
      </div>
      <header class="home-hero">
        <div class="mascot">${mascot}</div>
        <h1>주제</h1>
      </header>
      <div class="toolbar">
        <input type="search" id="search" placeholder="주제·질문·생각·답 검색" value="${esc(state.q)}">
        <a class="btn btn-primary" href="#/new">+ 새 주제</a>
      </div>
      <div class="folders" id="folders"></div>
      <div class="filters" id="filters"></div>
      <ul class="topic-rows" id="topic-rows"></ul>
    </div>`;

  document.getElementById("logout").onclick = logout;
  document.getElementById("delete-account").onclick = deleteAccount;
  let timer;
  document.getElementById("search").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.q = e.target.value.trim(); loadTopicRows(); }, 250);
  });
  await loadTopicRows();
}

async function loadTopicRows() {
  const [all, folders] = await Promise.all([
    api(`/api/topics?${new URLSearchParams({ q: state.q })}`),
    api("/api/folders"),
  ]);
  state.folders = folders;
  const $rows = document.getElementById("topic-rows");
  if (!$rows) return;
  // 고른 폴더가 지워졌으면 전체로
  if (typeof state.folder === "number" && !folders.some((f) => f.id === state.folder)) state.folder = "all";

  const inFolder = all.filter((t) =>
    state.folder === "all" ? true : state.folder === "none" ? t.folder_id == null : t.folder_id === state.folder);
  const counts = {
    all: inFolder.length,
    starred: inFolder.filter((t) => t.is_starred).length,
    in_progress: inFolder.filter((t) => t.status === "in_progress").length,
    done: inFolder.filter((t) => t.status === "done").length,
  };
  const pass = {
    all: () => true, starred: (t) => t.is_starred,
    in_progress: (t) => t.status === "in_progress", done: (t) => t.status === "done",
  }[state.filter];
  const list = inFolder.filter(pass);
  const folderName = Object.fromEntries(folders.map((f) => [f.id, f.name]));

  // 폴더 줄: 전체 · 폴더 없음 · 폴더들 · + 새 폴더
  const noneCount = all.filter((t) => t.folder_id == null).length;
  const fchip = (key, label, n) =>
    `<button class="folder-chip ${state.folder === key ? "active" : ""}" data-folder="${key}">${esc(label)} <span>${n}</span></button>`;
  const cur = typeof state.folder === "number" ? folders.find((f) => f.id === state.folder) : null;
  document.getElementById("folders").innerHTML = `
    <div class="folder-list" role="tablist" aria-label="폴더">
      ${fchip("all", "모든 주제", all.length)}
      ${fchip("none", "폴더 없음", noneCount)}
      ${folders.map((f) => fchip(f.id, f.name, all.filter((t) => t.folder_id === f.id).length)).join("")}
      <button class="folder-add" id="folder-add">+ 새 폴더</button>
    </div>
    ${cur ? `<div class="folder-actions">
      <span>폴더 <b>${esc(cur.name)}</b></span>
      <button class="btn btn-ghost btn-sm" id="folder-rename">이름 바꾸기</button>
      <button class="btn btn-ghost btn-sm danger" id="folder-delete">폴더 삭제</button>
    </div>` : ""}`;
  document.querySelectorAll("[data-folder]").forEach((b) => (b.onclick = () => {
    const k = b.dataset.folder;
    state.folder = k === "all" || k === "none" ? k : Number(k);
    loadTopicRows();
  }));
  document.getElementById("folder-add").onclick = async () => {
    const name = await ask({ title: "새 폴더", input: { placeholder: "폴더 이름 (예: 진로, 공부)", maxlength: 30 }, confirmText: "만들기" });
    if (!name) return;
    try { const f = await api("/api/folders", { method: "POST", body: { name: name.trim() } }); state.folder = f.id; loadTopicRows(); }
    catch (err) { toast(err.message); }
  };
  if (cur) {
    document.getElementById("folder-rename").onclick = async () => {
      const name = await ask({ title: "폴더 이름 바꾸기", input: { value: cur.name, maxlength: 30 }, confirmText: "바꾸기" });
      if (!name || name === cur.name) return;
      try { await api(`/api/folders/${cur.id}`, { method: "PATCH", body: { name: name.trim() } }); loadTopicRows(); }
      catch (err) { toast(err.message); }
    };
    document.getElementById("folder-delete").onclick = async () => {
      if (!(await ask({ title: `'${cur.name}' 폴더를 지울까요?`, message: "안에 있던 주제는 지우지 않고 '폴더 없음'으로 옮겨요.", confirmText: "폴더 지우기", danger: true }))) return;
      try { await api(`/api/folders/${cur.id}`, { method: "DELETE" }); state.folder = "all"; loadTopicRows(); }
      catch (err) { toast(err.message); }
    };
  }

  const chip = (k, label) => `<button class="filter ${state.filter === k ? "active" : ""}" data-f="${k}">${label} <span>${counts[k]}</span></button>`;
  document.getElementById("filters").innerHTML =
    chip("all", "전체") + chip("starred", "★ 중요") + chip("in_progress", "진행중") + chip("done", "완료");
  document.querySelectorAll(".filter").forEach((b) => (b.onclick = () => { state.filter = b.dataset.f; loadTopicRows(); }));

  if (!list.length) {
    $rows.innerHTML = `<li class="empty">${
      state.q ? "찾는 주제가 없어요."
      : inFolder.length ? { starred: "중요 표시한 주제가 없어요. ☆을 눌러 중요한 주제를 모아 보세요.", in_progress: "진행중인 주제가 없어요.", done: "아직 완료한 주제가 없어요." }[state.filter]
      : all.length ? "이 폴더에는 아직 주제가 없어요.<br>주제 오른쪽의 폴더 메뉴로 옮기거나, 새 주제를 만들어 보세요."
      : "아직 주제가 없어요.<br>궁금한 게 생겼다면, AI에게 묻기 전에 내 생각부터 적어 보세요."}</li>`;
    return;
  }
  const moveSelect = (t) => `
    <select class="move" data-move="${t.id}" aria-label="${esc(t.name)} 폴더 옮기기" title="폴더 옮기기">
      <option value="" ${t.folder_id == null ? "selected" : ""}>폴더 없음</option>
      ${folders.map((f) => `<option value="${f.id}" ${t.folder_id === f.id ? "selected" : ""}>${esc(f.name)}</option>`).join("")}
      <option value="__new">+ 새 폴더…</option>
    </select>`;
  $rows.innerHTML = list.map((t) => `
    <li class="topic-row ${t.status}" data-id="${t.id}">
      ${starBtn(t.is_starred, t.name)}
      <a class="topic-link" href="#/topic/${t.id}">
        <div class="topic-main">
          <div class="topic-name">${esc(t.name)}</div>
          <div class="topic-meta">${state.folder === "all" && t.folder_id != null ? `<span class="meta-folder">${esc(folderName[t.folder_id] || "")}</span> · ` : ""}대화 ${t.turn_count}개 · ${fmtDate(t.updated_at, false)}${t.last_question ? ` · ${esc(t.last_question)}` : ""}</div>
        </div>
        ${statusBadge(t.status)}
      </a>
      ${moveSelect(t)}
    </li>`).join("");

  $rows.querySelectorAll("[data-star]").forEach((b) => {
    b.onclick = async () => {
      const id = b.closest(".topic-row").dataset.id;
      const on = b.getAttribute("aria-pressed") !== "true";
      try { await api(`/api/topics/${id}`, { method: "PATCH", body: { is_starred: on } }); loadTopicRows(); }
      catch (err) { toast(err.message); }
    };
  });
  $rows.querySelectorAll("[data-move]").forEach((sel) => {
    sel.onchange = async () => {
      let folderId = sel.value === "" ? null : sel.value;
      try {
        if (folderId === "__new") {
          const name = await ask({ title: "새 폴더", input: { placeholder: "폴더 이름", maxlength: 30 }, confirmText: "만들고 옮기기" });
          if (!name) { loadTopicRows(); return; }
          folderId = (await api("/api/folders", { method: "POST", body: { name: name.trim() } })).id;
        }
        await api(`/api/topics/${sel.dataset.move}`, { method: "PATCH", body: { folder_id: folderId == null ? null : Number(folderId) } });
        const fname = folderId == null ? "폴더 없음" : (state.folders.find((f) => f.id === Number(folderId))?.name || "새 폴더");
        toast(`'${fname}'(으)로 옮겼어요`);
        loadTopicRows();
      } catch (err) { toast(err.message); loadTopicRows(); }
    };
  });
}

// ---------- 새 주제: 이름만 정하고 바로 대화 화면으로 ----------
async function viewNewTopic() {
  const folders = state.folders || (await api("/api/folders").catch(() => []));
  const preset = typeof state.folder === "number" ? state.folder : "";
  $app.innerHTML = `
    <div class="narrow">
      <a class="back" href="#/">← 주제 목록</a>
      <h1 class="page-title">새 주제</h1>
      <p class="page-sub">무엇에 대해 생각해 볼지 이름만 정하면, 바로 대화 화면으로 넘어가요.</p>
      <form id="new-topic" class="new-topic" novalidate>
        <label class="fld" for="topic-name">
          <span class="fld-label">주제 이름</span>
          <input type="text" id="topic-name" aria-label="주제 이름" maxlength="40" placeholder="예: 데이터 분석 포트폴리오, 공부법" autocomplete="off">
        </label>
        <label class="fld" for="topic-folder">
          <span class="fld-label">폴더 <small>(선택)</small></span>
          <select id="topic-folder" aria-label="폴더">
            <option value="">폴더 없음</option>
            ${folders.map((f) => `<option value="${f.id}" ${preset === f.id ? "selected" : ""}>${esc(f.name)}</option>`).join("")}
          </select>
        </label>
        <p class="form-err" id="form-err" role="alert"></p>
        <button class="btn btn-primary" type="submit" id="submit" disabled>만들고 대화 시작 →</button>
      </form>
      <ol class="flow-preview" aria-label="다음에 할 일">
        <li><span class="step-num">01</span> 질문을 적어요</li>
        <li><span class="step-num">02</span> 내 생각을 ${cfg.min_thought}자 이상 먼저 써요</li>
        <li><span class="step-num">03</span> AI 답을 보고 비교해요</li>
      </ol>
    </div>`;
  const $f = document.getElementById("new-topic");
  const $name = document.getElementById("topic-name");
  const $submit = document.getElementById("submit");
  $name.oninput = () => { $submit.disabled = !$name.value.trim(); document.getElementById("form-err").textContent = ""; };
  $f.onsubmit = async (e) => {
    e.preventDefault();
    if (!$name.value.trim()) return;
    $submit.disabled = true;
    try {
      const folder = document.getElementById("topic-folder").value;
      const { id } = await api("/api/topics", { method: "POST", body: { name: $name.value.trim(), folder_id: folder ? Number(folder) : null } });
      location.hash = `#/topic/${id}`;
    } catch (err) {
      document.getElementById("form-err").textContent = err.message;
      $submit.disabled = false;
    }
  };
  $name.focus();
}

// ---------- 주제 상세 (공통 머리 + 탭) ----------
async function viewTopic(id, tab, opts = {}) {
  let data;
  try { data = await api(`/api/topics/${id}`); }
  catch (err) { $app.innerHTML = `<div class="narrow"><a class="back" href="#/">← 주제 목록</a><div class="empty">${esc(err.message)}</div></div>`; return; }
  const { topic, turns } = data;

  $app.innerHTML = `
    <header class="topic-head">
      <div class="topic-head-inner">
        <div class="topic-title-row">
          <a class="btn btn-ghost" href="#/" aria-label="주제 목록으로">←</a>
          <h1 id="topic-title" title="눌러서 이름 바꾸기">${esc(topic.name)}</h1>
          <div class="topic-actions">
            ${starBtn(topic.is_starred, topic.name)}
            <button class="status status-toggle" id="status-btn"></button>
            <button class="btn btn-ghost danger btn-sm" id="del-topic" title="주제 삭제">삭제</button>
            <span class="top-sep" aria-hidden="true"></span>
            ${themeToggle()}
          </div>
        </div>
        <nav class="tabs">
          <a class="tab ${tab === "chat" ? "active" : ""}" href="#/topic/${id}">대화</a>
          <a class="tab ${tab === "map" ? "active" : ""}" href="#/topic/${id}/map">마인드맵</a>
        </nav>
      </div>
    </header>
    <div id="panel"></div>`;

  bindTopicStar(id, topic);
  // 진행 상태: 배지 자체가 버튼. 진행중을 누르면 완료로 (완료를 누르면 다시 진행중으로)
  const $sb = document.getElementById("status-btn");
  paintStatusToggle($sb, topic.status);
  $sb.onclick = async () => {
    // 대화를 이어 가며 자동으로 바뀐 경우도 있으니, 현재 상태는 버튼에서 읽는다
    const next = $sb.dataset.status === "done" ? "in_progress" : "done";
    try { await api(`/api/topics/${id}`, { method: "PATCH", body: { status: next } }); paintStatusToggle($sb, next); }
    catch (err) { toast(err.message); }
  };
  // 이름 바꾸기
  document.getElementById("topic-title").onclick = async () => {
    const name = await ask({ title: "주제 이름 바꾸기", input: { value: topic.name, maxlength: 40 }, confirmText: "바꾸기" });
    if (!name || name === topic.name) return;
    try { await api(`/api/topics/${id}`, { method: "PATCH", body: { name: name.trim() } }); route(); }
    catch (err) { toast(err.message); }
  };
  // 삭제
  document.getElementById("del-topic").onclick = async () => {
    if (!(await ask({ title: `'${topic.name}' 주제를 지울까요?`, message: `대화 ${turns.length}개와 생각 메모가 모두 지워지고 되돌릴 수 없어요.`, confirmText: "주제 지우기", danger: true }))) return;
    await api(`/api/topics/${id}`, { method: "DELETE" });
    location.hash = "#/";
  };

  const $panel = document.getElementById("panel");
  if (tab === "map") renderMapTab($panel, topic, turns);
  else renderChatTab($panel, topic, turns, opts);
}

function bindTopicStar(id, topic) {
  const $star = $app.querySelector(".topic-head [data-star]");
  $star.onclick = async () => {
    const on = $star.getAttribute("aria-pressed") !== "true";
    try {
      await api(`/api/topics/${id}`, { method: "PATCH", body: { is_starred: on } });
      $star.outerHTML = starBtn(on, topic.name);
      bindTopicStar(id, topic);
    } catch (err) { toast(err.message); }
  };
}

// ---------- 대화 탭 ----------
function turnHTML(t, n) {
  return `
    <article class="turn" id="turn-${t.id}" data-id="${t.id}">
      <header class="turn-meta">
        <span class="turn-no">대화 ${String(n).padStart(2, "0")}</span>
        <span>${fmtDate(t.created_at)}</span>
        <button class="btn btn-ghost danger btn-sm" data-del-turn>삭제</button>
      </header>
      <h2 class="turn-q">${esc(t.question)}</h2>
      ${t.attachments?.length ? `<div class="turn-files" aria-label="첨부 자료">${t.attachments.map(fileChip).join("")}</div>` : ""}
      <section class="block mine">
        <div class="block-label">내 생각 <small>AI 답을 보기 전에 적음</small></div>
        <div class="block-body">${esc(t.my_thought)}</div>
      </section>
      <section class="block ai">
        <div class="block-label">AI <small>내 생각은 보내지 않았어요</small></div>
        <div class="md" data-answer>${t.ai_answer ? md(t.ai_answer) : ""}</div>
        ${t.ai_answer ? "" : `<button class="btn btn-primary btn-sm" data-ask>AI 답 보기</button>`}
      </section>
      <div class="memo" data-memo ${t.ai_answer ? "" : "hidden"}></div>
    </article>`;
}

function renderChatTab($panel, topic, turns, opts) {
  $panel.innerHTML = `
    <div class="chat">
      <div id="turns">${turns.length ? turns.map((t, i) => turnHTML(t, i + 1)).join("") : `
        <div class="chat-start">
          <h2>'${esc(topic.name)}'에 대해 무엇이 궁금한가요?</h2>
          <p>아래 입력창에 첫 질문을 적어 주세요. 이렇게 진행돼요.</p>
          <ol class="flow-preview">
            <li><span class="step-num">01</span> 질문을 적어요</li>
            <li><span class="step-num">02</span> AI에게 보내기 전에 내 생각을 ${cfg.min_thought}자 이상 써요</li>
            <li><span class="step-num">03</span> AI 답을 보고, 내 생각과 비교해 메모해요</li>
          </ol>
        </div>`}</div>
      <div class="composer" id="composer"></div>
    </div>`;

  turns.forEach((t) => bindTurn(t));
  renderComposer(topic, turns);

  if (opts.ask) {
    const t = turns.find((x) => x.id === opts.ask);
    if (t && !t.ai_answer) {
      document.getElementById(`turn-${t.id}`).scrollIntoView({ block: "start" });
      streamAnswer(t);
      return;
    }
  }
  if (opts.turn) jumpToTurn(opts.turn);
  else if (!turns.length) document.getElementById("c-question")?.focus();
  else window.scrollTo(0, document.body.scrollHeight);
}

function bindTurn(t) {
  const $turn = document.getElementById(`turn-${t.id}`);
  const $ask = $turn.querySelector("[data-ask]");
  if ($ask) $ask.onclick = () => streamAnswer(t);
  $turn.querySelector("[data-del-turn]").onclick = async () => {
    if (!(await ask({ title: "이 대화를 지울까요?", message: "질문·내 생각·AI 답·생각 메모가 함께 지워지고 되돌릴 수 없어요.", confirmText: "지우기", danger: true }))) return;
    await api(`/api/turns/${t.id}`, { method: "DELETE" });
    route();
  };
  renderMemo(t);
}

// 생각 메모: 대화 턴마다 하나. 쓴 메모는 바로 보이고, 없으면 '+ 생각 메모' 버튼
function renderMemo(t, editing = false) {
  const $memo = document.querySelector(`#turn-${t.id} [data-memo]`);
  if (!$memo) return;
  const text = t.reflection || "";
  if (editing) {
    $memo.innerHTML = `
      <div class="memo-box">
        <div class="memo-head">생각 메모</div>
        <textarea placeholder="내 생각과 AI 답을 비교해 보니… (같은 점, 다른 점, 그래도 지키고 싶은 생각)">${esc(text)}</textarea>
        <div class="memo-btns">
          <button class="btn btn-ghost btn-sm" data-cancel>취소</button>
          <button class="btn btn-primary btn-sm" data-save>저장</button>
        </div>
      </div>`;
    const $ta = $memo.querySelector("textarea");
    $ta.focus();
    $ta.setSelectionRange($ta.value.length, $ta.value.length);
    $memo.querySelector("[data-cancel]").onclick = () => renderMemo(t);
    $memo.querySelector("[data-save]").onclick = async () => {
      try {
        await api(`/api/turns/${t.id}`, { method: "PATCH", body: { reflection: $ta.value } });
        t.reflection = $ta.value.trim();
        renderMemo(t);
      } catch (err) { toast(err.message); }
    };
    return;
  }
  $memo.innerHTML = text
    ? `<div class="memo-box">
         <div class="memo-head">생각 메모 <button class="btn btn-ghost btn-sm" data-edit>수정</button></div>
         <div class="memo-text">${esc(text)}</div>
       </div>`
    : `<button class="memo-add" data-edit>+ 생각 메모</button>`;
  $memo.querySelector("[data-edit]").onclick = () => renderMemo(t, true);
}

async function streamAnswer(t) {
  const $turn = document.getElementById(`turn-${t.id}`);
  if (!$turn) return;
  const $body = $turn.querySelector("[data-answer]");
  $turn.querySelector("[data-ask]")?.remove();
  $body.classList.add("cursor");
  $body.innerHTML = "";
  let text = "";
  try {
    const res = await fetch(`/api/turns/${t.id}/answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (res.status === 401) { state.user = null; location.hash = "#/login"; return; }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "AI 답을 받지 못했어요.");
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
      $body.innerHTML = md(text);
    }
    if (text.includes("[오류]")) throw new Error(text.slice(text.indexOf("[오류]")));
    t.ai_answer = text;
    const $memo = $turn.querySelector("[data-memo]");
    $memo.hidden = false;
    renderMemo(t);
  } catch (err) {
    $body.innerHTML = `<p class="err">${esc(err.message)}</p>`;
    const retry = document.createElement("button");
    retry.className = "btn btn-primary btn-sm";
    retry.dataset.ask = "";
    retry.textContent = "다시 시도";
    retry.onclick = () => streamAnswer(t);
    $body.after(retry);
  } finally {
    $body.classList.remove("cursor");
  }
}

// 입력창: ① 질문 → ② 내 생각(20자 이상) → AI 답 보기
// ---------- 첨부파일 ----------
const FILE_TYPES = { ".txt": "텍스트", ".md": "텍스트", ".csv": "표", ".pdf": "PDF", ".png": "이미지", ".jpg": "이미지", ".jpeg": "이미지", ".webp": "이미지" };
const MAX_FILES = 3, MAX_MB = 5;
const extOf = (name) => (name.match(/\.[^.]+$/) || [""])[0].toLowerCase();
const fileKindLabel = (name) => FILE_TYPES[extOf(name)] || "파일";
const fmtSize = (n) => n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;
const fileChip = (a) =>
  `<a class="file-chip" href="/api/attachments/${a.id}" download title="${esc(a.filename)} 내려받기"><span class="fc-kind">${fileKindLabel(a.filename)}</span>${esc(a.filename)}<span class="fc-size">${fmtSize(a.size)}</span></a>`;

async function uploadFiles(turnId, files) {
  const fd = new FormData();
  files.forEach((f) => fd.append("files", f));
  const res = await fetch(`/api/turns/${turnId}/attachments`, { method: "POST", headers: { "X-BB-Upload": "1" }, body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "자료를 올리지 못했어요.");
  return data;
}

// 입력창 위의 단계 표시: ① 질문 → ② 내 생각 → ③ AI 답
const composerSteps = (cur) => `
  <ol class="c-steps" aria-label="진행 단계">
    ${["질문", "내 생각", "AI 답"].map((label, i) =>
      `<li class="${i + 1 === cur ? "now" : i + 1 < cur ? "done" : ""}" ${i + 1 === cur ? 'aria-current="step"' : ""}><span>${i + 1}</span>${label}</li>`).join("")}
  </ol>`;

function renderComposer(topic, turns) {
  const $c = document.getElementById("composer");
  const draft = (state.drafts[topic.id] ||= { step: 1, question: "", thought: "", files: [] });
  draft.files ||= [];
  const pendingChips = () => draft.files.map((f, i) =>
    `<span class="file-chip pending"><span class="fc-kind">${fileKindLabel(f.name)}</span>${esc(f.name)}<span class="fc-size">${fmtSize(f.size)}</span>${draft.step === 1 ? `<button type="button" class="fc-x" data-unfile="${i}" aria-label="${esc(f.name)} 빼기">×</button>` : ""}</span>`).join("");

  if (draft.step === 1) {
    $c.innerHTML = `
      <div class="composer-box">
        ${composerSteps(1)}
        <textarea id="c-question" rows="2" aria-label="질문" placeholder="${turns.length ? "이어서 물어볼 질문을 적어 주세요" : "첫 질문을 적어 주세요"}">${esc(draft.question)}</textarea>
        <div class="c-files" id="c-files">${pendingChips()}</div>
        <div class="actions" style="margin-top:4px">
          <label class="attach-btn" title="자료 첨부 (txt, md, csv, pdf, 이미지 · ${MAX_MB}MB, ${MAX_FILES}개까지)">
            <input type="file" id="c-file" multiple accept=".txt,.md,.csv,.pdf,.png,.jpg,.jpeg,.webp" hidden>
            <span>+ 자료 첨부</span>
          </label>
          <span class="counter" id="c-qhint">${draft.question.trim() ? "Enter를 누르면 다음 단계로 가요" : "질문을 적으면 다음 단계로 넘어갈 수 있어요"}</span>
          <button class="btn btn-primary btn-sm" id="c-next" ${draft.question.trim() ? "" : "disabled"}>다음: 내 생각 적기 →</button>
        </div>
      </div>`;
    const $q = document.getElementById("c-question");
    const $next = document.getElementById("c-next");
    $q.oninput = () => {
      draft.question = $q.value; $next.disabled = !$q.value.trim();
      document.getElementById("c-qhint").textContent = $q.value.trim() ? "Enter를 누르면 다음 단계로 가요" : "질문을 적으면 다음 단계로 넘어갈 수 있어요";
    };
    $q.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && $q.value.trim()) { e.preventDefault(); $next.click(); } };
    $next.onclick = () => { draft.step = 2; renderComposer(topic, turns); document.getElementById("c-thought").focus(); };
    document.getElementById("c-file").onchange = (e) => {
      for (const f of e.target.files) {
        if (draft.files.length >= MAX_FILES) { toast(`자료는 ${MAX_FILES}개까지 붙일 수 있어요`); break; }
        if (!FILE_TYPES[extOf(f.name)]) { toast(`'${f.name}'은(는) 붙일 수 없는 형식이에요`); continue; }
        if (f.size > MAX_MB * 1024 * 1024) { toast(`'${f.name}'이(가) ${MAX_MB}MB보다 커요`); continue; }
        draft.files.push(f);
      }
      e.target.value = "";
      document.getElementById("c-files").innerHTML = pendingChips();
    };
    document.getElementById("c-files").onclick = (e) => {
      const x = e.target.closest("[data-unfile]");
      if (!x) return;
      draft.files.splice(Number(x.dataset.unfile), 1);
      document.getElementById("c-files").innerHTML = pendingChips();
    };
    return;
  }

  $c.innerHTML = `
    <div class="composer-box">
      ${composerSteps(2)}
      <div class="composer-q">${esc(draft.question)}${draft.files.length ? `<div class="c-files">${pendingChips()}</div>` : ""}</div>
      <div class="composer-label">AI에게 보내기 전에, 내 생각을 먼저 적어 보세요 <small>(AI에게는 보내지 않아요)</small></div>
      ${promptButtons()}
      <textarea id="c-thought" class="thought" aria-label="내 생각" placeholder="내 생각은…">${esc(draft.thought)}</textarea>
      <div class="actions">
        <button class="btn btn-ghost btn-sm" id="c-back">← 질문 고치기</button>
        <div style="display:flex;gap:10px;align-items:center">
          <span class="counter" id="c-counter"></span>
          <button class="btn btn-primary btn-sm" id="c-send" disabled>AI 답 보기</button>
        </div>
      </div>
    </div>`;
  const $t = document.getElementById("c-thought");
  const $send = document.getElementById("c-send");
  bindThought($t, document.getElementById("c-counter"), () => {
    draft.thought = $t.value;
    $send.disabled = $t.value.trim().length < cfg.min_thought;
  });
  document.getElementById("c-back").onclick = () => { draft.step = 1; renderComposer(topic, turns); document.getElementById("c-question").focus(); };
  $send.onclick = async () => {
    $send.disabled = true;
    try {
      const { id } = await api(`/api/topics/${topic.id}/turns`, {
        method: "POST", body: { question: draft.question.trim(), my_thought: draft.thought.trim() },
      });
      let attachments = [];
      if (draft.files.length) {
        try { attachments = await uploadFiles(id, draft.files); }
        catch (err) { toast(`${err.message} 자료 없이 AI 답을 받아요.`); }
      }
      delete state.drafts[topic.id];
      const t = { id, question: draft.question.trim(), my_thought: draft.thought.trim(), ai_answer: null, reflection: null, created_at: new Date().toISOString(), attachments };
      turns.push(t);
      const $turns = document.getElementById("turns");
      $turns.querySelector(".empty, .chat-start")?.remove();
      $turns.insertAdjacentHTML("beforeend", turnHTML(t, turns.length));
      bindTurn(t);
      renderComposer(topic, turns);
      // 새 질문을 이어 가면 주제는 진행중으로 돌아간다
      const $sb = document.getElementById("status-btn");
      if ($sb.dataset.status === "done") {
        paintStatusToggle($sb, "in_progress");
        toast("대화를 이어 가서 다시 진행중으로 바꿨어요");
      }
      document.getElementById(`turn-${id}`).scrollIntoView({ behavior: "smooth", block: "start" });
      streamAnswer(t);
    } catch (err) { toast(err.message); $send.disabled = false; }
  };
}

function jumpToTurn(turnId) {
  const $t = document.getElementById(`turn-${turnId}`);
  if (!$t) { toast("해당 대화를 찾을 수 없어요."); return; }
  // 고정된 주제 머리에 가리지 않게 그 높이만큼 띄워서 스크롤
  const headH = document.querySelector(".topic-head")?.offsetHeight || 100;
  document.documentElement.style.setProperty("--head-h", `${headH + 16}px`);
  $t.scrollIntoView({ behavior: "smooth", block: "start" });
  $t.classList.remove("flash");
  void $t.offsetWidth; // 애니메이션 다시 시작
  $t.classList.add("flash");
  setTimeout(() => $t.classList.remove("flash"), 2600);
}

// ---------- 마인드맵 탭 ----------
const MM_KEYS = { mine: "mine_only", shared: "shared", ai: "ai_only" };
const AREAS = { mine: "내 생각", shared: "겹치는 생각", ai: "AI 생각" };

async function renderMapTab($panel, topic, turns, refresh = false) {
  $panel.innerHTML = `
    <div class="map-page">
      <div class="map-bar">
        <p id="map-summary">내 생각과 AI 답의 핵심을 모아, 겹치는 생각은 가운데로 모았어요.</p>
        <div class="map-tools">
          <span class="legend"><i></i>같은 생각 <i class="similar"></i>비슷한 생각</span>
          <button class="btn btn-sm" id="map-edit" aria-pressed="false" hidden>직접 고치기</button>
          <button class="btn btn-sm" id="map-refresh">다시 정리</button>
        </div>
      </div>
      <div id="map-notice"></div>
      <div id="map-ask"></div>
      <div id="map-materials"></div>
      <div id="map-area"><div class="map-loading">대화 전체에서 내 생각과 AI 답의 핵심을 정리하는 중…</div></div>
    </div>`;
  const ctx = { topic, turns, data: null, editing: false, turnNo: Object.fromEntries(turns.map((t, i) => [t.id, i + 1])) };
  document.getElementById("map-refresh").onclick = async () => {
    if (ctx.data?.edited && !(await ask({ title: "마인드맵을 다시 정리할까요?", message: "AI가 처음부터 다시 만들어서, 직접 고친 내용은 사라져요.", confirmText: "다시 정리" }))) return;
    renderMapTab($panel, topic, turns, true);
  };

  const $area = document.getElementById("map-area");
  let data;
  try { data = await api(`/api/topics/${topic.id}/mindmap`, { method: "POST", body: { refresh } }); }
  catch (err) { $area.innerHTML = `<div class="map-loading err">${esc(err.message)}</div>`; return; }
  if (!document.body.contains($area)) return; // 그새 다른 화면으로 이동함
  if (data.empty) {
    $area.innerHTML = `<div class="map-loading">AI 답을 받은 대화가 생기면 마인드맵을 만들 수 있어요.</div>`;
    document.getElementById("map-refresh").hidden = true;
    return;
  }
  ctx.data = data;
  const $edit = document.getElementById("map-edit");
  $edit.hidden = false;
  $edit.onclick = () => {
    ctx.editing = !ctx.editing;
    $edit.setAttribute("aria-pressed", String(ctx.editing));
    $edit.textContent = ctx.editing ? "고치기 끝내기" : "직접 고치기";
    paintMap(ctx);
  };
  paintMap(ctx);
}

// 고친 마인드맵 저장 → 다시 그리기
async function saveMap(ctx, next) {
  try {
    ctx.data = await api(`/api/topics/${ctx.topic.id}/mindmap`, {
      method: "PATCH",
      body: { mine_only: next.mine_only, shared: next.shared, ai_only: next.ai_only, uncertain: next.uncertain || [] },
    });
    paintMap(ctx);
    return true;
  } catch (err) { toast(err.message); return false; }
}
const cloneMap = (d) => JSON.parse(JSON.stringify({ mine_only: d.mine_only, shared: d.shared, ai_only: d.ai_only, uncertain: d.uncertain || [] }));

function paintMap(ctx) {
  const { topic, turns, data, turnNo } = ctx;
  const mine = data.mine_only, shared = data.shared, ai = data.ai_only, uncertain = data.uncertain || [];
  document.getElementById("map-summary").textContent =
    `겹치는 생각 ${shared.length}개 · 나만의 관점 ${mine.length}개 · AI의 새로운 관점 ${ai.length}개` +
    (ctx.editing ? " — 요점을 누르면 고칠 수 있어요" : " — 요점을 누르면 그 대화로 이동해요");

  // AI 판단에 대한 안내 (+ 직접 고친 상태, 대화가 늘어난 상태)
  document.getElementById("map-notice").innerHTML = `
    <div class="map-note">
      <b>AI가 정리한 결과예요.</b> 특히 '겹치는 생각'은 AI가 잘못 판단했을 수 있어요. 다르면 <b>직접 고치기</b>로 바로잡아 주세요.
      ${data.edited ? `<span class="edited-tag">직접 고친 마인드맵</span>` : ""}
    </div>
    ${data.stale ? `<div class="map-note warn">대화가 새로 늘었어요. <b>다시 정리</b>하면 새 대화가 반영되지만, 직접 고친 내용은 사라져요.</div>` : ""}`;

  // AI가 애매하다고 한 요점: 사용자에게 묻기
  // 첨부 자료 정리: 자료마다 요약, 핵심, 내 생각과의 연결
  const files = Object.fromEntries(turns.flatMap((t) => (t.attachments || []).map((a) => [a.id, a])));
  const materials = (data.materials || []).filter((m) => files[m.attachment_id]);
  const $mat = document.getElementById("map-materials");
  $mat.innerHTML = materials.length ? `
    <section class="map-materials" aria-label="첨부 자료 정리">
      <h3>첨부 자료 <small>${materials.length}개 · AI가 자료를 읽고 정리했어요</small></h3>
      <div class="mat-grid">
        ${materials.map((m) => `
          <article class="mat">
            <header>
              <span class="fc-kind">${fileKindLabel(files[m.attachment_id].filename)}</span>
              <span class="mat-name">${esc(files[m.attachment_id].filename)}</span>
              ${(m.turn_ids || []).map((tid) => `<button class="turn-chip" data-jump="${tid}">대화 ${turnNo[tid] ?? "?"}</button>`).join("")}
            </header>
            <p class="mat-sum">${esc(m.summary)}</p>
            ${m.key_points?.length ? `<ul class="mat-points">${m.key_points.map((k) => `<li>${esc(k)}</li>`).join("")}</ul>` : ""}
            ${m.relation ? `<p class="mat-rel"><b>내 생각과의 연결</b> ${esc(m.relation)}</p>` : ""}
          </article>`).join("")}
      </div>
    </section>` : "";
  $mat.onclick = (e) => {
    const j = e.target.closest("[data-jump]");
    if (j) location.hash = `#/topic/${topic.id}?turn=${j.dataset.jump}`;
  };

  const $ask = document.getElementById("map-ask");
  $ask.innerHTML = uncertain.length ? `
    <section class="map-ask" aria-label="확인이 필요한 요점">
      <h3>AI가 판단하기 애매한 요점이 ${uncertain.length}개 있어요 <small>직접 정해 주세요</small></h3>
      ${uncertain.map((u, i) => `
        <div class="ask-item">
          <p class="ask-q">${esc(u.question)}</p>
          <div class="ask-pair">
            <span class="ask-side mine">${esc(u.mine_label)}</span><span class="ask-vs">와</span>
            <span class="ask-side ai">${esc(u.ai_label)}</span>
            ${u.turn_ids.map((tid) => `<button class="turn-chip" data-jump="${tid}">대화 ${turnNo[tid] ?? "?"}</button>`).join("")}
          </div>
          <div class="ask-btns">
            <button class="btn btn-sm" data-resolve="same" data-i="${i}">같은 생각</button>
            <button class="btn btn-sm" data-resolve="similar" data-i="${i}">비슷한 생각</button>
            <button class="btn btn-sm" data-resolve="different" data-i="${i}">다른 생각</button>
          </div>
        </div>`).join("")}
    </section>` : "";
  $ask.onclick = async (e) => {
    const jump = e.target.closest("[data-jump]");
    if (jump) { location.hash = `#/topic/${topic.id}?turn=${jump.dataset.jump}`; return; }
    const b = e.target.closest("[data-resolve]");
    if (!b) return;
    const next = cloneMap(data);
    const [u] = next.uncertain.splice(Number(b.dataset.i), 1);
    if (b.dataset.resolve === "different") {
      // 서로 다른 생각 → 각자의 영역에 둔다
      if (!next.mine_only.some((p) => p.label === u.mine_label)) next.mine_only.push({ label: u.mine_label, detail: "", turn_ids: u.turn_ids });
      if (!next.ai_only.some((p) => p.label === u.ai_label)) next.ai_only.push({ label: u.ai_label, detail: "", turn_ids: u.turn_ids });
    } else {
      // 같은·비슷한 생각 → 가운데로 모은다
      next.mine_only = next.mine_only.filter((p) => p.label !== u.mine_label);
      next.ai_only = next.ai_only.filter((p) => p.label !== u.ai_label);
      next.shared.push({
        label: u.shared_label || u.mine_label, kind: b.dataset.resolve,
        detail: `내 생각 '${u.mine_label}'과 AI의 '${u.ai_label}'를 ${b.dataset.resolve === "same" ? "같은" : "비슷한"} 생각으로 정리했어요.`,
        turn_ids: u.turn_ids,
      });
    }
    if (await saveMap(ctx, next)) toast("마인드맵에 반영했어요");
  };

  const items = { mine, shared, ai };
  const usedTurns = turns.filter((t) => [...mine, ...shared, ...ai].some((p) => p.turn_ids.includes(t.id)));
  const view = loadMapView(topic.id);

  const node = (side, p, i) => `
    <button class="node ${side} ${p.kind || ""}" data-side="${side}" data-i="${i}" ${p.turn_ids.length ? `data-turn="${p.turn_ids[0]}"` : ""} data-turns="${p.turn_ids.join(",")}">
      <span class="node-label">${esc(p.label)}${side === "shared" ? `<span class="node-kind">${p.kind === "similar" ? "비슷함" : "같음"}</span>` : ""}</span>
      ${p.detail ? `<span class="node-detail">${esc(p.detail)}</span>` : ""}
      ${p.turn_ids.length ? `<span class="node-turns">${p.turn_ids.map((tid) => `<span class="turn-chip" data-turn="${tid}">대화 ${turnNo[tid] ?? "?"}</span>`).join("")}</span>` : `<span class="node-turns"><span class="turn-chip muted">직접 추가</span></span>`}
    </button>`;
  const column = (side) => `
    <div class="cmap-col ${side}" data-area="${side}">
      <button class="cmap-head ${side}" data-toggle-area="${side}" aria-expanded="true">
        <span>${AREAS[side]}</span> <span class="head-count"></span> <span class="caret">▾</span>
      </button>
      ${items[side].map((p, i) => node(side, p, i)).join("")}
      <div class="cmap-empty-col ${side}" data-empty></div>
      ${ctx.editing ? `<button class="node-add" data-add="${side}">+ 요점 추가</button>` : ""}
    </div>`;

  document.getElementById("map-area").innerHTML = `
    <div class="map-view" id="map-view">
      <div class="mv-group">
        <span class="mv-label">보기</span>
        ${Object.entries(AREAS).map(([k, label]) => `<button class="mv-chip area-${k}" data-area-chip="${k}" aria-pressed="true">${label}</button>`).join("")}
      </div>
      ${usedTurns.length > 1 ? `
      <div class="mv-group">
        <span class="mv-label">대화</span>
        <button class="mv-chip" data-turn-chip="all">전체</button>
        ${usedTurns.map((t) => `<button class="mv-chip" data-turn-chip="${t.id}" title="${esc(t.question)}">대화 ${turnNo[t.id]}</button>`).join("")}
      </div>` : ""}
      <button class="mv-chip mv-compact" id="mv-compact" aria-pressed="false"></button>
    </div>
    <div class="cmap ${ctx.editing ? "editing" : ""}" id="cmap">
      <svg class="cmap-lines" aria-hidden="true"></svg>
      <div class="cmap-grid">${column("mine")}${column("shared")}${column("ai")}</div>
    </div>`;

  const $map = document.getElementById("cmap");
  const $grid = $map.querySelector(".cmap-grid");

  // 보기 설정 적용: 접은 영역, 고른 대화, 요약 접기
  const apply = () => {
    const turnOk = (n) => !view.turns || n.dataset.turns.split(",").some((id) => view.turns.includes(Number(id)));
    for (const side of Object.keys(AREAS)) {
      const $col = $map.querySelector(`.cmap-col.${side}`);
      const collapsed = view.hidden.includes(side);
      let visible = 0;
      $col.querySelectorAll(".node").forEach((n) => {
        const show = !collapsed && (ctx.editing || turnOk(n));
        n.hidden = !show;
        if (show) visible++;
      });
      const total = items[side].length;
      const matched = [...$col.querySelectorAll(".node")].filter((n) => ctx.editing || turnOk(n)).length;
      $col.classList.toggle("collapsed", collapsed);
      $col.querySelector(".head-count").textContent = matched;
      $col.querySelector(".caret").textContent = collapsed ? "▸" : "▾";
      $col.querySelector("[data-toggle-area]").setAttribute("aria-expanded", String(!collapsed));
      $col.querySelector("[data-toggle-area]").title = collapsed ? "눌러서 펼치기" : "눌러서 접기";
      const $add = $col.querySelector("[data-add]");
      if ($add) $add.hidden = collapsed;
      const $empty = $col.querySelector("[data-empty]");
      $empty.textContent = collapsed ? `접어 둠 · ${matched}개`
        : visible ? ""
        : total ? "고른 대화에는 없어요"
        : { mine: "나만의 관점이 없어요", shared: "겹치는 생각이 없어요", ai: "AI만의 관점이 없어요" }[side];
      $empty.hidden = !$empty.textContent;
      $grid.style.setProperty(`--c-${side}`, collapsed ? "max-content" : side === "shared" ? "minmax(0, 1.05fr)" : "minmax(0, 1fr)");
      document.querySelector(`[data-area-chip="${side}"]`).setAttribute("aria-pressed", String(!collapsed));
    }
    document.querySelectorAll("[data-turn-chip]").forEach((c) => {
      const on = c.dataset.turnChip === "all" ? !view.turns : !!view.turns?.includes(Number(c.dataset.turnChip));
      c.setAttribute("aria-pressed", String(on));
    });
    $map.classList.toggle("compact", view.compact && !ctx.editing);
    const $compact = document.getElementById("mv-compact");
    $compact.setAttribute("aria-pressed", String(view.compact));
    $compact.textContent = view.compact ? "요약 펼치기" : "요약 접기";
    saveMapView(topic.id, view);
    drawMapLines($map);
  };
  ctx.apply = apply;

  const toggleArea = (side) => {
    view.hidden = view.hidden.includes(side) ? view.hidden.filter((s) => s !== side) : [...view.hidden, side];
    apply();
  };
  document.getElementById("map-view").addEventListener("click", (e) => {
    const area = e.target.closest("[data-area-chip]");
    const turn = e.target.closest("[data-turn-chip]");
    if (area) toggleArea(area.dataset.areaChip);
    else if (turn) {
      if (turn.dataset.turnChip === "all") view.turns = null;
      else {
        const id = Number(turn.dataset.turnChip);
        const cur = view.turns || [];
        const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
        view.turns = next.length && next.length < usedTurns.length ? next : null;
      }
      apply();
    } else if (e.target.closest("#mv-compact")) {
      view.compact = !view.compact;
      apply();
    }
  });

  $map.addEventListener("click", (e) => {
    if (e.target.closest(".node-editor")) return;
    // 영역 머리를 누르면 그 영역을 접고 펼친다
    const head = e.target.closest("[data-toggle-area]");
    if (head) { toggleArea(head.dataset.toggleArea); return; }
    if (ctx.editing) {
      // 고치기 모드: 요점을 누르면 편집, '+ 요점 추가'로 새 요점
      const add = e.target.closest("[data-add]");
      if (add) { openNodeEditor(ctx, add, add.dataset.add, -1); return; }
      const n = e.target.closest(".node");
      if (n) openNodeEditor(ctx, n, n.dataset.side, Number(n.dataset.i));
      return;
    }
    // 요점(또는 대화 칩)을 누르면 대화 탭으로 가서 그 대화 위치로 이동
    const target = e.target.closest("[data-turn]");
    if (!target) return;
    e.stopPropagation();
    location.hash = `#/topic/${topic.id}?turn=${target.dataset.turn}`;
  });
  // 가운데 요점에 마우스를 올리면 양쪽에서 모이는 선을 강조
  $map.querySelectorAll(".node.shared").forEach((n) => {
    n.onmouseenter = () => $map.querySelectorAll(`path[data-shared="${n.dataset.i}"]`).forEach((p) => p.classList.add("hl"));
    n.onmouseleave = () => $map.querySelectorAll("path.hl").forEach((p) => p.classList.remove("hl"));
  });

  apply();
  if (resizeObs) resizeObs.disconnect();
  resizeObs = new ResizeObserver(() => drawMapLines($map));
  resizeObs.observe($map);
}

// 요점 하나를 고치는 칸: 이름·설명·영역(내 생각만/겹치는 생각/AI만)·같음/비슷함, 삭제
function openNodeEditor(ctx, $anchor, side, index) {
  document.querySelectorAll(".node-editor").forEach((f) => f.remove());
  document.querySelectorAll(".node.editing-hidden").forEach((n) => n.classList.remove("editing-hidden"));
  const isNew = index < 0;
  const p = isNew ? { label: "", detail: "", kind: "same", turn_ids: [] } : ctx.data[MM_KEYS[side]][index];
  const form = document.createElement("form");
  form.className = `node-editor ${side}`;
  form.innerHTML = `
    <label class="ed-fld"><span>요점</span><input name="label" maxlength="40" value="${esc(p.label)}" placeholder="짧은 핵심어" aria-label="요점"></label>
    <label class="ed-fld"><span>설명</span><textarea name="detail" maxlength="200" rows="2" placeholder="한 문장 설명 (선택)" aria-label="설명">${esc(p.detail || "")}</textarea></label>
    <div class="ed-row">
      <label class="ed-fld"><span>어디에 둘까요</span>
        <select name="area" aria-label="영역">
          <option value="mine" ${side === "mine" ? "selected" : ""}>내 생각에만 있음</option>
          <option value="shared" ${side === "shared" ? "selected" : ""}>겹치는 생각</option>
          <option value="ai" ${side === "ai" ? "selected" : ""}>AI 생각에만 있음</option>
        </select>
      </label>
      <fieldset class="ed-kind" ${side === "shared" ? "" : "hidden"}>
        <legend>얼마나 겹치나요</legend>
        <label><input type="radio" name="kind" value="same" ${p.kind !== "similar" ? "checked" : ""}> 같음</label>
        <label><input type="radio" name="kind" value="similar" ${p.kind === "similar" ? "checked" : ""}> 비슷함</label>
      </fieldset>
    </div>
    <p class="form-err" role="alert"></p>
    <div class="ed-btns">
      ${isNew ? "" : `<button type="button" class="btn btn-ghost btn-sm danger" data-ed="delete">삭제</button>`}
      <span></span>
      <button type="button" class="btn btn-ghost btn-sm" data-ed="cancel">취소</button>
      <button type="submit" class="btn btn-primary btn-sm">저장</button>
    </div>`;
  if (isNew) $anchor.before(form);
  else { $anchor.classList.add("editing-hidden"); $anchor.after(form); }
  form.area.onchange = () => { form.querySelector(".ed-kind").hidden = form.area.value !== "shared"; };
  form.querySelector('[data-ed="cancel"]').onclick = () => { form.remove(); $anchor.classList.remove("editing-hidden"); ctx.apply?.(); };
  const del = form.querySelector('[data-ed="delete"]');
  if (del) del.onclick = async () => {
    if (!(await ask({ title: `'${p.label}' 요점을 지울까요?`, confirmText: "지우기", danger: true }))) return;
    const next = cloneMap(ctx.data);
    next[MM_KEYS[side]].splice(index, 1);
    if (await saveMap(ctx, next)) toast("요점을 지웠어요");
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const label = form.label.value.trim();
    if (!label) { form.querySelector(".form-err").textContent = "요점 이름을 적어 주세요."; form.label.focus(); return; }
    const area = form.area.value;
    const item = { label, detail: form.detail.value.trim(), turn_ids: p.turn_ids || [] };
    if (area === "shared") item.kind = form.kind.value;
    const next = cloneMap(ctx.data);
    if (!isNew && area === side) next[MM_KEYS[side]][index] = item;
    else {
      if (!isNew) next[MM_KEYS[side]].splice(index, 1);
      next[MM_KEYS[area]].push(item);
    }
    if (await saveMap(ctx, next)) toast(isNew ? "요점을 추가했어요" : "고쳤어요");
  };
  form.label.focus();
  drawMapLines(document.getElementById("cmap"));
}

// 마인드맵 보기 설정은 주제마다 이 브라우저에 기억해 둔다 (없거나 못 읽어도 기본값으로 동작)
function loadMapView(topicId) {
  const base = { hidden: [], turns: null, compact: false };
  try {
    const saved = JSON.parse(localStorage.getItem(`tf-map-view-${topicId}`) || "null");
    return saved ? { ...base, ...saved } : base;
  } catch { return base; }
}
function saveMapView(topicId, view) {
  try { localStorage.setItem(`tf-map-view-${topicId}`, JSON.stringify(view)); } catch { /* 저장 못 해도 괜찮음 */ }
}

function drawMapLines($map) {
  const svg = $map.querySelector(".cmap-lines");
  if (!svg || getComputedStyle(svg).display === "none") return;
  const base = $map.getBoundingClientRect();
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { l: r.left - base.left, r: r.right - base.left, t: r.top - base.top, b: r.bottom - base.top, cy: r.top - base.top + r.height / 2 };
  };
  svg.setAttribute("width", base.width);
  svg.setAttribute("height", base.height);
  const hm = box($map.querySelector(".cmap-head.mine"));
  const ha = box($map.querySelector(".cmap-head.ai"));
  let d = "";

  // 내 생각 → 나만의 관점 (왼쪽 가장자리를 따라 내려가는 가지)
  $map.querySelectorAll(".node.mine:not([hidden]):not(.editing-hidden)").forEach((n) => {
    const b = box(n), x = hm.l + 14;
    d += `<path class="b-mine" d="M${x},${hm.b} C${x},${b.cy} ${x},${b.cy} ${b.l},${b.cy}"/>`;
  });
  // AI 생각 → AI만의 관점 (오른쪽 가장자리)
  $map.querySelectorAll(".node.ai:not([hidden]):not(.editing-hidden)").forEach((n) => {
    const b = box(n), x = ha.r - 14;
    d += `<path class="b-ai" d="M${x},${ha.b} C${x},${b.cy} ${x},${b.cy} ${b.r},${b.cy}"/>`;
  });
  // 양쪽 머리에서 가운데 겹치는 생각으로 모이는 선:
  // 머리 높이로 칸 사이 빈 공간까지 간 뒤, 그 공간을 따라 내려가 가운데 요점에 닿는다 (요점 카드를 가로지르지 않게)
  const colMine = box($map.querySelector(".cmap-col.mine"));
  const colShared = box($map.querySelector(".cmap-col.shared"));
  const colAi = box($map.querySelector(".cmap-col.ai"));
  const gl = (colMine.r + colShared.l) / 2, gr = (colShared.r + colAi.l) / 2, rr = 12;
  $map.querySelectorAll(".node.shared:not([hidden]):not(.editing-hidden)").forEach((n) => {
    const b = box(n), kind = n.classList.contains("similar") ? "similar" : "same", i = n.dataset.i;
    d += `<path class="b-shared ${kind}" data-shared="${i}" d="M${hm.r},${hm.cy} L${gl - rr},${hm.cy} Q${gl},${hm.cy} ${gl},${hm.cy + rr} L${gl},${b.cy - rr} Q${gl},${b.cy} ${gl + rr},${b.cy} L${b.l},${b.cy}"/>`;
    d += `<path class="b-shared ${kind}" data-shared="${i}" d="M${ha.l},${ha.cy} L${gr + rr},${ha.cy} Q${gr},${ha.cy} ${gr},${ha.cy + rr} L${gr},${b.cy - rr} Q${gr},${b.cy} ${gr - rr},${b.cy} L${b.r},${b.cy}"/>`;
  });
  svg.innerHTML = d;
}

// ---------- 로그인 · 회원가입 (브랜드 소개와 함께) ----------
// 누구를 위한 앱인지, 왜 만들었는지를 로그인 화면 왼쪽에 보여 준다
function brandPanel() {
  const mascot = document.getElementById("mascot-template").innerHTML;
  return `
    <section class="brand">
      <div class="brand-mark">${LOGO}<span class="brand-name"><b>비포블랭크</b> Before Blank</span></div>
      <h1 class="brand-title">AI에게 묻기 전에,<br>내 생각부터.</h1>

      <div class="brand-block">
        <h2>이런 분을 위해 만들었어요</h2>
        <ul class="brand-list">
          <li>AI 답을 읽고 나면, 내가 원래 뭘 생각했는지 기억나지 않는 사람</li>
          <li>AI에게 묻기는 하는데, 정작 내 생각은 정리가 안 되는 사람</li>
          <li>AI 답을 그대로 가져다 쓰고 나서 어딘가 찜찜했던 사람</li>
        </ul>
      </div>

      <figure class="brand-story">
        <blockquote>AI를 쓰고 나면 하고 있던 내 생각은 잊어버리고, 어느새 AI의 말을 따라가고 있었어요. 그 불편함에서 이 노트를 만들었습니다.</blockquote>
        <figcaption>만든 사람의 이야기</figcaption>
      </figure>

      <ol class="brand-steps">
        <li><span class="step-num">01</span><div><b>질문을 적어요</b><p>AI에게 물어보고 싶은 걸 먼저 적어요.</p></div></li>
        <li><span class="step-num">02</span><div><b>내 생각을 먼저 써요</b><p>20자 이상 써야 AI 답이 열려요. 내 생각은 AI에게 보내지 않아요.</p></div></li>
        <li><span class="step-num">03</span><div><b>AI 답과 비교해요</b><p>겹치는 생각, 나만의 관점, AI만의 관점을 마인드맵으로 나눠 봐요.</p></div></li>
      </ol>
    </section>`;
}

function authShell(formHTML) {
  $app.innerHTML = `
    <div class="auth">
      <div class="auth-top">${themeToggle()}</div>
      <div class="auth-grid">
        ${brandPanel()}
        <section class="auth-card">${formHTML}</section>
      </div>
    </div>`;
}

const field = (id, label, input, hint = "") => `
  <label class="fld" for="${id}">
    <span class="fld-label">${label}</span>
    ${input.replace("<input ", `<input aria-label="${label}" `)}
    ${hint ? `<span class="fld-hint">${hint}</span>` : ""}
    <span class="fld-err" data-err="${id}"></span>
  </label>`;

function showFieldErrors(fields = {}) {
  document.querySelectorAll("[data-err]").forEach((el) => {
    const msg = fields[el.dataset.err] || "";
    el.textContent = msg;
    el.closest(".fld, .agree")?.classList.toggle("has-err", !!msg);
  });
}

function viewLogin() {
  authShell(`
    <h2 class="auth-title">로그인</h2>
    <p class="auth-sub">내가 남긴 질문과 생각은 나만 볼 수 있어요.</p>
    <form id="login-form" novalidate>
      ${field("email", "이메일", `<input type="text" id="email" inputmode="email" autocomplete="email" required>`)}
      ${field("password", "비밀번호", `<input type="password" id="password" autocomplete="current-password" required>`)}
      <p class="form-err" id="form-err" role="alert"></p>
      <button class="btn btn-primary btn-block" type="submit">로그인</button>
    </form>
    <p class="auth-forgot"><a href="#/forgot">비밀번호를 잊었나요?</a></p>
    <p class="auth-switch">아직 계정이 없나요? <a href="#/signup">회원가입</a></p>`);
  const $f = document.getElementById("login-form");
  $f.onsubmit = async (e) => {
    e.preventDefault();
    const $btn = $f.querySelector("button[type=submit]");
    $btn.disabled = true;
    try {
      const { user } = await api("/api/login", { method: "POST", body: { email: $f.email.value, password: $f.password.value } });
      state.user = user;
      location.hash = "#/";
    } catch (err) {
      document.getElementById("form-err").textContent = err.message;
      $btn.disabled = false;
    }
  };
  document.getElementById("email").focus();
}

function viewSignup() {
  const genders = cfg.genders || ["여성", "남성", "기타", "응답 안 함"];
  authShell(`
    <h2 class="auth-title">회원가입</h2>
    <p class="auth-sub">가입하면 내 주제와 대화가 내 계정에만 저장돼요.</p>
    <form id="signup-form" novalidate>
      ${field("name", "이름", `<input type="text" id="name" autocomplete="name" maxlength="30" required>`)}
      ${field("email", "이메일", `<input type="text" id="email" inputmode="email" autocomplete="email" required>`)}
      ${field("password", "비밀번호", `<input type="password" id="password" autocomplete="new-password" required>`, "영문과 숫자를 섞어 8자 이상")}
      ${field("password_confirm", "비밀번호 확인", `<input type="password" id="password_confirm" autocomplete="new-password" required>`)}
      <div class="fld-row">
        ${field("age", "나이", `<input type="number" id="age" inputmode="numeric" min="${cfg.min_age || 14}" max="120" required>`, `만 ${cfg.min_age || 14}세 이상`)}
        <div class="fld">
          <span class="fld-label">성별</span>
          <div class="seg" role="radiogroup" aria-label="성별">
            ${genders.map((g) => `<label><input type="radio" name="gender" value="${esc(g)}"><span>${esc(g)}</span></label>`).join("")}
          </div>
          <span class="fld-err" data-err="gender"></span>
        </div>
      </div>
      <div class="agree">
        <label><input type="checkbox" id="agree"> <span>개인정보 수집·이용에 동의해요 (필수)</span></label>
        <details>
          <summary>자세히 보기</summary>
          <ul>
            <li>수집 항목: 이름, 이메일, 비밀번호(암호화해서 저장), 나이, 성별</li>
            <li>이용 목적: 로그인과 내 기록 구분, 나이·성별에 따른 사용 경향 분석(개인을 알아볼 수 없는 통계로만)</li>
            <li>보관 기간: 탈퇴할 때까지. 탈퇴하면 계정과 모든 기록을 바로 지워요.</li>
          </ul>
        </details>
        <span class="fld-err" data-err="agree"></span>
      </div>
      <p class="form-err" id="form-err" role="alert"></p>
      <button class="btn btn-primary btn-block" type="submit">가입하고 시작하기</button>
    </form>
    <p class="auth-switch">이미 계정이 있나요? <a href="#/login">로그인</a></p>`);

  const $f = document.getElementById("signup-form");
  // 비밀번호 확인은 입력하는 동안 바로 알려 준다
  const checkConfirm = () => {
    const c = $f.password_confirm.value;
    showFieldErrors({ ...currentErrors, password_confirm: c && c !== $f.password.value ? "비밀번호가 서로 달라요." : "" });
  };
  let currentErrors = {};
  $f.password_confirm.addEventListener("input", checkConfirm);
  $f.password.addEventListener("input", () => { if ($f.password_confirm.value) checkConfirm(); });

  $f.onsubmit = async (e) => {
    e.preventDefault();
    const $btn = $f.querySelector("button[type=submit]");
    $btn.disabled = true;
    document.getElementById("form-err").textContent = "";
    const body = {
      name: $f.name.value, email: $f.email.value, password: $f.password.value,
      password_confirm: $f.password_confirm.value, age: $f.age.value,
      gender: $f.querySelector("input[name=gender]:checked")?.value || "", agree: $f.agree.checked,
    };
    try {
      const res = await fetch("/api/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        currentErrors = data.fields || {};
        showFieldErrors(currentErrors);
        document.getElementById("form-err").textContent = data.error || "가입하지 못했어요.";
        $f.querySelector(".has-err input")?.focus();
        $btn.disabled = false;
        return;
      }
      state.user = data.user;
      location.hash = "#/";
    } catch (err) {
      document.getElementById("form-err").textContent = "서버에 연결하지 못했어요.";
      $btn.disabled = false;
    }
  };
  document.getElementById("name").focus();
}

// 비밀번호 찾기: 이메일을 받으면 재설정 링크를 보낸다
function viewForgot() {
  authShell(`
    <h2 class="auth-title">비밀번호 찾기</h2>
    <p class="auth-sub">가입한 이메일을 적으면, 새 비밀번호를 정할 수 있는 링크를 보내 드려요. 링크는 30분 동안만 열려요.</p>
    <form id="forgot-form" novalidate>
      ${field("email", "이메일", `<input type="text" id="email" inputmode="email" autocomplete="email" required>`)}
      <p class="form-err" id="form-err" role="alert"></p>
      <div class="form-ok" id="form-ok" role="status"></div>
      <button class="btn btn-primary btn-block" type="submit">재설정 링크 받기</button>
    </form>
    <p class="auth-switch"><a href="#/login">로그인으로 돌아가기</a></p>`);
  const $f = document.getElementById("forgot-form");
  $f.onsubmit = async (e) => {
    e.preventDefault();
    const $btn = $f.querySelector("button[type=submit]");
    document.getElementById("form-err").textContent = "";
    if (!$f.email.value.trim()) { document.getElementById("form-err").textContent = "이메일을 입력해 주세요."; return; }
    $btn.disabled = true;
    try {
      const r = await api("/api/password/forgot", { method: "POST", body: { email: $f.email.value } });
      document.getElementById("form-ok").innerHTML = esc(r.message) +
        (r.dev_link ? `<br><span class="dev-note">메일 서버가 설정되지 않은 로컬 체험 환경이라, 여기서 바로 열 수 있어요: <a href="${esc(r.dev_link)}">재설정 화면 열기</a></span>` : "");
      $btn.textContent = "다시 보내기";
    } catch (err) {
      document.getElementById("form-err").textContent = err.message;
    } finally {
      $btn.disabled = false;
    }
  };
  document.getElementById("email").focus();
}

// 메일의 링크로 들어오면 새 비밀번호를 정한다
function viewReset(token) {
  authShell(`
    <h2 class="auth-title">새 비밀번호 정하기</h2>
    <p class="auth-sub">새 비밀번호를 정하면 다시 로그인할 수 있어요.</p>
    <form id="reset-form" novalidate>
      ${field("password", "새 비밀번호", `<input type="password" id="password" autocomplete="new-password" required>`, "영문과 숫자를 섞어 8자 이상")}
      ${field("password_confirm", "새 비밀번호 확인", `<input type="password" id="password_confirm" autocomplete="new-password" required>`)}
      <p class="form-err" id="form-err" role="alert"></p>
      <button class="btn btn-primary btn-block" type="submit">비밀번호 바꾸기</button>
    </form>
    <p class="auth-switch"><a href="#/forgot">링크를 다시 받기</a></p>`);
  const $f = document.getElementById("reset-form");
  $f.onsubmit = async (e) => {
    e.preventDefault();
    const $btn = $f.querySelector("button[type=submit]");
    $btn.disabled = true;
    document.getElementById("form-err").textContent = "";
    showFieldErrors({});
    try {
      const res = await fetch("/api/password/reset", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: $f.password.value, password_confirm: $f.password_confirm.value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showFieldErrors(data.fields || {});
        document.getElementById("form-err").textContent = data.error || "바꾸지 못했어요.";
        $btn.disabled = false;
        return;
      }
      state.user = null;
      toast("비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요.");
      location.hash = "#/login";
    } catch {
      document.getElementById("form-err").textContent = "서버에 연결하지 못했어요.";
      $btn.disabled = false;
    }
  };
  document.getElementById("password").focus();
}

async function logout() {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  state.user = null;
  state.drafts = {};
  location.hash = "#/login";
}

async function deleteAccount() {
  const password = await ask({
    title: "정말 탈퇴할까요?", message: "계정과 모든 주제·대화·생각 메모가 바로 지워지고 되돌릴 수 없어요. 확인을 위해 비밀번호를 입력해 주세요.",
    input: { type: "password", maxlength: 200 }, confirmText: "탈퇴하기", danger: true,
  });
  if (!password) return;
  try {
    await api("/api/me", { method: "DELETE", body: { password } });
    state.user = null;
    toast("탈퇴했어요. 그동안 고마웠어요.");
    location.hash = "#/login";
  } catch (err) { toast(err.message); }
}

// ---------- 라우터 ----------
async function route() {
  if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
  const [path, query] = location.hash.replace(/^#/, "").split("?");
  const qs = new URLSearchParams(query || "");
  // 로그인 확인: 로그인 전에는 로그인·회원가입 화면만 보여 준다
  if (state.user === undefined) {
    state.user = (await api("/api/me").catch(() => ({ user: null }))).user;
  }
  const authPage = ["/login", "/signup", "/forgot", "/reset"].includes(path);
  if (!state.user && !authPage) { location.replace("#/login"); return; }
  if (state.user && (path === "/login" || path === "/signup")) { location.replace("#/"); return; }
  window.scrollTo(0, 0);
  if (path === "/login") return viewLogin();
  if (path === "/signup") return viewSignup();
  if (path === "/forgot") return viewForgot();
  if (path === "/reset") return viewReset(qs.get("token") || "");
  let m;
  if (path === "/new") await viewNewTopic();
  else if ((m = path.match(/^\/topic\/(\d+)\/map$/))) { window.scrollTo(0, 0); await viewTopic(Number(m[1]), "map"); }
  else if ((m = path.match(/^\/topic\/(\d+)$/))) {
    const opts = { turn: Number(qs.get("turn")) || null, ask: Number(qs.get("ask")) || null };
    // 주소에서 ?ask/?turn을 지워 둔다: 새로고침해도 다시 묻지 않고, 같은 요점을 또 눌러도 이동하게
    if (opts.ask || opts.turn) history.replaceState(null, "", `#/topic/${m[1]}`);
    await viewTopic(Number(m[1]), "chat", opts);
  }
  else { window.scrollTo(0, 0); await viewHome(); }
}

window.addEventListener("hashchange", route);
api("/api/config").then((c) => Object.assign(cfg, c)).catch(() => {}).finally(route);
