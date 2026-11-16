// 생각 먼저 — 프론트엔드 (프레임워크 없이 해시 라우팅)
//   #/                       홈: 주제 목록
//   #/new                    새 주제 시작
//   #/topic/:id              주제 > 대화 탭  (?turn=ID 로 특정 대화 위치로 이동)
//   #/topic/:id/map          주제 > 마인드맵 탭
const $app = document.getElementById("app");
const cfg = { min_thought: 20, demo: false };
const state = {
  q: "",              // 홈 검색어
  filter: "all",      // all | starred | in_progress | done
  drafts: {},         // 주제별 작성 중인 질문/생각 (탭을 오가도 유지)
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
const themeToggle = () =>
  `<button class="theme-toggle" data-theme-toggle title="화면 밝기 바꾸기">${currentTheme() === "dark" ? "밝게" : "어둡게"}</button>`;
document.addEventListener("click", (e) => {
  if (!e.target.closest("[data-theme-toggle]")) return;
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("tf-theme", next); } catch { /* 기억 못 해도 괜찮음 */ }
  document.querySelectorAll("[data-theme-toggle]").forEach((b) => (b.textContent = next === "dark" ? "밝게" : "어둡게"));
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
    $counter.textContent = n >= cfg.min_thought ? `${n}자 · 준비됐어요` : `${n} / ${cfg.min_thought}자 이상`;
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
      <div class="home-top">${themeToggle()}</div>
      <header class="home-hero">
        <div class="mascot">${mascot}</div>
        <h1>주제</h1>
        <p>묻기 전에, 내 생각부터 ${cfg.demo ? `<span class="demo-pill">데모 모드</span>` : ""}</p>
      </header>
      <div class="toolbar">
        <input type="search" id="search" placeholder="주제·질문·생각·답 검색" value="${esc(state.q)}">
        <a class="btn btn-primary" href="#/new">+ 새 주제</a>
      </div>
      <div class="filters" id="filters"></div>
      <ul class="topic-rows" id="topic-rows"></ul>
    </div>`;

  let timer;
  document.getElementById("search").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.q = e.target.value.trim(); loadTopicRows(); }, 250);
  });
  await loadTopicRows();
}

async function loadTopicRows() {
  const all = await api(`/api/topics?${new URLSearchParams({ q: state.q })}`);
  const $rows = document.getElementById("topic-rows");
  if (!$rows) return;
  const counts = {
    all: all.length,
    starred: all.filter((t) => t.is_starred).length,
    in_progress: all.filter((t) => t.status === "in_progress").length,
    done: all.filter((t) => t.status === "done").length,
  };
  const pass = {
    all: () => true, starred: (t) => t.is_starred,
    in_progress: (t) => t.status === "in_progress", done: (t) => t.status === "done",
  }[state.filter];
  const list = all.filter(pass);

  const chip = (k, label) => `<button class="filter ${state.filter === k ? "active" : ""}" data-f="${k}">${label} <span>${counts[k]}</span></button>`;
  document.getElementById("filters").innerHTML =
    chip("all", "전체") + chip("starred", "★ 중요") + chip("in_progress", "진행중") + chip("done", "완료");
  document.querySelectorAll(".filter").forEach((b) => (b.onclick = () => { state.filter = b.dataset.f; loadTopicRows(); }));

  if (!list.length) {
    $rows.innerHTML = `<li class="empty">${
      state.q ? "찾는 주제가 없어요."
      : all.length ? { starred: "중요 표시한 주제가 없어요. ☆을 눌러 중요한 주제를 모아 보세요.", in_progress: "진행중인 주제가 없어요.", done: "아직 완료한 주제가 없어요." }[state.filter]
      : "아직 주제가 없어요.<br>궁금한 게 생겼다면, AI에게 묻기 전에 내 생각부터 적어 보세요."}</li>`;
    return;
  }
  $rows.innerHTML = list.map((t) => `
    <li class="topic-row ${t.status}" data-id="${t.id}">
      ${starBtn(t.is_starred, t.name)}
      <a class="topic-link" href="#/topic/${t.id}">
        <div class="topic-main">
          <div class="topic-name">${esc(t.name)}</div>
          <div class="topic-meta">대화 ${t.turn_count}개 · ${fmtDate(t.updated_at, false)}${t.last_question ? ` · ${esc(t.last_question)}` : ""}</div>
        </div>
        ${statusBadge(t.status)}
        <span class="chev" aria-hidden="true">→</span>
      </a>
    </li>`).join("");

  $rows.querySelectorAll("[data-star]").forEach((b) => {
    b.onclick = async () => {
      const id = b.closest(".topic-row").dataset.id;
      const on = b.getAttribute("aria-pressed") !== "true";
      try { await api(`/api/topics/${id}`, { method: "PATCH", body: { is_starred: on } }); loadTopicRows(); }
      catch (err) { toast(err.message); }
    };
  });
}

// ---------- 새 주제 ----------
function viewNewTopic() {
  $app.innerHTML = `
    <div class="narrow">
      <a class="back" href="#/">← 주제 목록</a>
      <h1 class="page-title">새 주제</h1>
      <p class="page-sub">AI의 답을 보기 전에, 내 생각을 먼저 붙잡아 두세요.</p>

      <section class="step">
        <div class="step-label"><span class="step-num">01</span> 주제 이름</div>
        <input type="text" id="topic-name" maxlength="40" placeholder="예: 데이터 분석 포트폴리오, 공부법">
      </section>
      <section class="step locked" id="step2">
        <div class="step-label"><span class="step-num">02</span> 무엇이 궁금한가요?</div>
        <textarea id="question" placeholder="AI에게 물어보고 싶은 첫 질문을 적어 주세요."></textarea>
      </section>
      <section class="step locked" id="step3">
        <div class="step-label"><span class="step-num">03</span> 내 생각을 먼저 적어 보세요</div>
        <p class="hint">정답이 아니어도 괜찮아요. 지금 떠오르는 생각, 근거, 헷갈리는 점을 적어 두면 AI 답을 본 뒤에도 내 생각을 잃지 않아요.</p>
        ${promptButtons()}
        <textarea id="thought" class="thought" placeholder="내 생각은…"></textarea>
        <div class="actions">
          <span class="counter" id="counter"></span>
          <button class="btn btn-primary" id="submit" disabled>주제 만들고 AI 답 보기 →</button>
        </div>
      </section>
    </div>`;

  const $name = document.getElementById("topic-name");
  const $q = document.getElementById("question");
  const $t = document.getElementById("thought");
  const $submit = document.getElementById("submit");
  const update = () => {
    document.getElementById("step2").classList.toggle("locked", !$name.value.trim());
    document.getElementById("step3").classList.toggle("locked", !($name.value.trim() && $q.value.trim()));
    $submit.disabled = !($name.value.trim() && $q.value.trim() && $t.value.trim().length >= cfg.min_thought);
  };
  $name.oninput = update;
  $q.oninput = update;
  bindThought($t, document.getElementById("counter"), update);

  $submit.onclick = async () => {
    $submit.disabled = true;
    try {
      const { id } = await api("/api/topics", { method: "POST", body: { name: $name.value.trim() } });
      const turn = await api(`/api/topics/${id}/turns`, { method: "POST", body: { question: $q.value.trim(), my_thought: $t.value.trim() } });
      location.hash = `#/topic/${id}?ask=${turn.id}`;
    } catch (err) { toast(err.message); $submit.disabled = false; }
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
            ${themeToggle()}
            <button class="btn btn-ghost danger btn-sm" id="del-topic" title="주제 삭제">삭제</button>
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
    const name = prompt("주제 이름 바꾸기", topic.name);
    if (!name || name.trim() === topic.name) return;
    try { await api(`/api/topics/${id}`, { method: "PATCH", body: { name: name.trim() } }); route(); }
    catch (err) { toast(err.message); }
  };
  // 삭제
  document.getElementById("del-topic").onclick = async () => {
    if (!confirm(`'${topic.name}' 주제와 대화 ${turns.length}개, 생각 메모를 모두 삭제할까요? 되돌릴 수 없어요.`)) return;
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
      <div id="turns">${turns.length ? turns.map((t, i) => turnHTML(t, i + 1)).join("") : `<div class="empty">아직 대화가 없어요. 아래에서 첫 질문을 시작해 보세요.</div>`}</div>
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
  else window.scrollTo(0, document.body.scrollHeight);
}

