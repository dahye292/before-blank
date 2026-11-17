// 비포블랭크(Before Blank, 비비) — 프론트엔드 (프레임워크 없이 해시 라우팅)
//   #/login, #/signup        로그인 · 회원가입 (로그인 전에는 이 화면만 보인다)
//   #/forgot, #/reset?token= 비밀번호 찾기 · 새 비밀번호 정하기
//   #/                       홈: 주제 목록
//   #/new                    새 주제 시작
//   #/topic/:id              주제 > 대화 탭  (?turn=ID 로 특정 대화 위치로 이동)
//   #/topic/:id/map          주제 > 마인드맵 탭
const $app = document.getElementById("app");
const cfg = { min_thought: 1, demo: false };
const state = {
  q: "",              // 홈 검색어
  filter: "all",      // all | starred | in_progress | done
  folder: "all",      // all | none(폴더 없음) | 폴더 id
  doneOpen: false,    // 홈의 '완료' 구역을 펼쳤는지
  hideSamples: (() => { try { return localStorage.getItem("bb-hide-samples") === "1"; } catch { return false; } })(),
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
  <rect width="32" height="32" rx="8" fill="var(--text)"/>
  <rect x="13.5" y="8.5" width="11.5" height="15" rx="2.5" fill="none" stroke="var(--bg)" stroke-width="2.2" stroke-dasharray="3.2 2.4"/>
  <circle cx="8.5" cy="16" r="3.4" fill="var(--mine)"/></svg>`;

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
});

const starBtn = (on, label) =>
  `<button class="star ${on ? "on" : ""}" data-star aria-pressed="${on ? "true" : "false"}" title="${on ? "중요 표시 해제" : "중요 표시"}" aria-label="${esc(label)} 중요 표시">${on ? "★" : "☆"}</button>`;

// 아주 작은 마크다운 렌더러 (먼저 HTML을 이스케이프해서 안전하게)
// AI 답 마크다운 → HTML. 먼저 전부 이스케이프하고, 정해진 모양만 태그로 바꾼다(링크는 http/https만).
function md(src) {
  const lines = esc(src).split("\n");
  let html = "", list = null, inCode = false, code = [], table = [], quote = [];
  const link = (u, t) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`;
  const inline = (s) => {
    const keep = [];
    const hold = (h) => { keep.push(h); return `\u0000${keep.length - 1}\u0000`; };
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => hold(link(u, t)));
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+?)([.,;:]?)(?=\s|$|\))/g, (_, pre, u, tail) => `${pre}${hold(link(u, u))}${tail}`);
    s = s.replace(/`([^`]+)`/g, (_, c) => hold(`<code>${c}</code>`))
         .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
         .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[Number(i)]);
  };
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  const cells = (row) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const closeTable = () => {
    if (!table.length) return;
    const isSep = (r) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(r);
    const head = table.length > 1 && isSep(table[1]) ? cells(table[0]) : null;
    const body = (head ? table.slice(2) : table).filter((r) => !isSep(r));
    html += `<div class="md-table"><table>${head ? `<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>` : ""}<tbody>${body.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    table = [];
  };
  const closeQuote = () => { if (quote.length) { html += `<blockquote>${quote.map((q) => `<p>${inline(q)}</p>`).join("")}</blockquote>`; quote = []; } };
  const closeAll = () => { closeList(); closeTable(); closeQuote(); };
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCode) { html += `<pre><code>${code.join("\n")}</code></pre>`; code = []; inCode = false; }
      else { closeAll(); inCode = true; }
      continue;
    }
    if (inCode) { code.push(line); continue; }
    let m;
    if (/^\s*\|.*\|\s*$/.test(line)) { closeList(); closeQuote(); table.push(line); continue; }
    closeTable();
    if ((m = line.match(/^&gt;\s?(.*)/))) { closeList(); quote.push(m[1]); continue; }
    closeQuote();
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { closeList(); html += "<hr>"; }
    else if ((m = line.match(/^(#{1,4})\s+(.*)/))) { closeList(); html += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`; }
    else if ((m = line.match(/^\s*[-*]\s+(.*)/))) { if (list !== "ul") { closeList(); html += "<ul>"; list = "ul"; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = line.match(/^\s*\d+\.\s+(.*)/))) { if (list !== "ol") { closeList(); html += "<ol>"; list = "ol"; } html += `<li>${inline(m[1])}</li>`; }
    else if (!line.trim()) { closeList(); }
    else { closeList(); html += `<p>${inline(line)}</p>`; }
  }
  if (inCode) html += `<pre><code>${code.join("\n")}</code></pre>`;
  closeAll();
  return html;
}

const THOUGHT_PROMPTS = ["내가 생각하는 답은 …", "그렇게 생각하는 이유는 …", "확실하지 않은 부분은 …", "AI에게 특히 확인하고 싶은 건 …"];

// 생각 입력칸: 문장 시작 버튼 + 글자 수 카운터
function bindThought($t, $counter, onChange) {
  const update = () => {
    const n = $t.value.trim().length;
    $counter.textContent = n >= cfg.min_thought ? "이제 AI 답을 볼 수 있어요" : "내 생각을 적으면 AI 답이 열려요";
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
// "어제", "3일 전"처럼 짧게
function ago(iso) {
  if (!iso) return "";
  const d = new Date(iso), now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff <= 0) return "오늘";
  if (diff === 1) return "어제";
  if (diff < 7) return `${diff}일 전`;
  if (diff < 35) return `${Math.floor(diff / 7)}주 전`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}
const clip = (s, n) => (s && s.length > n ? s.slice(0, n).trimEnd() + "…" : s || "");

// 상단: 이름 · (오른쪽) 테마 스위치 · 프로필 메뉴(설정·로그아웃)
function topBar() {
  const name = state.user?.name || "";
  return `
    <header class="topbar">
      <a class="wordmark" href="#/">${LOGO}<span><b>비포블랭크</b> Before Blank</span>${cfg.demo ? `<span class="demo-pill">데모 모드</span>` : ""}</a>
      <div class="top-right">
        ${themeToggle()}
        <div class="profile">
          <button class="profile-btn" id="profile-btn" aria-haspopup="menu" aria-expanded="false">
            <span class="avatar" aria-hidden="true">${esc(name.slice(0, 1))}</span><span class="profile-name">${esc(name)}</span><span class="caret" aria-hidden="true">▾</span>
          </button>
          <div class="profile-menu" id="profile-menu" role="menu" hidden>
            ${state.user?.admin ? `<a role="menuitem" href="#/stats">사용 통계</a>` : ""}
            <button role="menuitem" id="guide-open">사용법</button>
            <a role="menuitem" href="#/settings">설정</a>
            <button role="menuitem" id="logout">로그아웃</button>
          </div>
        </div>
      </div>
    </header>`;
}

function bindTopBar() {
  const $btn = document.getElementById("profile-btn"), $menu = document.getElementById("profile-menu");
  $btn.onclick = (e) => { e.stopPropagation(); $menu.hidden = !$menu.hidden; $btn.setAttribute("aria-expanded", String(!$menu.hidden)); };
  if (!bindTopBar.done) {   // 바깥을 누르거나 Esc면 메뉴 닫기 (한 번만 등록)
    bindTopBar.done = true;
    const shut = () => { const m = document.getElementById("profile-menu"); if (m) { m.hidden = true; document.getElementById("profile-btn")?.setAttribute("aria-expanded", "false"); } };
    document.addEventListener("click", (e) => { if (!e.target.closest(".profile")) shut(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") shut(); });
  }
  document.getElementById("logout").onclick = logout;
  document.getElementById("guide-open").onclick = () => { document.getElementById("profile-menu").hidden = true; showGuide(); };
}

async function viewHome() {
  const mascot = document.getElementById("mascot-template").innerHTML;
  $app.innerHTML = `
    ${topBar()}
    <div class="home2">
      <aside class="side" aria-label="폴더"><div id="folders"></div></aside>
      <section class="home-main">
        <div class="resume" id="resume"><span class="mascot xs">${mascot}</span><p class="resume-text">&nbsp;</p></div>
        <div class="toolbar">
          <input type="search" id="search" placeholder="주제·질문·생각·답·메모 검색" value="${esc(state.q)}" aria-label="검색">
          <a class="btn btn-primary" href="#/new">새 주제</a>
        </div>
        <div id="topic-area"></div>
      </section>
    </div>`;
  bindTopBar();
  let timer;
  document.getElementById("search").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.q = e.target.value.trim(); loadTopicRows(); }, 250);
  });
  await loadTopicRows();
  maybeShowGuide();  // 처음 들어온 사람에게 사용법을 한 번 보여 준다
}

// "어제 '주제'에서 '마지막 질문'을 고민하다 멈췄어요. 이어서 생각해 볼까요?"
function renderResume(all) {
  const $r = document.getElementById("resume");
  if (!$r) return;
  const mascot = $r.querySelector(".mascot").outerHTML;
  const open = all.filter((t) => t.status === "in_progress");
  const last = (open.length ? open : all).slice().sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))[0];
  let html;
  if (!last) {
    html = `<p class="resume-text">아직 주제가 없어요. 궁금한 게 생기면, AI에게 묻기 전에 내 생각부터 적어 볼까요?</p>
            <a class="btn btn-brand-line" href="#/new">첫 주제 만들기 →</a>`;
  } else if (!last.last_question) {
    html = `<p class="resume-text">${ago(last.updated_at)} <a href="#/topic/${last.id}">${esc(last.name)}</a>을(를) 만들고 첫 질문 전에 멈췄어요. 이어서 시작해 볼까요?</p>
            <a class="btn btn-brand-line" href="#/topic/${last.id}">이어서 생각하기 →</a>`;
  } else {
    html = `<p class="resume-text">${ago(last.updated_at)} <a href="#/topic/${last.id}">${esc(last.name)}</a>에서 <q>${esc(clip(last.last_question, 46))}</q>를 고민하다 멈췄어요. 이어서 생각해 볼까요?</p>
            <a class="btn btn-brand-line" href="#/topic/${last.id}">이어서 생각하기 →</a>`;
  }
  $r.innerHTML = mascot + `<div class="resume-body">${html}</div>`;
}