function bindTurn(t) {
  const $turn = document.getElementById(`turn-${t.id}`);
  const $ask = $turn.querySelector("[data-ask]");
  if ($ask) $ask.onclick = () => streamAnswer(t);
  $turn.querySelector("[data-del-turn]").onclick = async () => {
    if (!confirm("이 대화(질문·내 생각·AI 답·생각 메모)를 삭제할까요? 되돌릴 수 없어요.")) return;
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
    const res = await fetch(`/api/turns/${t.id}/answer`, { method: "POST" });
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
function renderComposer(topic, turns) {
  const $c = document.getElementById("composer");
  const draft = (state.drafts[topic.id] ||= { step: 1, question: "", thought: "" });

  if (draft.step === 1) {
    $c.innerHTML = `
      <div class="composer-box">
        <textarea id="c-question" rows="2" placeholder="${turns.length ? "이어서 물어볼 질문을 적어 주세요" : "첫 질문을 적어 주세요"}">${esc(draft.question)}</textarea>
        <div class="actions" style="margin-top:4px">
          <span class="counter composer-hint">질문을 적은 뒤, AI에게 보내기 전에 내 생각을 먼저 적어요</span><span></span>
          <button class="btn btn-primary btn-sm" id="c-next" ${draft.question.trim() ? "" : "disabled"}>다음: 내 생각 적기 →</button>
        </div>
      </div>`;
    const $q = document.getElementById("c-question");
    const $next = document.getElementById("c-next");
    $q.oninput = () => { draft.question = $q.value; $next.disabled = !$q.value.trim(); };
    $q.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && $q.value.trim()) { e.preventDefault(); $next.click(); } };
    $next.onclick = () => { draft.step = 2; renderComposer(topic, turns); document.getElementById("c-thought").focus(); };
    return;
  }

  $c.innerHTML = `
    <div class="composer-box">
      <div class="composer-q">Q. ${esc(draft.question)}</div>
      <div class="composer-label">내 생각을 먼저 적어 보세요</div>
      ${promptButtons()}
      <textarea id="c-thought" class="thought" placeholder="내 생각은…">${esc(draft.thought)}</textarea>
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
      delete state.drafts[topic.id];
      const t = { id, question: draft.question.trim(), my_thought: draft.thought.trim(), ai_answer: null, reflection: null, created_at: new Date().toISOString() };
      turns.push(t);
      const $turns = document.getElementById("turns");
      $turns.querySelector(".empty")?.remove();
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
async function renderMapTab($panel, topic, turns, refresh = false) {
  const turnNo = Object.fromEntries(turns.map((t, i) => [t.id, i + 1]));
  $panel.innerHTML = `
    <div class="map-page">
      <div class="map-bar">
        <p id="map-summary">내 생각과 AI 답의 핵심을 모아, 겹치는 생각은 가운데로 모았어요.</p>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <span class="legend"><i></i>같은 생각 <i class="similar"></i>비슷한 생각</span>
          <button class="btn btn-sm" id="map-refresh">다시 정리</button>
        </div>
      </div>
      <div id="map-area"><div class="map-loading">대화 전체에서 내 생각과 AI 답의 핵심을 정리하는 중…</div></div>
    </div>`;
  document.getElementById("map-refresh").onclick = () => renderMapTab($panel, topic, turns, true);

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

  const { mine_only: mine, shared, ai_only: ai } = data;
  document.getElementById("map-summary").textContent =
    `겹치는 생각 ${shared.length}개 · 나만의 관점 ${mine.length}개 · AI의 새로운 관점 ${ai.length}개 — 요점을 누르면 그 대화로 이동해요`;

  const AREAS = { mine: "내 생각", shared: "겹치는 생각", ai: "AI 생각" };
  const items = { mine, shared, ai };
  const usedTurns = turns.filter((t) => [...mine, ...shared, ...ai].some((p) => p.turn_ids.includes(t.id)));
  const view = loadMapView(topic.id);

  const node = (side, p, i) => `
    <button class="node ${side} ${p.kind || ""}" data-side="${side}" data-i="${i}" data-turn="${p.turn_ids[0]}" data-turns="${p.turn_ids.join(",")}">
      <span class="node-label">${esc(p.label)}${side === "shared" ? `<span class="node-kind">${p.kind === "same" ? "같음" : "비슷함"}</span>` : ""}</span>
      <span class="node-detail">${esc(p.detail)}</span>
      <span class="node-turns">${p.turn_ids.map((tid) => `<span class="turn-chip" data-turn="${tid}">대화 ${turnNo[tid] ?? "?"}</span>`).join("")}</span>
    </button>`;
  const column = (side) => `
    <div class="cmap-col ${side}" data-area="${side}">
      <button class="cmap-head ${side}" data-toggle-area="${side}" aria-expanded="true">
        <span>${AREAS[side]}</span> <span class="head-count"></span> <span class="caret">▾</span>
      </button>
      ${items[side].map((p, i) => node(side, p, i)).join("")}
      <div class="cmap-empty-col ${side}" data-empty></div>
    </div>`;

  $area.innerHTML = `
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
    <div class="cmap" id="cmap">
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
        const show = !collapsed && turnOk(n);
        n.hidden = !show;
        if (show) visible++;
      });
      const total = items[side].length;
      const matched = [...$col.querySelectorAll(".node")].filter(turnOk).length;
      $col.classList.toggle("collapsed", collapsed);
      $col.querySelector(".head-count").textContent = matched;
      $col.querySelector(".caret").textContent = collapsed ? "▸" : "▾";
      $col.querySelector("[data-toggle-area]").setAttribute("aria-expanded", String(!collapsed));
      $col.querySelector("[data-toggle-area]").title = collapsed ? "눌러서 펼치기" : "눌러서 접기";
      const $empty = $col.querySelector("[data-empty]");
      $empty.textContent = collapsed ? `접어 둠 · ${matched}개`
        : visible ? ""
        : total ? "고른 대화에는 없어요"
        : { mine: "나만의 관점이 없어요", shared: "겹치는 생각이 없어요", ai: "AI만의 관점이 없어요" }[side];
      $empty.hidden = !$empty.textContent;
      $grid.style.setProperty(`--c-${side}`, collapsed ? "max-content" : side === "shared" ? "minmax(0, 1.05fr)" : "minmax(0, 1fr)");
      const chip = document.querySelector(`[data-area-chip="${side}"]`);
      chip.setAttribute("aria-pressed", String(!collapsed));
    }
    document.querySelectorAll("[data-turn-chip]").forEach((c) => {
      const on = c.dataset.turnChip === "all" ? !view.turns : !!view.turns?.includes(Number(c.dataset.turnChip));
      c.setAttribute("aria-pressed", String(on));
    });
    $map.classList.toggle("compact", view.compact);
    const $compact = document.getElementById("mv-compact");
    $compact.setAttribute("aria-pressed", String(view.compact));
    $compact.textContent = view.compact ? "요약 펼치기" : "요약 접기";
    saveMapView(topic.id, view);
    drawMapLines($map);
  };

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
    // 영역 머리를 누르면 그 영역을 접고 펼친다
    const head = e.target.closest("[data-toggle-area]");
    if (head) { toggleArea(head.dataset.toggleArea); return; }
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
  $map.querySelectorAll(".node.mine:not([hidden])").forEach((n) => {
    const b = box(n), x = hm.l + 14;
    d += `<path class="b-mine" d="M${x},${hm.b} C${x},${b.cy} ${x},${b.cy} ${b.l},${b.cy}"/>`;
  });
  // AI 생각 → AI만의 관점 (오른쪽 가장자리)
  $map.querySelectorAll(".node.ai:not([hidden])").forEach((n) => {
    const b = box(n), x = ha.r - 14;
    d += `<path class="b-ai" d="M${x},${ha.b} C${x},${b.cy} ${x},${b.cy} ${b.r},${b.cy}"/>`;
  });
  // 양쪽 머리에서 가운데 겹치는 생각으로 모이는 선:
  // 머리 높이로 칸 사이 빈 공간까지 간 뒤, 그 공간을 따라 내려가 가운데 요점에 닿는다 (요점 카드를 가로지르지 않게)
  const colMine = box($map.querySelector(".cmap-col.mine"));
  const colShared = box($map.querySelector(".cmap-col.shared"));
  const colAi = box($map.querySelector(".cmap-col.ai"));
  const gl = (colMine.r + colShared.l) / 2, gr = (colShared.r + colAi.l) / 2, rr = 12;
  $map.querySelectorAll(".node.shared:not([hidden])").forEach((n) => {
    const b = box(n), kind = n.classList.contains("similar") ? "similar" : "same", i = n.dataset.i;
    d += `<path class="b-shared ${kind}" data-shared="${i}" d="M${hm.r},${hm.cy} L${gl - rr},${hm.cy} Q${gl},${hm.cy} ${gl},${hm.cy + rr} L${gl},${b.cy - rr} Q${gl},${b.cy} ${gl + rr},${b.cy} L${b.l},${b.cy}"/>`;
    d += `<path class="b-shared ${kind}" data-shared="${i}" d="M${ha.l},${ha.cy} L${gr + rr},${ha.cy} Q${gr},${ha.cy} ${gr},${ha.cy + rr} L${gr},${b.cy - rr} Q${gr},${b.cy} ${gr - rr},${b.cy} L${b.r},${b.cy}"/>`;
  });
  svg.innerHTML = d;
}

// ---------- 라우터 ----------
async function route() {
  if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
  const [path, query] = location.hash.replace(/^#/, "").split("?");
  const qs = new URLSearchParams(query || "");
  let m;
  if (path === "/new") viewNewTopic();
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