async function loadTopicRows() {
  const [allTopics, folders] = await Promise.all([
    api(`/api/topics?${new URLSearchParams({ q: state.q })}`),
    api("/api/folders"),
  ]);
  // '예시 주제 숨기기'를 켜면 가입 때 들어온 예시 주제를 빼고 내가 만든 주제만
  const all = state.hideSamples ? allTopics.filter((t) => !t.is_sample) : allTopics;
  state.folders = folders;
  const $area = document.getElementById("topic-area");
  if (!$area) return;
  if (!state.q) renderResume(all);
  // 고른 폴더가 지워졌으면 전체로
  if (typeof state.folder === "number" && !folders.some((f) => f.id === state.folder)) state.folder = "all";

  // ---- 왼쪽 폴더 목록 (숫자 없이) ----
  const cur = typeof state.folder === "number" ? folders.find((f) => f.id === state.folder) : null;
  const fitem = (key, label) =>
    `<li><button class="side-item ${state.folder === key ? "active" : ""}" data-folder="${key}" ${state.folder === key ? 'aria-current="true"' : ""}>${esc(label)}</button>
      ${cur && key === cur.id ? `<span class="side-actions"><button class="link" id="folder-rename">이름 바꾸기</button><button class="link danger" id="folder-delete">삭제</button></span>` : ""}</li>`;
  document.getElementById("folders").innerHTML = `
    <h2 class="side-title">폴더</h2>
    <ul class="side-list">
      ${fitem("all", "모든 주제")}
      ${folders.map((f) => fitem(f.id, f.name)).join("")}
      ${fitem("none", "폴더 없음")}
    </ul>
    <button class="side-add" id="folder-add">+ 새 폴더</button>
    ${allTopics.some((t) => t.is_sample) ? `<label class="side-toggle"><input type="checkbox" id="hide-samples" ${state.hideSamples ? "checked" : ""}> 예시 주제 숨기기</label>` : ""}`;
  const $hide = document.getElementById("hide-samples");
  if ($hide) $hide.onchange = () => {
    state.hideSamples = $hide.checked;
    try { localStorage.setItem("bb-hide-samples", $hide.checked ? "1" : "0"); } catch { /* 괜찮음 */ }
    loadTopicRows();
  };
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

  // ---- 목록: 중요 카드 / 진행 중 / 접힌 완료 ----
  const inFolder = all.filter((t) =>
    state.folder === "all" ? true : state.folder === "none" ? t.folder_id == null : t.folder_id === state.folder);
  const pinned = inFolder.filter((t) => t.is_starred);
  const rest = inFolder.filter((t) => !t.is_starred);
  const open = rest.filter((t) => t.status === "in_progress");
  const done = rest.filter((t) => t.status === "done");
  const meta = (t) => [`대화 ${t.turn_count}`, t.open_notes ? `메모 ${t.open_notes}` : "", ago(t.updated_at)].filter(Boolean).join(" · ");
  const moveSelect = (t) => `
    <select class="move" data-move="${t.id}" aria-label="${esc(t.name)} 폴더 옮기기" title="폴더 옮기기">
      <option value="__keep" selected hidden>옮기기</option>
      <option value="" ${t.folder_id == null ? "disabled" : ""}>폴더 없음${t.folder_id == null ? " (지금)" : ""}</option>
      ${folders.map((f) => `<option value="${f.id}" ${t.folder_id === f.id ? "disabled" : ""}>${esc(f.name)}${t.folder_id === f.id ? " (지금)" : ""}</option>`).join("")}
      <option value="__new">+ 새 폴더…</option>
    </select>`;
  const row = (t) => `
    <li class="topic-row ${t.status}" data-id="${t.id}">
      ${starBtn(t.is_starred, t.name)}
      <a class="topic-link" href="#/topic/${t.id}">
        <span class="topic-name">${esc(t.name)}</span>
        <span class="topic-q">${t.last_question ? esc(t.last_question) : "아직 질문 전이에요"}</span>
        <span class="topic-meta">${meta(t)}</span>
      </a>
      ${moveSelect(t)}
    </li>`;
  const card = (t) => `
    <li class="pin-card ${t.status}" data-id="${t.id}">
      <div class="pin-top">${starBtn(true, t.name)}${t.status === "done" ? `<span class="pin-done">완료</span>` : ""}</div>
      <a class="pin-link" href="#/topic/${t.id}">
        <span class="pin-title">${esc(t.name)}</span>
        <span class="pin-q">${t.last_question ? esc(t.last_question) : "아직 질문 전이에요"}</span>
        <span class="topic-meta">${meta(t)}</span>
      </a>
    </li>`;

  if (!inFolder.length) {
    $area.innerHTML = `<p class="empty">${
      state.q ? "찾는 주제가 없어요."
      : all.length ? "이 폴더에는 아직 주제가 없어요. 주제 오른쪽의 폴더 메뉴로 옮기거나, 새 주제를 만들어 보세요."
      : "아직 주제가 없어요. 궁금한 게 생겼다면, AI에게 묻기 전에 내 생각부터 적어 보세요."}</p>`;
    return;
  }
  const doneOpen = state.doneOpen ? "open" : "";
  $area.innerHTML = `
    ${pinned.length ? `<section class="pins" aria-label="중요 표시한 주제"><ul class="pin-grid">${pinned.map(card).join("")}</ul></section>` : ""}
    ${open.length || !pinned.length ? `
    <section class="group" aria-label="진행 중">
      <h2 class="group-title">진행 중</h2>
      ${open.length ? `<ul class="topic-rows">${open.map(row).join("")}</ul>` : `<p class="group-empty">진행 중인 주제가 없어요.</p>`}
    </section>` : ""}
    ${done.length ? `
    <details class="group done-group" id="done-group" ${doneOpen}>
      <summary class="group-title">완료 <span class="group-count">${done.length}</span></summary>
      <ul class="topic-rows">${done.map(row).join("")}</ul>
    </details>` : ""}`;
  document.getElementById("done-group")?.addEventListener("toggle", (e) => { state.doneOpen = e.target.open; });

  $area.querySelectorAll("[data-star]").forEach((b) => {
    b.onclick = async () => {
      const id = b.closest("[data-id]").dataset.id;
      const on = b.getAttribute("aria-pressed") !== "true";
      try { await api(`/api/topics/${id}`, { method: "PATCH", body: { is_starred: on } }); loadTopicRows(); }
      catch (err) { toast(err.message); }
    };
  });
  $area.querySelectorAll("[data-move]").forEach((sel) => {
    sel.onchange = async () => {
      if (sel.value === "__keep") return;
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

// ---------- 사용 통계 (주인 계정만) ----------
// 숫자만 본다. 질문·생각·답·메모의 내용은 서버가 아예 보내지 않고, 5명 미만 묶음은 가린다.
const pct = (r) => (r == null ? "–" : `${Math.round(r * 100)}%`);
const num = (n) => (n == null ? "–" : Number(n).toLocaleString("ko-KR"));

function statTile(label, value, sub = "", tipText = "") {
  return `<div class="st-tile">
    <span class="st-label">${esc(label)}${tipText ? ` ${tip(tipText, label)}` : ""}</span>
    <span class="st-value">${value}</span>
    ${sub ? `<span class="st-sub">${sub}</span>` : ""}
  </div>`;
}

// 가로 막대: 이름 · 막대 · 숫자 (색 하나, 값은 늘 글자로 함께 → 색만으로 읽지 않게)
function hbars(rows, unit = "") {
  const max = Math.max(1, ...rows.map((r) => r.n || 0));
  return `<div class="hb" role="table">
    ${rows.map((r) => `
      <div class="hb-row" role="row">
        <span class="hb-label" role="cell">${esc(r.label)}</span>
        <span class="hb-track" role="cell" aria-hidden="true">${r.n ? `<i style="width:${Math.max(2, (r.n / max) * 100)}%"></i>` : ""}</span>
        <span class="hb-val" role="cell">${r.n == null ? `<span class="muted" data-tip="개인을 알아볼 수 없게 5명 미만 묶음은 숫자를 가려요">5명 미만</span>` : num(r.n) + unit}</span>
      </div>`).join("")}
  </div>`;
}

// 최근 14일 막대: 막대에 마우스를 올리면 날짜·개수, 아래 표로도 볼 수 있음
function dailyBars(daily) {
  const max = Math.max(1, ...daily.map((d) => d.n));
  const label = (d) => `${Number(d.day.slice(5, 7))}월 ${Number(d.day.slice(8, 10))}일`;
  return `
    <div class="vb" role="img" aria-label="최근 14일 새 대화 수">
      <div class="vb-grid">
        ${daily.map((d) => `
          <div class="vb-col" data-tip="${label(d)} · 대화 ${d.n}개">
            <i style="height:${d.n ? Math.max(3, (d.n / max) * 100) : 0}%"></i>
          </div>`).join("")}
      </div>
      <div class="vb-axis"><span>${label(daily[0])}</span><span>오늘</span></div>
    </div>
    <details class="vb-table"><summary>표로 보기</summary>
      <table><thead><tr><th>날짜</th><th>새 대화</th></tr></thead>
      <tbody>${daily.map((d) => `<tr><td>${label(d)}</td><td>${d.n}</td></tr>`).join("")}</tbody></table>
    </details>`;
}

async function viewStats(includeOwner = false) {
  if (!state.user?.admin) { location.replace("#/"); return; }
  $app.innerHTML = `
    ${topBar()}
    <div class="stats">
      <a class="back" href="#/">← 주제 목록</a>
      <div class="st-head">
        <h1 class="page-title">사용 통계 ${tip("숫자만 보여요. 질문·생각·답·메모의 내용은 볼 수 없고, 5명 미만인 묶음은 가려요. 가입하면 들어가는 예시 주제는 빼고 셌어요.", "사용 통계 안내")}</h1>
        <label class="st-toggle"><input type="checkbox" id="st-owner" ${includeOwner ? "checked" : ""}> 내 계정도 포함</label>
      </div>
      <div id="st-body"><p class="map-loading">통계를 모으는 중…</p></div>
    </div>`;
  bindTopBar();
  document.getElementById("st-owner").onchange = (e) => { location.hash = e.target.checked ? "#/stats?owner=1" : "#/stats"; };
  let d;
  try { d = await api(`/api/admin/stats${includeOwner ? "?include_owner=1" : ""}`); }
  catch (err) { document.getElementById("st-body").innerHTML = `<p class="map-loading err">${esc(err.message)}</p>`; return; }
  const $b = document.getElementById("st-body");
  if (d.empty) {
    $b.innerHTML = `<p class="empty">아직 ${includeOwner ? "" : "나 말고 "}가입한 사람이 없어요.${includeOwner ? "" : " '내 계정도 포함'을 켜면 내 사용 기록으로 볼 수 있어요."}</p>`;
    return;
  }
  const { users, topics, turns, notes, mindmap, ai } = d;
  $b.innerHTML = `
    <section class="st-sec">
      <div class="st-grid">
        ${statTile("가입한 사람", num(users.total), `최근 7일 새로 ${num(users.new_7d)}명`)}
        ${statTile("최근 7일 쓴 사람", num(users.active_7d), "대화를 하나라도 남긴 사람")}
        ${statTile("주제", num(topics.total), `완료 ${num(topics.done)} · 주제당 대화 ${topics.avg_turns ?? "–"}개`)}
        ${statTile("대화", num(turns.total), `AI 답까지 받은 대화 ${num(turns.answered)}`)}
      </div>
    </section>

    <section class="st-sec">
      <h2 class="st-title">AI보다 먼저 생각했나</h2>
      <div class="st-grid">
        ${statTile("내 생각 길이", turns.thought_avg == null ? "–" : `${num(turns.thought_avg)}자`, `가운데값 ${turns.thought_median ?? "–"}자`, "AI 답을 받은 대화에서, 답을 보기 전에 적은 내 생각의 평균 글자 수예요.")}
        ${statTile("AI 답 대비 내 생각", pct(turns.thought_vs_ai), "글자 수 비율", "내 생각 글자 수 합 ÷ AI 답 글자 수 합. 높을수록 AI 답에 비해 내 생각을 많이 적었다는 뜻이에요.")}
        ${statTile("생각 메모를 남긴 대화", pct(turns.reflection_rate), "AI 답을 보고 돌아본 비율", "AI 답을 받은 대화 중 '생각 메모'에 소감을 남긴 비율이에요.")}
      </div>
    </section>

    <section class="st-sec">
      <h2 class="st-title">곁가지를 메모함에 담았나</h2>
      <div class="st-split">
        <div class="st-grid two">
          ${statTile("메모", num(notes.total), `완료 ${pct(notes.done_rate)}`)}
          ${statTile("메모를 쓴 주제", pct(notes.topic_rate), "메모가 하나라도 있는 주제")}
        </div>
        <div class="st-card"><h3 class="st-sub-title">종류별</h3>${hbars(notes.kinds, "개")}</div>
      </div>
    </section>

    <section class="st-sec">
      <h2 class="st-title">마인드맵</h2>
      <div class="st-grid">
        ${statTile("만든 마인드맵", num(mindmap.maps))}
        ${statTile("직접 고친 비율", pct(mindmap.edited_rate), "AI 정리를 사용자가 바로잡음", "AI가 정리한 마인드맵을 사용자가 '직접 고치기'로 바꾼 비율이에요.")}
        ${statTile("겹치는 생각", mindmap.shared_avg == null ? "–" : `평균 ${mindmap.shared_avg}개`, `같은 생각 ${num(mindmap.same)} · 비슷한 생각 ${num(mindmap.similar)}`)}
      </div>
    </section>

    <section class="st-sec">
      <h2 class="st-title">최근 14일 새 대화</h2>
      <div class="st-card">${dailyBars(d.daily)}</div>
    </section>

    <section class="st-sec">
      <h2 class="st-title">가입한 사람 ${tip("가입할 때 받은 나이·성별을 묶음으로만 보여요. 5명 미만인 묶음은 숫자를 가려요.", "가입자 안내")}</h2>
      ${d.ages ? `<div class="st-split even">
        <div class="st-card"><h3 class="st-sub-title">연령대</h3>${hbars(d.ages, "명")}</div>
        <div class="st-card"><h3 class="st-sub-title">성별</h3>${hbars(d.genders, "명")}</div>
      </div>` : `<p class="st-note">가입한 사람이 ${d.min_group}명 이상이 되면 보여요.</p>`}
    </section>

    <section class="st-sec">
      <h2 class="st-title">AI 사용량 ${tip("AI를 부른 횟수예요. 이미 받은 답이나 저장된 마인드맵을 다시 본 건 세지 않아요.", "AI 사용량 안내")}</h2>
      <div class="st-grid">
        ${statTile("오늘", `${num(ai.today)}회`)}
        ${statTile("최근 7일 AI 답", `${num(ai.week_answer)}회`)}
        ${statTile("최근 7일 마인드맵 정리", `${num(ai.week_mindmap)}회`)}
      </div>
    </section>`;
}

// ---------- 설정: AI 사용 (초대 코드) ----------
function aiBlock(ai = { access: "owner" }) {
  if (ai.access === "owner") {
    return `<h2>AI 사용</h2><p class="set-help">이 계정은 AI 답과 마인드맵 정리를 쓸 수 있어요.</p>`;
  }
  if (ai.access === "invited") {
    return `<h2>AI 사용</h2>
      <p class="set-help">초대 코드로 AI를 쓰고 있어요. 오늘 <b class="set-num">${ai.used_today}</b> / ${ai.daily_limit}회 썼어요.</p>
      <p class="set-help">AI 답 1번, 마인드맵 정리 1번이 각각 1회예요. 이미 받은 답을 다시 보는 건 세지 않아요.</p>`;
  }
  return `<h2>AI 사용</h2>
    <p class="set-help">AI 답과 마인드맵 정리는 초대받은 계정만 쓸 수 있어요. 질문·내 생각·메모는 그대로 쓸 수 있어요.</p>
    <form class="invite-form" id="invite-form" novalidate>
      <input type="text" id="invite-input" placeholder="초대 코드" autocomplete="off" maxlength="64" aria-label="초대 코드">
      <button class="btn btn-primary" type="submit">확인</button>
    </form>
    <p class="form-err" id="invite-err" role="alert"></p>`;
}

function bindAiBlock() {
  const $f = document.getElementById("invite-form");
  if (!$f) return;
  $f.onsubmit = async (e) => {
    e.preventDefault();
    const code = document.getElementById("invite-input").value.trim();
    const $err = document.getElementById("invite-err");
    $err.textContent = "";
    try {
      const { user } = await api("/api/me/invite", { method: "POST", body: { code } });
      state.user = user;
      document.getElementById("ai-block").innerHTML = aiBlock(user.ai);
      toast("이제 AI 답을 쓸 수 있어요");
    } catch (err) { $err.textContent = err.message; }
  };
}

// ---------- 설정: 계정 정보 · 화면 · 탈퇴 ----------
function viewSettings() {
  const u = state.user || {};
  $app.innerHTML = `
    ${topBar()}
    <div class="narrow settings">
      <a class="back" href="#/">← 주제 목록</a>
      <h1 class="page-title">설정</h1>
      <section class="set-block">
        <h2>계정</h2>
        <dl class="set-list">
          <div><dt>이름</dt><dd>${esc(u.name || "")}</dd></div>
          <div><dt>이메일</dt><dd>${esc(u.email || "")}</dd></div>
        </dl>
        <p class="set-help">비밀번호를 바꾸려면 로그아웃한 뒤 로그인 화면의 '비밀번호를 잊었나요?'를 이용해 주세요.</p>
      </section>
      <section class="set-block" id="ai-block">${aiBlock(u.ai)}</section>
      <section class="set-block">
        <h2>화면</h2>
        <div class="set-row"><span>어두운 화면</span>${themeToggle()}</div>
      </section>
      <section class="set-block danger-zone">
        <h2>탈퇴</h2>
        <p class="set-help">탈퇴하면 계정과 모든 주제·대화·메모·첨부파일이 바로 지워지고 되돌릴 수 없어요.</p>
        <button class="btn btn-sm danger-outline" id="delete-account">탈퇴하기</button>
      </section>
    </div>`;
  bindTopBar();
  document.getElementById("delete-account").onclick = deleteAccount;
  bindAiBlock();
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
        <li><span class="step-num">02</span> AI 답을 보기 전에 내 생각을 먼저 써요</li>
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
  chatCtx.topic = topic; chatCtx.turns = turns; chatCtx.notes = data.notes || [];
  chatCtx.filter = "all"; chatCtx.adding = false; chatCtx.open = false;

  $app.innerHTML = `
    <header class="topic-head">
      <div class="topic-head-inner">
        <div class="topic-title-row">
          <a class="btn btn-ghost" href="#/" aria-label="주제 목록으로">←</a>
          <h1 id="topic-title" title="눌러서 이름 바꾸기">${esc(topic.name)}</h1>
          <div class="topic-actions">
            ${starBtn(topic.is_starred, topic.name)}
            <button class="status status-toggle" id="status-btn"></button>
            ${tab === "chat" ? `<button class="btn btn-sm notes-toggle" id="notes-toggle" title="메모함 열기">메모함 <span data-notes-count>0</span></button>` : ""}
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

// ---------- 메모함: AI 답에서 지금 다루지 않을 곁가지를 담아 두는 곳 ----------
// 대화는 원래 주제로 이어 가고, AI가 말한 것 중 지금 다루지 않을 곁가지(확인할 것·할 일·마음에 드는 것)는
// 드래그해서 여기에 담아 두고 우선순위와 완료로 관리한다.
//   확인할 것: 모르는 말, 맞는지 알아볼 것 (AI에게 다시 물어볼 수도 있음)
//   할 일: 내가 직접 해야 할 것
//   마음에 드는 것: 나중에 가져다 쓰고 싶은 아이디어
const NOTE_KINDS = { check: "확인할 것", todo: "할 일", like: "마음에 드는 것" };
const PRIORITY = { high: "높음", mid: "보통", low: "낮음" };
const PRIORITY_ORDER = { high: 0, mid: 1, low: 2 };
const chatCtx = { topic: null, turns: [], notes: [], filter: "all", adding: false, open: false };

function openNoteCount() { return chatCtx.notes.filter((n) => !n.done).length; }

function updateNoteBadges() {
  const n = openNoteCount();
  document.querySelectorAll("[data-notes-count]").forEach((el) => (el.textContent = n));
}

function renderNotes() {
  const $p = document.getElementById("notes-panel");
  if (!$p) return;
  setTimeout(updateDragHint, 0);  // 메모가 생기면 드래그 안내는 숨긴다
  const { notes, filter, turns } = chatCtx;
  const turnNo = Object.fromEntries(turns.map((t, i) => [t.id, i + 1]));
  const count = (k) => notes.filter((n) => !n.done && (k === "all" || n.kind === k)).length;
  const list = notes
    .filter((n) => filter === "all" || n.kind === filter)
    .sort((a, b) => a.done - b.done || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.id - b.id);
  const chip = (k, label) =>
    `<button class="nf ${filter === k ? "active" : ""}" data-nf="${k}">${label} <span>${count(k)}</span></button>`;

  $p.innerHTML = `
    <div class="np-head">
      <h2>메모함 <span class="np-count" data-notes-count>${openNoteCount()}</span></h2>
      <button class="btn btn-ghost btn-sm np-close" data-np-close aria-label="메모함 닫기">닫기</button>
    </div>
    <p class="np-help">AI 답에서 지금 다루지 않을 내용은 <b>문장을 드래그</b>해서 여기에 담아 두세요. 담은 메모는 <b>우선순위</b>를 정하면 높은 것부터 위로 정렬돼요.</p>
    <div class="np-filters">${chip("all", "전체")}${Object.entries(NOTE_KINDS).map(([k, v]) => chip(k, v)).join("")}</div>
    ${chatCtx.adding ? `
      <form class="np-add" id="np-add">
        <select name="kind" aria-label="종류">${Object.entries(NOTE_KINDS).map(([k, v]) => `<option value="${k}" ${filter === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        <select name="priority" aria-label="우선순위">${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}" ${k === "mid" ? "selected" : ""}>우선순위 ${v}</option>`).join("")}</select>
        <textarea name="text" rows="2" maxlength="500" placeholder="메모할 내용" aria-label="메모할 내용"></textarea>
        <div class="np-add-btns"><button type="button" class="btn btn-ghost btn-sm" data-np-cancel>취소</button><button class="btn btn-primary btn-sm">담기</button></div>
      </form>` : `<button class="np-add-btn" data-np-add>+ 직접 적기</button>`}
    <ul class="np-list">
      ${list.length ? list.map((n) => `
        <li class="note ${n.kind} ${n.done ? "done" : ""}" data-note="${n.id}">
          <div class="note-top">
            <label class="note-check"><input type="checkbox" ${n.done ? "checked" : ""} data-n-done aria-label="완료"></label>
            <span class="note-kind">${NOTE_KINDS[n.kind]}</span>
            <button class="note-x" data-n-del aria-label="메모 지우기">×</button>
          </div>
          <p class="note-text">${esc(n.text)}</p>
          ${n.note ? `<p class="note-my">${esc(n.note)}</p>` : ""}
          <div class="note-pri-row" role="group" aria-label="우선순위">
            <span class="np-label">우선순위</span>
            ${Object.entries(PRIORITY).map(([k, v]) => `<button class="pri-opt ${k} ${n.priority === k ? "on" : ""}" data-n-pri="${k}" aria-pressed="${n.priority === k}">${v}</button>`).join("")}
          </div>
          <div class="note-foot">
            ${n.turn_id && turnNo[n.turn_id] ? `<button class="turn-chip" data-n-jump="${n.turn_id}">대화 ${turnNo[n.turn_id]}</button>` : ""}
            <button class="note-link" data-n-note>${n.note ? "메모 고치기" : "메모 달기"}</button>
            ${n.kind === "check" && !n.done ? `<button class="note-link strong" data-n-ask>AI에게 물어보기 →</button>` : ""}
          </div>
        </li>`).join("") : `<li class="np-empty">${notes.length ? "이 종류의 메모는 없어요." : "아직 담은 메모가 없어요.<br>AI 답에서 확인할 것, 할 일, 마음에 드는 아이디어를 드래그해 보세요."}</li>`}
    </ul>`;
  updateNoteBadges();
}

async function saveNote(id, body) {
  const updated = await api(`/api/notes/${id}`, { method: "PATCH", body });
  chatCtx.notes = chatCtx.notes.map((n) => (n.id === id ? updated : n));
  renderNotes();
}

async function addNote(body) {
  const created = await api(`/api/topics/${chatCtx.topic.id}/notes`, { method: "POST", body });
  chatCtx.notes.push(created);
  chatCtx.filter = chatCtx.filter === "all" || chatCtx.filter === created.kind ? chatCtx.filter : "all";
  renderNotes();
  document.querySelector(`[data-note="${created.id}"]`)?.classList.add("just-added");
  return created;
}

function bindNotesPanel() {
  const $p = document.getElementById("notes-panel");
  $p.onclick = async (e) => {
    const el = e.target;
    const card = el.closest("[data-note]");
    const id = card ? Number(card.dataset.note) : null;
    const note = id ? chatCtx.notes.find((n) => n.id === id) : null;
    try {
      if (el.closest("[data-nf]")) { chatCtx.filter = el.closest("[data-nf]").dataset.nf; renderNotes(); }
      else if (el.closest("[data-np-add]")) { chatCtx.adding = true; renderNotes(); $p.querySelector("#np-add textarea").focus(); }
      else if (el.closest("[data-np-cancel]")) { chatCtx.adding = false; renderNotes(); }
      else if (el.closest("[data-np-close]")) { toggleNotes(false); }
      else if (el.closest("[data-n-pri]")) {
        const next = el.closest("[data-n-pri]").dataset.nPri;
        if (next !== note.priority) await saveNote(id, { priority: next });
      }
      else if (el.closest("[data-n-del]")) {
        if (await ask({ title: "이 메모를 지울까요?", message: note.text.slice(0, 80), confirmText: "지우기", danger: true })) {
          await api(`/api/notes/${id}`, { method: "DELETE" });
          chatCtx.notes = chatCtx.notes.filter((n) => n.id !== id);
          renderNotes();
        }
      }
      else if (el.closest("[data-n-note]")) {
        const v = await ask({ title: note.note ? "메모 고치기" : "메모 달기", message: note.text.slice(0, 120), input: { value: note.note, maxlength: 500, placeholder: "왜 담았는지, 언제 볼지 등" }, confirmText: "저장" });
        if (v !== null) await saveNote(id, { note: v });
      }
      else if (el.closest("[data-n-jump]")) { jumpToTurn(Number(el.closest("[data-n-jump]").dataset.nJump)); toggleNotes(false); }
      else if (el.closest("[data-n-ask]")) {
        // 확인할 것 → 입력창에 질문으로 옮기고, 물어보면 완료로
        const { topic, turns } = chatCtx;
        state.drafts[topic.id] = { step: 1, question: note.text, thought: "", files: [], fromNote: id };
        renderComposer(topic, turns);
        toggleNotes(false);
        const $q = document.getElementById("c-question");
        $q.focus(); $q.setSelectionRange($q.value.length, $q.value.length);
        $q.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    } catch (err) { toast(err.message); }
  };
  $p.onchange = async (e) => {
    if (!e.target.matches("[data-n-done]")) return;
    const id = Number(e.target.closest("[data-note]").dataset.note);
    try { await saveNote(id, { done: e.target.checked }); } catch (err) { toast(err.message); }
  };
  $p.onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const text = f.text.value.trim();
    if (!text) { f.text.focus(); return; }
    try { chatCtx.adding = false; await addNote({ kind: f.kind.value, priority: f.priority.value, text }); toast("메모함에 담았어요"); }
    catch (err) { toast(err.message); }
  };
}

function toggleNotes(open) {
  chatCtx.open = open ?? !chatCtx.open;
  document.querySelector(".chat-wrap")?.classList.toggle("notes-open", chatCtx.open);
}

// AI 답에서 문장을 드래그하면 뜨는 작은 메뉴
function setupSelectionCapture() {
  let $pop = document.getElementById("sel-pop");
  if (!$pop) {
    $pop = document.createElement("div");
    $pop.id = "sel-pop";
    $pop.className = "sel-pop";
    $pop.setAttribute("role", "toolbar");
    $pop.setAttribute("aria-label", "메모함에 담기");
    $pop.innerHTML = Object.entries(NOTE_KINDS).map(([k, v]) => `<button data-sel-kind="${k}">${v}</button>`).join("");
    document.body.appendChild($pop);
    // 버튼을 누를 때 선택이 풀리지 않게
    $pop.addEventListener("mousedown", (e) => e.preventDefault());
    $pop.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-sel-kind]");
      if (!b || !$pop.dataset.text) return;
      try {
        await addNote({ kind: b.dataset.selKind, text: $pop.dataset.text, turn_id: Number($pop.dataset.turn) || null });
        toast(`'${NOTE_KINDS[b.dataset.selKind]}'(으)로 메모함에 담았어요`);
      } catch (err) { toast(err.message); }
      window.getSelection()?.removeAllRanges();
      $pop.hidden = true;
    });
  }
  $pop.hidden = true;
  const check = () => {
    const sel = window.getSelection();
    const text = sel ? sel.toString().replace(/\s+/g, " ").trim() : "";
    const anchor = sel && sel.rangeCount ? sel.getRangeAt(0).commonAncestorContainer : null;
    const answer = anchor && (anchor.nodeType === 1 ? anchor : anchor.parentElement)?.closest(".block.ai .md");
    if (!text || text.length < 2 || !answer || !document.getElementById("notes-panel")) { $pop.hidden = true; return; }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    $pop.dataset.text = text.slice(0, 500);
    $pop.dataset.turn = answer.closest(".turn")?.dataset.id || "";
    $pop.hidden = false;
    const w = $pop.offsetWidth;
    $pop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    $pop.style.top = `${Math.max(8, r.top - $pop.offsetHeight - 8)}px`;
  };
  document.onmouseup = () => setTimeout(check, 0);
  document.ontouchend = () => setTimeout(check, 250);
  document.onselectionchange = () => { const s = window.getSelection(); if (!s || s.isCollapsed) $pop.hidden = true; };
  window.addEventListener("scroll", () => { $pop.hidden = true; }, { passive: true });
}

// 긴 주소는 '사이트 이름 링크'로 줄여 보여 준다 (마인드맵 질문 마디처럼 좁은 곳)
const shortLinks = (s) => String(s).replace(/https?:\/\/(?:www\.)?([^\/\s?#]+)[^\s]*/g, "[$1 링크]");

// ---------- 사용법 안내 (처음 한 번 자동으로, 이후 프로필 메뉴 → 사용법) ----------
const GUIDE = [
  ["질문 → 내 생각 → AI 답", "질문을 적고, AI 답을 보기 전에 내 생각을 먼저 적어요. 내 생각은 AI에게 보내지 않아요.",
   "AI 답을 먼저 보면 내 생각이 떠오르지 않고 AI의 말을 따라가게 돼요. 먼저 적어 둔 생각이 비교의 기준이 돼요."],
  ["이어서 묻기", "AI 답을 받은 뒤에는 같은 주제 안에서 꼬리 질문을 계속 이어 갈 수 있어요. 꼬리 질문은 내 생각을 건너뛰고 '바로 묻기'도 돼요. 지난 질문은 한 줄로 접혀요.",
   "새 주제를 만들지 않고 한 흐름으로 이어 가야 생각이 흩어지지 않아요."],
  ["메모함", "AI 답에서 문장을 드래그(휴대폰은 길게 눌러 선택)하면 '확인할 것 · 할 일 · 마음에 드는 것'으로 담겨요. 메모마다 우선순위를 정하면 높은 것부터 위로 정렬돼요.",
   "AI 답의 곁가지를 바로 따라가면 대화가 원래 주제에서 벗어나요. 지금은 담아 두고, 나중에 하나씩 처리해요."],
  ["생각 메모", "AI 답을 본 뒤, 내 생각과 비교해 무엇이 같고 달랐는지 한 줄로 남겨요.",
   "AI 답을 그대로 받아들이지 않고, 무엇을 가져가고 무엇을 지킬지 스스로 정하는 단계예요."],
  ["마인드맵", "주제의 대화가 쌓이면 질문마다 왼쪽은 내 생각, 오른쪽은 AI 생각, 아래는 둘이 겹치는 생각으로 정리돼요. 틀린 곳은 '직접 고치기'로 바로잡아요.",
   "내 생각과 AI 생각이 어디서 같고 어디서 다른지 한눈에 보여, 내 관점을 잃지 않게 해 줘요."],
];

function showGuide() {
  document.getElementById("guide")?.remove();
  document.body.insertAdjacentHTML("beforeend", `
    <div class="guide-backdrop" id="guide" role="dialog" aria-modal="true" aria-labelledby="guide-title">
      <div class="guide">
        <h2 id="guide-title">비포블랭크 사용법</h2>
        <p class="guide-lead">AI에게 묻기 전에 내 생각부터 적고, AI 답과 나란히 비교하는 노트예요.</p>
        <ol class="guide-steps">
          ${GUIDE.map(([name, how, why], i) => `
            <li>
              <span class="g-no">${String(i + 1).padStart(2, "0")}</span>
              <div><b>${name}</b><p>${how}</p><p class="g-why"><span>왜?</span> ${why}</p></div>
            </li>`).join("")}
        </ol>
        <div class="guide-btns"><button class="btn btn-primary" id="guide-close">시작하기</button></div>
      </div>
    </div>`);
  const close = () => { document.getElementById("guide")?.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  document.getElementById("guide-close").onclick = close;
  document.getElementById("guide").onclick = (e) => { if (e.target.id === "guide") close(); };
  document.getElementById("guide-close").focus();
  try { localStorage.setItem("bb-guide-seen", "1"); } catch { /* 괜찮음 */ }
}

function maybeShowGuide() {
  let seen = false;
  try { seen = localStorage.getItem("bb-guide-seen") === "1"; } catch { /* 괜찮음 */ }
  if (!seen) showGuide();
}

// ---------- 드래그 안내 ----------
// 메모함에 담는 방법(문장 드래그)을 잘 모른다는 피드백 → 마지막 AI 답 아래에 한 줄 안내. '알겠어요'를 누르거나 메모를 담으면 사라진다.
function updateDragHint() {
  let off = false;
  try { off = localStorage.getItem("bb-drag-hint") === "off"; } catch { /* 기억 못 해도 괜찮음 */ }
  const hints = [...document.querySelectorAll("[data-drag-hint]")];
  hints.forEach((h) => { h.hidden = true; });
  if (off || (chatCtx.notes || []).length) return;
  const answered = hints.filter((h) => h.closest(".block.ai")?.querySelector("[data-answer]")?.textContent.trim());
  const last = answered.at(-1);
  if (!last) return;
  last.hidden = false;
  last.querySelector("[data-drag-hint-off]").onclick = () => {
    try { localStorage.setItem("bb-drag-hint", "off"); } catch { /* 괜찮음 */ }
    updateDragHint();
  };
}

// ---------- 대화 탭 ----------
// 접힌 질문 한 줄 요약에 쓰는 AI 답 미리보기 (마크다운 기호를 빼고 앞부분만)
const answerPreview = (t) => (t.ai_answer || "").replace(/[#*`>|_]+|-{3,}/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);

function turnHTML(t, n, folded = false) {
  return `
    <article class="turn ${folded ? "folded" : ""} ${n > 1 ? "follow" : ""}" id="turn-${t.id}" data-id="${t.id}">
      <button class="turn-sum" data-unfold aria-expanded="false" title="눌러서 펼치기">
        <span class="ts-tag">${n > 1 ? "이어서 물음" : "질문"}</span>
        <span class="ts-q">${esc(t.question)}</span>
        <span class="ts-a">${esc(answerPreview(t))}</span>
        <span class="ts-more" aria-hidden="true">펼치기 ▾</span>
      </button>
      <header class="turn-meta">
        <span>${fmtDate(t.created_at)}</span>
        <button class="btn btn-ghost btn-sm" data-fold>접기 ▴</button>
        <button class="btn btn-ghost danger btn-sm" data-del-turn>삭제</button>
      </header>
      <div class="q-head"><span class="q-tag">${n > 1 ? "이어서 물음" : "질문"}</span><h2 class="turn-q">${esc(t.question)}</h2></div>
      ${t.attachments?.length ? `<div class="turn-files" aria-label="첨부 자료">${t.attachments.map(fileChip).join("")}</div>` : ""}
      ${t.my_thought ? `<section class="block mine">
        <div class="block-label"><i class="dot" aria-hidden="true"></i>내 생각</div>
        <div class="block-body">${esc(t.my_thought)}</div>
      </section>` : ""}
      <section class="block ai">
        <div class="block-label"><i class="dot" aria-hidden="true"></i>AI 답</div>
        <div class="md" data-answer>${t.ai_answer ? md(t.ai_answer) : ""}</div>
        ${t.ai_answer ? "" : `<button class="btn btn-primary btn-sm" data-ask>AI 답 보기</button>`}
        <div class="drag-hint" data-drag-hint hidden>
          <span class="dh-icon" aria-hidden="true">✎</span>
          <span><b>문장을 드래그해서 선택하면</b> 확인할 것·할 일·마음에 드는 것으로 메모함에 담을 수 있어요. <span class="dh-mobile">휴대폰에서는 길게 눌러 선택해요.</span></span>
          <button class="btn btn-ghost btn-sm" data-drag-hint-off>알겠어요</button>
        </div>
      </section>
      <div class="memo" data-memo ${t.ai_answer ? "" : "hidden"}></div>
    </article>`;
}

function renderChatTab($panel, topic, turns, opts) {
  $panel.innerHTML = `
   <div class="chat-wrap">
    <div class="chat">
      <div id="turns">${turns.length ? turns.map((t, i) => turnHTML(t, i + 1, i < turns.length - 1)).join("") : `
        <div class="chat-start">
          <h2>'${esc(topic.name)}'에 대해 무엇이 궁금한가요?</h2>
          <p>아래 입력창에 첫 질문을 적어 주세요. 이렇게 진행돼요.</p>
          <ol class="flow-preview">
            <li><span class="step-num">01</span> 질문을 적어요</li>
            <li><span class="step-num">02</span> AI 답을 보기 전에 내 생각을 먼저 써요</li>
            <li><span class="step-num">03</span> AI 답을 보고, 내 생각과 비교해 메모해요</li>
          </ol>
        </div>`}</div>
      <div class="composer" id="composer"></div>
    </div>
    <aside class="notes-panel" id="notes-panel" aria-label="메모함"></aside>
   </div>`;

  turns.forEach((t) => bindTurn(t));
  renderComposer(topic, turns);
  renderNotes();
  bindNotesPanel();
  setupSelectionCapture();
  document.getElementById("notes-toggle")?.addEventListener("click", () => toggleNotes());

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

// 지난 질문은 접어서 한 줄로: 길게 늘어지지 않게, 누르면 다시 펼친다
function foldTurn(t, fold) {
  const $t = document.getElementById(`turn-${t.id}`);
  if (!$t) return;
  $t.classList.toggle("folded", fold);
  $t.querySelector(".ts-a").textContent = answerPreview(t);
  $t.querySelector("[data-unfold]").setAttribute("aria-expanded", String(!fold));
}

function bindTurn(t) {
  const $turn = document.getElementById(`turn-${t.id}`);
  $turn.querySelector("[data-unfold]").onclick = () => foldTurn(t, false);
  $turn.querySelector("[data-fold]").onclick = () => { foldTurn(t, true); $turn.scrollIntoView({ block: "nearest" }); };
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
      const e = new Error(data.error || "AI 답을 받지 못했어요.");
      e.code = data.code;
      throw e;
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
    updateDragHint();
  } catch (err) {
    $body.innerHTML = `<p class="err">${esc(err.message)}</p>`;
    if (err.code === "no_ai_access") {
      // 다시 시도해도 같으니, 초대 코드를 넣는 곳으로 안내
      $body.insertAdjacentHTML("afterend", `<a class="btn btn-brand-line btn-sm" data-ask href="#/settings">초대 코드 입력하러 가기 →</a>`);
      return;
    }
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

// 입력창: ① 질문 → ② 내 생각 → AI 답 보기
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
  // AI 답을 한 번이라도 받은 주제에서는 꼬리 질문 → 내 생각을 건너뛰고 바로 물을 수 있다 (첫 질문은 꼭 내 생각부터)
  const canSkip = turns.some((x) => x.ai_answer);
  const pendingChips = () => draft.files.map((f, i) =>
    `<span class="file-chip pending"><span class="fc-kind">${fileKindLabel(f.name)}</span>${esc(f.name)}<span class="fc-size">${fmtSize(f.size)}</span>${draft.step === 1 ? `<button type="button" class="fc-x" data-unfile="${i}" aria-label="${esc(f.name)} 빼기">×</button>` : ""}</span>`).join("");

  if (draft.step === 1) {
    $c.innerHTML = `
      <div class="composer-box">
        ${composerSteps(1)}
        <textarea id="c-question" rows="2" aria-label="질문" placeholder="${turns.length ? "이어서 물어볼 질문을 적어 주세요 (예: 이 부분은 무슨 뜻이야?)" : "첫 질문을 적어 주세요"}">${esc(draft.question)}</textarea>
        <div class="c-files" id="c-files">${pendingChips()}</div>
        <div class="actions" style="margin-top:4px">
          <label class="attach-btn" title="자료 첨부 (txt, md, csv, pdf, 이미지 · ${MAX_MB}MB, ${MAX_FILES}개까지)">
            <input type="file" id="c-file" multiple accept=".txt,.md,.csv,.pdf,.png,.jpg,.jpeg,.webp" hidden>
            <span>+ 자료 첨부</span>
          </label>
          <span class="counter" id="c-qhint">${draft.question.trim() ? "Enter를 누르면 다음 단계로 가요" : "질문을 적으면 다음 단계로 넘어갈 수 있어요"}</span>
          ${canSkip ? `<button class="btn btn-sm" id="c-quick" ${draft.question.trim() ? "" : "disabled"} title="꼬리 질문은 내 생각을 건너뛰고 바로 물을 수 있어요">바로 묻기</button>` : ""}
          <button class="btn btn-primary btn-sm" id="c-next" ${draft.question.trim() ? "" : "disabled"}>다음: 내 생각 적기 →</button>
        </div>
      </div>`;
    const $q = document.getElementById("c-question");
    const $next = document.getElementById("c-next");
    $q.oninput = () => {
      draft.question = $q.value; $next.disabled = !$q.value.trim();
      const $quick = document.getElementById("c-quick");
      if ($quick) $quick.disabled = !$q.value.trim();
      document.getElementById("c-qhint").textContent = $q.value.trim() ? "Enter를 누르면 다음 단계로 가요" : "질문을 적으면 다음 단계로 넘어갈 수 있어요";
    };
    $q.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && $q.value.trim()) { e.preventDefault(); $next.click(); } };
    $next.onclick = () => { draft.step = 2; renderComposer(topic, turns); document.getElementById("c-thought").focus(); };
    const $quick = document.getElementById("c-quick");
    if ($quick) $quick.onclick = () => { draft.thought = ""; submitTurn(topic, turns, draft, $quick); };
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
      <div class="composer-label">AI에게 보내기 전에, 내 생각을 먼저 적어 보세요 <small>(AI에게는 보내지 않아요${canSkip ? " · 꼬리 질문은 비워 둬도 돼요" : ""})</small></div>
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
    $send.disabled = !canSkip && $t.value.trim().length < cfg.min_thought;
  });
  if (canSkip) $send.disabled = false;
  document.getElementById("c-back").onclick = () => { draft.step = 1; renderComposer(topic, turns); document.getElementById("c-question").focus(); };
  $send.onclick = () => submitTurn(topic, turns, draft, $send);
}

// 질문 보내기: 대화 칸을 만들고, 지난 질문은 접고, AI 답을 받는다
async function submitTurn(topic, turns, draft, $btn) {
    $btn.disabled = true;
    try {
      const { id } = await api(`/api/topics/${topic.id}/turns`, {
        method: "POST", body: { question: draft.question.trim(), my_thought: draft.thought.trim() },
      });
      let attachments = [];
      if (draft.files.length) {
        try { attachments = await uploadFiles(id, draft.files); }
        catch (err) { toast(`${err.message} 자료 없이 AI 답을 받아요.`); }
      }
      if (draft.fromNote) saveNote(draft.fromNote, { done: true }).catch(() => {});
      delete state.drafts[topic.id];
      const t = { id, question: draft.question.trim(), my_thought: draft.thought.trim(), ai_answer: null, reflection: null, created_at: new Date().toISOString(), attachments };
      turns.push(t);
      const $turns = document.getElementById("turns");
      $turns.querySelector(".empty, .chat-start")?.remove();
      turns.slice(0, -1).forEach((x) => foldTurn(x, true));
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
    } catch (err) { toast(err.message); $btn.disabled = false; }
}

function jumpToTurn(turnId) {
  const $t = document.getElementById(`turn-${turnId}`);
  if (!$t) { toast("해당 대화를 찾을 수 없어요."); return; }
  $t.classList.remove("folded");  // 접혀 있던 질문이면 펼쳐서 보여 준다
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
const AREAS = { mine: "내 생각", shared: "겹치는 생각", ai: "AI 생각" };  // 칸 이름 = 범례

// 설명은 화면에 늘어놓지 않고 ⓘ에 마우스를 올리거나 눌렀을 때만 보이게
const tip = (text, label = "설명") => `<button type="button" class="tip-btn" data-tip="${esc(text)}" aria-label="${esc(label)}: ${esc(text)}">i</button>`;

async function renderMapTab($panel, topic, turns, refresh = false) {
  $panel.innerHTML = `
    <div class="map-page">
      <div class="map-bar">
        <div class="legend" aria-label="범례">
          <span class="lg"><i class="lg-box"></i>같은 생각</span>
          <span class="lg"><i class="lg-box similar"></i>비슷한 생각</span>
          ${tip("가운데가 질문이고, 왼쪽 가지는 내 생각, 오른쪽 가지는 AI 생각, 아래로 내려온 가지는 둘이 겹치는 생각이에요. AI가 정리한 결과라 틀릴 수 있으니, 다르면 '직접 고치기'로 바로잡아 주세요. 요점에 마우스를 올리면 설명이 보이고, 누르면 그 대화로 이동해요.", "마인드맵 안내")}
          <span id="map-badges"></span>
        </div>
        <div class="map-tools">
          <span id="map-turn-filter"></span>
          <button class="btn btn-sm" id="map-edit" aria-pressed="false" hidden>직접 고치기</button>
          <div class="more">
            <button class="btn btn-sm btn-ghost more-btn" id="map-more" aria-haspopup="menu" aria-expanded="false" aria-label="더보기" title="더보기">⋯</button>
            <div class="more-menu" id="map-more-menu" role="menu" hidden>
              <button role="menuitem" id="mv-compact" hidden>설명 보이기</button>
              <button role="menuitem" id="map-refresh">AI로 다시 정리</button>
            </div>
          </div>
        </div>
      </div>
      <div id="map-notice"></div>
      <div id="map-ask"></div>
      <div id="map-materials"></div>
      <div id="map-area"><div class="map-loading">대화 전체에서 내 생각과 AI 답의 핵심을 정리하는 중…</div></div>
    </div>`;
  const ctx = { topic, turns, data: null, editing: false, turnNo: Object.fromEntries(turns.map((t, i) => [t.id, i + 1])) };
  const $more = document.getElementById("map-more"), $moreMenu = document.getElementById("map-more-menu");
  const closeMore = () => { $moreMenu.hidden = true; $more.setAttribute("aria-expanded", "false"); };
  $more.onclick = (e) => { e.stopPropagation(); $moreMenu.hidden = !$moreMenu.hidden; $more.setAttribute("aria-expanded", String(!$moreMenu.hidden)); };
  if (!renderMapTab.bound) {  // 바깥을 누르면 ⋯ 메뉴 닫기 (한 번만 등록)
    renderMapTab.bound = true;
    document.addEventListener("click", (e) => {
      if (e.target.closest(".more")) return;
      const m = document.getElementById("map-more-menu");
      if (m) { m.hidden = true; document.getElementById("map-more")?.setAttribute("aria-expanded", "false"); }
    });
  }
  document.getElementById("map-refresh").onclick = async () => {
    closeMore();
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
    document.querySelector(".more").hidden = true;
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
  const items = { mine: data.mine_only, shared: data.shared, ai: data.ai_only };
  const uncertain = data.uncertain || [];
  const jump = (tid) => { location.hash = `#/topic/${topic.id}?turn=${tid}`; };

  // 상태는 짧은 표시로만 (설명은 툴팁)
  document.getElementById("map-badges").innerHTML =
    (data.edited ? `<span class="map-badge" data-tip="AI가 정리한 뒤 직접 고친 마인드맵이에요">직접 고침</span>` : "") +
    (ctx.editing ? `<span class="map-badge on">고치는 중</span>` : "");
  document.getElementById("map-notice").innerHTML = data.stale
    ? `<div class="map-note warn">새 대화가 아직 반영되지 않았어요 ${tip("'⋯ → AI로 다시 정리'를 누르면 새 대화까지 반영돼요. 직접 고친 내용은 사라져요.", "다시 정리 안내")}</div>`
    : "";

  // 첨부 자료 정리: 자료마다 요약, 핵심, 내 생각과의 연결
  const files = Object.fromEntries(turns.flatMap((t) => (t.attachments || []).map((a) => [a.id, a])));
  const materials = (data.materials || []).filter((m) => files[m.attachment_id]);
  const $mat = document.getElementById("map-materials");
  $mat.innerHTML = materials.length ? `
    <section class="map-materials" aria-label="첨부 자료 정리">
      <h3>첨부 자료 <span class="h-count">${materials.length}</span> ${tip("AI가 첨부한 자료를 읽고 요약·핵심·내 생각과의 연결을 정리했어요.", "첨부 자료 안내")}</h3>
      <div class="mat-grid">
        ${materials.map((m) => `
          <article class="mat">
            <header>
              <span class="fc-kind">${fileKindLabel(files[m.attachment_id].filename)}</span>
              <span class="mat-name">${esc(files[m.attachment_id].filename)}</span>
              ${(m.turn_ids || []).map((tid) => `<button class="turn-link" data-jump="${tid}">대화 ${turnNo[tid] ?? "?"}</button>`).join("")}
            </header>
            <p class="mat-sum">${esc(m.summary)}</p>
            ${m.key_points?.length ? `<ul class="mat-points">${m.key_points.map((k) => `<li>${esc(k)}</li>`).join("")}</ul>` : ""}
            ${m.relation ? `<p class="mat-rel"><b>내 생각과의 연결</b> ${esc(m.relation)}</p>` : ""}
          </article>`).join("")}
      </div>
    </section>` : "";
  $mat.onclick = (e) => { const j = e.target.closest("[data-jump]"); if (j) jump(j.dataset.jump); };

  // AI가 애매하다고 한 요점: 사용자에게 묻기
  const $ask = document.getElementById("map-ask");
  $ask.innerHTML = uncertain.length ? `
    <section class="map-ask" aria-label="확인이 필요한 요점">
      <h3>애매한 요점 <span class="h-count">${uncertain.length}</span> ${tip("내 생각과 AI 답이 같은 생각인지 AI가 판단하기 어려웠던 요점이에요. 직접 골라 주면 마인드맵에 반영돼요.", "애매한 요점 안내")}</h3>
      ${uncertain.map((u, i) => `
        <div class="ask-item">
          <div class="ask-pair">
            <span class="ask-side mine">${esc(u.mine_label)}</span><span class="ask-vs">와</span>
            <span class="ask-side ai">${esc(u.ai_label)}</span>
            ${u.turn_ids.map((tid) => `<button class="turn-link" data-jump="${tid}" title="그 대화로 이동">대화 ${turnNo[tid] ?? "?"}</button>`).join("")}
          </div>
          <div class="ask-btns">
            <button class="btn btn-sm" data-resolve="same" data-i="${i}">같은 생각</button>
            <button class="btn btn-sm" data-resolve="similar" data-i="${i}">비슷한 생각</button>
            <button class="btn btn-sm" data-resolve="different" data-i="${i}">다른 생각</button>
          </div>
        </div>`).join("")}
    </section>` : "";
  $ask.onclick = async (e) => {
    const j = e.target.closest("[data-jump]");
    if (j) { jump(j.dataset.jump); return; }
    const b = e.target.closest("[data-resolve]");
    if (!b) return;
    const next = cloneMap(data);
    const [u] = next.uncertain.splice(Number(b.dataset.i), 1);
    if (b.dataset.resolve === "different") {
      // 서로 다른 생각 → 각자의 칸에 둔다
      if (!next.mine_only.some((p) => p.label === u.mine_label)) next.mine_only.push({ label: u.mine_label, detail: "", turn_ids: u.turn_ids });
      if (!next.ai_only.some((p) => p.label === u.ai_label)) next.ai_only.push({ label: u.ai_label, detail: "", turn_ids: u.turn_ids });
    } else {
      // 같은·비슷한 생각 → 가운데로 모은다
      next.mine_only = next.mine_only.filter((p) => p.label !== u.mine_label);
      next.ai_only = next.ai_only.filter((p) => p.label !== u.ai_label);
      next.shared.push({
        label: u.shared_label || u.mine_label, kind: b.dataset.resolve,
        detail: `내 생각 '${u.mine_label}'과 AI의 '${u.ai_label}'`,
        turn_ids: u.turn_ids,
      });
    }
    if (await saveMap(ctx, next)) toast("마인드맵에 반영했어요");
  };

  // ---- 질문별로 묶기: 요점은 처음 나온 대화 아래에 둔다 ----
  const groups = new Map(turns.map((t) => [t.id, { turn: t, mine: [], shared: [], ai: [] }]));
  const manual = { turn: null, mine: [], shared: [], ai: [] };
  for (const side of ["mine", "shared", "ai"]) {
    items[side].forEach((p, i) => {
      const g = groups.get(p.turn_ids[0]) || manual;
      g[side].push({ p, i });
    });
  }
  const filled = (g) => g.mine.length + g.shared.length + g.ai.length > 0;
  const rows = [...groups.values()].filter(filled);
  if (filled(manual) || ctx.editing) rows.push(manual);

  const view = loadMapView(topic.id);
  if (view.turns && view.turns.length !== 1) view.turns = null;
  const usedTurns = rows.filter((g) => g.turn).map((g) => g.turn);
  document.getElementById("map-turn-filter").innerHTML = usedTurns.length > 1 ? `
    <select class="map-select" id="map-turn" aria-label="대화 고르기">
      <option value="all">모든 질문</option>
      ${usedTurns.map((t) => `<option value="${t.id}">대화 ${turnNo[t.id]}</option>`).join("")}
    </select>` : "";

  const ptTip = (side, p) => {
    if (ctx.editing) return "눌러서 고치기";
    const kind = side === "shared" ? (p.kind === "similar" ? "비슷한 생각" : "같은 생각") : "";
    const more = p.turn_ids.length > 1 ? `대화 ${p.turn_ids.map((t) => turnNo[t] ?? "?").join(", ")}에서 나옴` : "";
    return [p.detail, [kind, more].filter(Boolean).join(" · ")].filter(Boolean).join("\n");
  };
  // 요점 = 가지 끝에 얹힌 글자 (카드 아님). 설명은 툴팁, ⋯에서 '설명 보이기'를 고르면 아래에 작게
  const point = (side, { p, i }) => `
    <button class="mm-node ${side} ${p.kind || ""}" data-side="${side}" data-i="${i}" ${p.turn_ids.length ? `data-turn="${p.turn_ids[0]}"` : ""} ${ptTip(side, p) ? `data-tip="${esc(ptTip(side, p))}"` : ""}>
      <span class="mm-label">${esc(shortLinks(p.label))}</span>
      ${p.detail ? `<span class="mm-detail">${esc(p.detail)}</span>` : ""}
    </button>`;
  const add = (side, g) => ctx.editing ? `<button class="mm-add" data-add="${side}" data-turns="${g.turn ? g.turn.id : ""}">+ 추가</button>` : "";

  document.getElementById("map-area").innerHTML = `
    <div class="mm ${ctx.editing ? "editing" : ""}" id="cmap">
      <svg class="mm-lines" aria-hidden="true"></svg>
      <div class="mm-head" aria-hidden="true"><span class="mine">${AREAS.mine}</span><span></span><span class="ai">${AREAS.ai}</span></div>
      ${rows.map((g) => `
        <section class="mm-row" data-row="${g.turn ? g.turn.id : "manual"}">
          <div class="mm-col mine" data-col="${AREAS.mine}">${g.mine.map((x) => point("mine", x)).join("")}${add("mine", g)}</div>
          <div class="mm-center">
            ${g.turn
              ? `<button class="mm-q" data-turn="${g.turn.id}" title="${esc(g.turn.question)}"><span class="mm-qno">${turnNo[g.turn.id]}</span><span class="mm-qtext">${esc(shortLinks(g.turn.question))}</span></button>`
              : `<div class="mm-q manual">직접 추가한 요점</div>`}
            <div class="mm-shared" data-col="${AREAS.shared}">${g.shared.map((x) => point("shared", x)).join("")}${add("shared", g)}</div>
          </div>
          <div class="mm-col ai" data-col="${AREAS.ai}">${g.ai.map((x) => point("ai", x)).join("")}${add("ai", g)}</div>
        </section>`).join("")}
    </div>`;

  const $map = document.getElementById("cmap");
  const redraw = () => drawMindLines($map);
  ctx.redraw = redraw;
  const apply = () => {
    const sel = view.turns ? String(view.turns[0]) : null;
    $map.querySelectorAll(".mm-row").forEach((r) => { r.hidden = !!sel && r.dataset.row !== sel; });
    const $turnSel = document.getElementById("map-turn");
    if ($turnSel) $turnSel.value = sel || "all";
    $map.classList.toggle("show-detail", !!view.showDetail || ctx.editing);
    const $detail = document.getElementById("mv-compact");
    $detail.hidden = false;
    $detail.textContent = view.showDetail ? "설명 숨기기" : "설명 보이기";
    saveMapView(topic.id, view);
    redraw();
  };
  ctx.apply = apply;
  const $turnSel = document.getElementById("map-turn");
  if ($turnSel) $turnSel.onchange = () => { view.turns = $turnSel.value === "all" ? null : [Number($turnSel.value)]; apply(); };
  document.getElementById("mv-compact").onclick = () => {
    view.showDetail = !view.showDetail;
    document.getElementById("map-more-menu").hidden = true;
    apply();
  };

  $map.addEventListener("click", (e) => {
    if (e.target.closest(".node-editor")) return;
    if (ctx.editing) {
      // 고치기 모드: 요점을 누르면 편집, '+ 추가'로 그 질문에 새 요점
      const addBtn = e.target.closest("[data-add]");
      if (addBtn) { openNodeEditor(ctx, addBtn, addBtn.dataset.add, -1, addBtn.dataset.turns ? [Number(addBtn.dataset.turns)] : []); return; }
      const n = e.target.closest(".mm-node");
      if (n) openNodeEditor(ctx, n, n.dataset.side, Number(n.dataset.i));
      return;
    }
    const target = e.target.closest("[data-turn]");
    if (target) jump(target.dataset.turn);
  });
  // 요점에 마우스를 올리면 그 가지만 진하게
  $map.addEventListener("mouseover", (e) => {
    const n = e.target.closest(".mm-node");
    $map.querySelectorAll(".mm-lines path.hl").forEach((x) => x.classList.remove("hl"));
    if (n) $map.querySelector(`.mm-lines path[data-for="${n.dataset.side}-${n.dataset.i}"]`)?.classList.add("hl");
  });
  apply();
  if (resizeObs) resizeObs.disconnect();
  resizeObs = new ResizeObserver(redraw);
  resizeObs.observe($map);
}

// 가지 그리기: 질문 마디에서 왼쪽(내 생각)·오른쪽(AI 생각)·아래(겹치는 생각)로 곡선.
// 왼쪽·오른쪽 요점은 글자 밑줄 끝에 가지가 닿아, 글자가 가지 위에 얹힌 모양이 된다.
// 좁은 화면에서는 질문 아래로 내려가는 줄기에서 갈라지는 나무 모양.
function drawMindLines($map) {
  const svg = $map?.querySelector(".mm-lines");
  if (!svg) return;
  const base = $map.getBoundingClientRect();
  const B = (el) => {
    const r = el.getBoundingClientRect();
    return { l: r.left - base.left, r: r.right - base.left, t: r.top - base.top, b: r.bottom - base.top,
             cx: r.left - base.left + r.width / 2, cy: r.top - base.top + r.height / 2 };
  };
  svg.setAttribute("width", base.width);
  svg.setAttribute("height", base.height);
  const narrow = window.matchMedia("(max-width: 760px)").matches;
  let d = "";
  $map.querySelectorAll(".mm-row:not([hidden])").forEach((row) => {
    const q = B(row.querySelector(".mm-q"));
    row.querySelectorAll(".mm-node:not(.editing-hidden)").forEach((n) => {
      const b = B(n), side = n.dataset.side, key = `${side}-${n.dataset.i}`;
      const cls = `l-${side}${n.classList.contains("similar") ? " similar" : ""}`;
      let path;
      if (narrow) {
        const x = q.l + 12, y = side === "shared" ? b.cy : b.b, r = 8;
        path = `M${x},${q.b} L${x},${y - r} Q${x},${y} ${x + r},${y} L${b.l},${y}`;
      } else if (side === "mine") {
        const k = Math.max(24, (q.l - b.r) / 2);
        path = `M${q.l},${q.cy} C${q.l - k},${q.cy} ${b.r + k},${b.b} ${b.r},${b.b}`;
      } else if (side === "ai") {
        const k = Math.max(24, (b.l - q.r) / 2);
        path = `M${q.r},${q.cy} C${q.r + k},${q.cy} ${b.l - k},${b.b} ${b.l},${b.b}`;
      } else {
        const m = (q.b + b.t) / 2;
        path = `M${q.cx},${q.b} C${q.cx},${m} ${b.cx},${m} ${b.cx},${b.t}`;
      }
      d += `<path class="${cls}" data-for="${key}" d="${path}"/>`;
    });
  });
  svg.innerHTML = d;
}

// 요점 하나를 고치는 칸: 이름·설명·영역(내 생각만/겹치는 생각/AI만)·같음/비슷함, 삭제
function openNodeEditor(ctx, $anchor, side, index, turnIds = []) {
  document.querySelectorAll(".node-editor").forEach((f) => f.remove());
  document.querySelectorAll(".node.editing-hidden").forEach((n) => n.classList.remove("editing-hidden"));
  const isNew = index < 0;
  const p = isNew ? { label: "", detail: "", kind: "same", turn_ids: turnIds } : ctx.data[MM_KEYS[side]][index];
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
  ctx.redraw?.();
}

// 마인드맵 보기 설정은 주제마다 이 브라우저에 기억해 둔다 (없거나 못 읽어도 기본값으로 동작)
function loadMapView(topicId) {
  const base = { hidden: [], turns: null, showDetail: false };
  try {
    const saved = JSON.parse(localStorage.getItem(`tf-map-view-${topicId}`) || "null");
    return saved ? { ...base, ...saved } : base;
  } catch { return base; }
}
function saveMapView(topicId, view) {
  try { localStorage.setItem(`tf-map-view-${topicId}`, JSON.stringify(view)); } catch { /* 저장 못 해도 괜찮음 */ }
}

// ---------- 로그인 · 회원가입 (브랜드 소개와 함께) ----------
// 누구를 위한 앱인지, 왜 만들었는지를 로그인 화면 왼쪽에 보여 준다
function brandPanel() {
  return `
    <section class="brand">
      <div class="brand-logo">${LOGO}</div>
      <h1 class="brand-title">비포블랭크</h1>
      <p class="brand-en">Before Blank</p>

      <div class="brand-block">
        <h2>이런 분을 위한 노트예요</h2>
        <ul class="brand-list">
          <li>AI 답을 읽고 나면, 원래 하던 생각이 떠오르지 않는 분</li>
          <li>AI에게 묻기는 하지만, 내 생각은 잘 정리되지 않는 분</li>
          <li>어느새 AI의 말을 그대로 따라가고 있다고 느낀 분</li>
        </ul>
      </div>

      <ol class="brand-steps">
        <li><span class="step-num">01</span><div><b>질문을 적어요</b><p>AI에게 물어보고 싶은 걸 먼저 적어요.</p></div></li>
        <li><span class="step-num">02</span><div><b>내 생각을 먼저 써요</b><p>내 생각을 적어야 AI 답이 열려요. 내 생각은 AI에게 보내지 않아요.</p></div></li>
        <li><span class="step-num">03</span><div><b>곁가지는 메모함에</b><p>AI 답에서 확인할 것, 할 일, 마음에 드는 아이디어는 드래그해서 담아 두고, 대화는 원래 주제로 이어 가요.</p></div></li>
        <li><span class="step-num">04</span><div><b>마인드맵으로 정리돼요</b><p>나만의 관점, 겹치는 생각, AI만의 관점이 나뉘고, 누르면 그 대화로 이동해요.</p></div></li>
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
      ${field("invite_code", "초대 코드 (선택)", `<input type="text" id="invite_code" autocomplete="off" maxlength="64">`, "받은 초대 코드가 있으면 AI 답을 바로 쓸 수 있어요. 나중에 설정에서 넣어도 돼요.")}
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
      invite_code: $f.invite_code.value.trim(),
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
  if (path === "/settings") return viewSettings();
  if (path === "/stats") return viewStats(qs.get("owner") === "1");
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
