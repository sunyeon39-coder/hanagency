/* =========================================================
   Box Board v1.4.1 - app.js (FULL)
   - Boards Tabs + Reorder + Delete Rule A + Box Resize
   - ✅ Snap to Grid (Alt = temporary disable)
   - ✅ Search: auto switch board + highlight box + center scroll
========================================================= */

/* =========================================================
   Data model
========================================================= */
const state = {
  people: [],                  // 공용
  boards: [],                  // 보드별 박스/레이아웃
  activeBoardId: null,
  selectedBoxIds: new Set(),   // active board 기준
  zoom: 1,
  listCollapsed: false,
  wmOpacity: 0.18,
  wmScale: 1.0,

  // ✅ NEW: Snap/Grid + Search
  snapEnabled: true,
  gridSize: 16,
  search: { query: "", matches: [], idx: -1 },
};

const COLORS = [
  "#2b325a","#233a6b","#274e6e","#1f5a52","#2f5c3b","#4b5b2a","#6b4c23","#6b2b2b",
  "#3a2b6b","#5a2b6b","#6b2b4f","#6b2b33","#2b6b66","#2b6b3d","#4a6b2b","#6b6a2b"
];

const DRAG_MIME = "application/x-boxboard-person";

const DEFAULT_TEXT = {
  titleSize: 34,
  titleColor: "#ffffff",
  headerTimeSize: 12,
  headerTimeColor: "#a9b0d6",
  nameSize: 16,
  nameColor: "#e9ecff",
  seatTimeSize: 14,
  seatTimeColor: "#dbe0ff",
};

/* ✅ 박스 기본 크기(사용자 요청: 좀 줄임) */
const DEFAULT_BOX_W = 190;
const DEFAULT_BOX_H = 130;

/* resize constraints */
const MIN_W = 160, MIN_H = 110;
const MAX_W = 520, MAX_H = 380;

/* =========================================================
   Helpers
========================================================= */
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(2);

function now(){ return Date.now(); }

function fmtElapsed(ms){
  const s = Math.max(0, Math.floor(ms/1000));
  const hh = String(Math.floor(s/3600)).padStart(2,'0');
  const mm = String(Math.floor((s%3600)/60)).padStart(2,'0');
  const ss = String(s%60).padStart(2,'0');
  return `${hh}:${mm}:${ss}`;
}

function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function hexToRgba(hex, a){
  const h = hex.replace("#","");
  const r = parseInt(h.slice(0,2),16);
  const g = parseInt(h.slice(2,4),16);
  const b = parseInt(h.slice(4,6),16);
  return `rgba(${r},${g},${b},${a})`;
}

function ensureBoxText(box){
  if (!box.text) box.text = {};
  for (const k of Object.keys(DEFAULT_TEXT)){
    if (box.text[k] == null) box.text[k] = DEFAULT_TEXT[k];
  }
}

function getDraggedPersonId(e){
  return e.dataTransfer?.getData(DRAG_MIME) || e.dataTransfer?.getData("text/plain") || "";
}

function getActiveBoard(){
  return state.boards.find(b => b.id === state.activeBoardId) || state.boards[0] || null;
}
function getBoxes(){
  const board = getActiveBoard();
  return board ? board.boxes : [];
}
function setActiveBoard(boardId){
  const exists = state.boards.some(b=>b.id===boardId);
  if (!exists) return;
  state.activeBoardId = boardId;
  state.selectedBoxIds.clear();
  renderBoardsBar();
  renderAll();
}

/* ✅ 줌 70% 이하부터 워터마크 더 진하게 */
function computeWmOpacity(zoom){
  const zStart = 0.70;
  const zEnd   = 0.50;
  const opMin  = 0.18;
  const opMax  = 0.42;
  if (zoom >= zStart) return opMin;
  if (zoom <= zEnd) return opMax;
  const t = (zStart - zoom) / (zStart - zEnd);
  return opMin + (opMax - opMin) * t;
}

/* ✅ 줌 70% 이하부터 워터마크 더 크게(최대 1.35배) */
function computeWmScale(zoom){
  const zStart = 0.70;
  const zEnd   = 0.50;
  const sMin   = 1.00;
  const sMax   = 1.35;
  if (zoom >= zStart) return sMin;
  if (zoom <= zEnd) return sMax;
  const t = (zStart - zoom) / (zStart - zEnd);
  return sMin + (sMax - sMin) * t;
}

/* =========================================================
   ✅ Snap/Grid helpers
========================================================= */
function snapVal(v, g){ return Math.round(v / g) * g; }
function snapBoxXY(box){
  const g = state.gridSize;
  box.x = snapVal(box.x, g);
  box.y = snapVal(box.y, g);
}
function snapBoxWH(box){
  const g = state.gridSize;
  box.w = snapVal(box.w, g);
  box.h = snapVal(box.h, g);
}
function applyGridUI(){
  const vp = $("#boardViewport");
  if (!vp) return;
  vp.style.setProperty("--grid", `${state.gridSize}px`);
  vp.classList.toggle("grid-on", !!state.snapEnabled);

  const btn = $("#btnSnapToggle");
  if (btn) btn.textContent = `스냅: ${state.snapEnabled ? "ON" : "OFF"}`;

  const sel = $("#gridSizeSelect");
  if (sel) sel.value = String(state.gridSize);
}

/* =========================================================
   Canvas size
========================================================= */
function resizeBoardCanvas(){
  const viewport = $("#boardViewport");
  const canvas = $("#boardCanvas");
  if (!viewport || !canvas) return;

  const pad = 36;
  let maxX = 0, maxY = 0;

  getBoxes().forEach(b=>{
    const w = b.w ?? DEFAULT_BOX_W;
    const h = b.h ?? DEFAULT_BOX_H;
    maxX = Math.max(maxX, b.x + w);
    maxY = Math.max(maxY, b.y + h);
  });

  const contentW = Math.max(400, maxX + pad);
  const contentH = Math.max(300, maxY + pad);

  const viewW = Math.ceil(viewport.clientWidth / state.zoom);
  const viewH = Math.ceil(viewport.clientHeight / state.zoom);

  canvas.style.width  = Math.max(contentW, viewW) + "px";
  canvas.style.height = Math.max(contentH, viewH) + "px";
}

/* =========================================================
   Person 상태 전환
========================================================= */
function toWaiting(p){
  p.status = "waiting";
  p.boardId = null;
  p.boxId = null;
  p.waitStartedAt = now();
  p.assignedStartedAt = null;
}
function toAssigned(p, boardId, boxId){
  p.status = "assigned";
  p.boardId = boardId;
  p.boxId = boxId;
  p.assignedStartedAt = now();
}

/* =========================================================
   Init
========================================================= */
function init(){
  // 보드가 없으면 기본 보드 1개 + 박스 6개
  if (state.boards.length === 0){
    const boardId = uid();
    const t = now();
    const boxes = [];
    for (let i=1;i<=6;i++){
      boxes.push({
        id: uid(),
        title: `BOX ${i}`,
        x: 40 + ((i-1)%3)*240,
        y: 40 + (Math.floor((i-1)/3))*200,
        w: DEFAULT_BOX_W,
        h: DEFAULT_BOX_H,
        color: COLORS[(i-1)%COLORS.length],
        createdAt: t,
        seat: { personId: null, startedAt: null },
        text: structuredClone(DEFAULT_TEXT),
      });
    }
    state.boards.push({ id: boardId, name: "배치도 1", createdAt: t, boxes });
    state.activeBoardId = boardId;
  } else {
    // 방어: 기존 box 속성 보정
    state.boards.forEach(b=>{
      b.boxes.forEach(box=>{
        ensureBoxText(box);
        if (box.w == null) box.w = DEFAULT_BOX_W;
        if (box.h == null) box.h = DEFAULT_BOX_H;
      });
    });
    if (!state.activeBoardId) state.activeBoardId = state.boards[0].id;
  }

  buildPalette();
  bindUI();
  applyListCollapsed(false);
  setZoom(1);
  applyGridUI();

  renderBoardsBar();
  renderAll();
  tick();
}
init();

/* =========================================================
   UI binding
========================================================= */
function bindUI(){
  $("#btnAddWaiting").addEventListener("click", addWaitingFromInput);
  $("#nameInput").addEventListener("keydown", (e)=>{
    if (e.key === "Enter") addWaitingFromInput();
  });

  // Tabs
  $$(".tab").forEach(t=>{
    t.addEventListener("click", ()=>{
      switchListTab(t.dataset.tab);
    });
  });

  $("#btnSortH").addEventListener("click", ()=>sortSelected("h"));
  $("#btnSortV").addEventListener("click", ()=>sortSelected("v"));
  $("#btnAddBox").addEventListener("click", addBox);
  $("#btnDeleteSelected").addEventListener("click", deleteSelectedBoxes);

  // Zoom
  $("#zoomIn").addEventListener("click", ()=>setZoom(state.zoom * 1.1));
  $("#zoomOut").addEventListener("click", ()=>setZoom(state.zoom / 1.1));
  $("#zoomReset").addEventListener("click", ()=>setZoom(1));

  const viewport = $("#boardViewport");
  viewport.addEventListener("wheel", (e)=>{
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const dir = Math.sign(e.deltaY);
    const factor = dir > 0 ? 1/1.08 : 1.08;
    setZoom(state.zoom * factor);
  }, {passive:false});

  // Color modal
  $("#btnColor").addEventListener("click", openColorModal);
  $("#closeColorModal").addEventListener("click", closeColorModal);
  $("#cancelColor").addEventListener("click", closeColorModal);
  $("#colorModal").addEventListener("click", (e)=>{
    if (e.target.id === "colorModal") closeColorModal();
  });

  // Text modal
  $("#btnTextEdit").addEventListener("click", openTextModalForSelection);
  $("#closeTextModal").addEventListener("click", closeTextModal);
  $("#textModal").addEventListener("click", (e)=>{
    if (e.target.id === "textModal") closeTextModal();
  });
  $("#btnTextApply").addEventListener("click", applyTextFromModal);
  $("#btnTextReset").addEventListener("click", ()=> fillTextModal(DEFAULT_TEXT));

  $$(".btnStep").forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      e.preventDefault();
      e.stopPropagation();
      const key = btn.dataset.stepper;
      const dir = btn.dataset.dir;
      stepNumberField(key, dir === "+" ? +1 : -1);
    });
  });

  // List collapse
  $("#btnToggleList").addEventListener("click", ()=> applyListCollapsed(!state.listCollapsed));
  $("#btnToggleListBoard").addEventListener("click", ()=> applyListCollapsed(false));
  $("#expandHandle").addEventListener("click", ()=> applyListCollapsed(false));

  // Tab key toggle (닫기/열기)
  window.addEventListener("keydown", (e)=>{
    if (e.key !== "Tab") return;

    if ($("#colorModal").style.display === "flex"){
      e.preventDefault(); e.stopImmediatePropagation();
      closeColorModal(); return;
    }
    if ($("#textModal").style.display === "flex"){
      e.preventDefault(); e.stopImmediatePropagation();
      closeTextModal(); return;
    }

    e.preventDefault();
    e.stopImmediatePropagation();
    applyListCollapsed(!state.listCollapsed);
  }, true);

  // Resize
  window.addEventListener("resize", ()=> resizeBoardCanvas());

  // Selection rectangle
  bindBoardSelection();

  // ✅ Snap UI
  $("#btnSnapToggle").addEventListener("click", ()=>{
    state.snapEnabled = !state.snapEnabled;
    applyGridUI();
  });
  $("#gridSizeSelect").addEventListener("change", (e)=>{
    state.gridSize = parseInt(e.target.value, 10) || 16;
    applyGridUI();
  });
  applyGridUI();

  // ✅ Search UI
  $("#searchInput").addEventListener("keydown", (e)=>{
    if (e.key === "Enter"){
      e.preventDefault();
      runSearchAndFocusNext();
    }
  });
  $("#btnSearchNext").addEventListener("click", runSearchAndFocusNext);
}

function applyListCollapsed(collapsed){
  const viewport = $("#boardViewport");
  const keepScroll = { left: viewport.scrollLeft, top: viewport.scrollTop };

  state.listCollapsed = collapsed;

  const app = $("#app");
  const countsBoard = $("#countsLabelBoard");
  const btnBoard = $("#btnToggleListBoard");
  const handle = $("#expandHandle");

  if (collapsed){
    app.classList.add("list-collapsed");
    countsBoard.style.display = "";
    btnBoard.style.display = "";
    handle.style.display = "flex";
  } else {
    app.classList.remove("list-collapsed");
    countsBoard.style.display = "none";
    btnBoard.style.display = "none";
    handle.style.display = "none";
  }

  $("#btnToggleList").textContent = collapsed ? "목록 열기" : "목록 닫기";
  $("#btnToggleListBoard").textContent = "목록 열기";

  requestAnimationFrame(()=>{
    resizeBoardCanvas();
    viewport.scrollLeft = keepScroll.left;
    viewport.scrollTop  = keepScroll.top;
  });

  updateCounts();
}

function setZoom(z){
  state.zoom = Math.max(0.45, Math.min(1.8, z));
  $("#boardCanvas").style.transform = `scale(${state.zoom})`;
  $("#zoomLabel").textContent = `Zoom ${Math.round(state.zoom*100)}%`;

  state.wmOpacity = computeWmOpacity(state.zoom);
  state.wmScale   = computeWmScale(state.zoom);

  resizeBoardCanvas();
  renderBoard();
}

function addWaitingFromInput(){
  const el = $("#nameInput");
  const name = (el.value || "").trim();
  if (!name) return;

  const t = now();
  state.people.push({
    id: uid(),
    name,
    createdAt: t,
    status: "waiting",
    boardId: null,
    boxId: null,
    waitStartedAt: t,
    assignedStartedAt: null
  });

  el.value = "";
  renderAll();
}

/* =========================================================
   Boards Tabs Bar
========================================================= */
function renderBoardsBar(){
  const bar = $("#boardsBar");
  bar.innerHTML = "";

  const activeId = state.activeBoardId;

  state.boards.forEach((b)=>{
    const tab = document.createElement("div");
    tab.className = "btab" + (b.id === activeId ? " active" : "");
    tab.draggable = true;
    tab.dataset.boardId = b.id;

    tab.innerHTML = `
      <div class="name" title="${escapeHtml(b.name)}">${escapeHtml(b.name)}</div>
      <div class="actions">
        <div class="bicon" data-act="rename" title="이름변경">✎</div>
        <div class="bicon danger" data-act="delete" title="삭제">×</div>
      </div>
    `;

    tab.addEventListener("click", (e)=>{
      if (e.target.closest('[data-act="rename"], [data-act="delete"]')) return;
      setActiveBoard(b.id);
    });

    tab.querySelector('[data-act="rename"]').addEventListener("click", (e)=>{
      e.preventDefault(); e.stopPropagation();
      const n = prompt("배치도 이름", b.name);
      if (n && n.trim()){
        b.name = n.trim();
        renderBoardsBar();
        renderLists();
        updateCounts();
      }
    });

    tab.querySelector('[data-act="delete"]').addEventListener("click", (e)=>{
      e.preventDefault(); e.stopPropagation();
      deleteBoard_A(b.id);
    });

    // Drag reorder
    tab.addEventListener("dragstart", (e)=>{
      tab.classList.add("dragging");
      e.dataTransfer.setData("text/plain", b.id);
      e.dataTransfer.effectAllowed = "move";
    });
    tab.addEventListener("dragend", ()=> tab.classList.remove("dragging"));

    tab.addEventListener("dragover", (e)=>{
      e.preventDefault();
      const draggingId = e.dataTransfer.getData("text/plain");
      if (!draggingId || draggingId === b.id) return;

      const from = state.boards.findIndex(x=>x.id===draggingId);
      const to = state.boards.findIndex(x=>x.id===b.id);
      if (from < 0 || to < 0 || from === to) return;

      const moved = state.boards.splice(from, 1)[0];
      state.boards.splice(to, 0, moved);
      renderBoardsBar();
    });

    bar.appendChild(tab);
  });

  // Add
  const add = document.createElement("div");
  add.className = "btabAdd";
  add.innerHTML = `+ 배치도 추가`;
  add.addEventListener("click", addBoard);
  bar.appendChild(add);
}

function addBoard(){
  const n = state.boards.length + 1;
  const t = now();
  const boardId = uid();

  // 새 보드 기본 박스 6개
  const boxes = [];
  for (let i=1;i<=6;i++){
    boxes.push({
      id: uid(),
      title: `BOX ${i}`,
      x: 40 + ((i-1)%3)*240,
      y: 40 + (Math.floor((i-1)/3))*200,
      w: DEFAULT_BOX_W,
      h: DEFAULT_BOX_H,
      color: COLORS[(i-1)%COLORS.length],
      createdAt: t,
      seat: { personId: null, startedAt: null },
      text: structuredClone(DEFAULT_TEXT),
    });
  }

  state.boards.push({ id: boardId, name: `배치도 ${n}`, createdAt: t, boxes });
  setActiveBoard(boardId);
}

function deleteBoard_A(boardId){
  if (state.boards.length <= 1){
    alert("배치도는 최소 1개는 있어야 합니다.");
    return;
  }

  const board = state.boards.find(b=>b.id===boardId);
  if (!board) return;

  const ok = confirm(`"${board.name}" 배치도를 삭제할까요?\n\n(A규칙) 이 배치도에 배치된 인원은 모두 '대기'로 돌아갑니다.`);
  if (!ok) return;

  // A 규칙: 보드에 배치된 사람 전부 대기로
  board.boxes.forEach(box=>{
    if (box.seat?.personId){
      const p = state.people.find(x=>x.id===box.seat.personId);
      if (p) toWaiting(p);
      box.seat.personId = null;
      box.seat.startedAt = null;
    }
  });

  state.boards = state.boards.filter(b=>b.id!==boardId);

  if (state.activeBoardId === boardId){
    state.activeBoardId = state.boards[0].id;
  }

  state.selectedBoxIds.clear();
  renderBoardsBar();
  renderAll();
}

/* =========================================================
   Box operations (active board)
========================================================= */
function addBox(){
  const board = getActiveBoard();
  if (!board) return;

  const n = board.boxes.length + 1;
  board.boxes.push({
    id: uid(),
    title: `BOX ${n}`,
    x: 60 + (n%4)*230,
    y: 60 + (Math.floor(n/4))*190,
    w: DEFAULT_BOX_W,
    h: DEFAULT_BOX_H,
    color: COLORS[(n-1)%COLORS.length],
    createdAt: now(),
    seat: { personId: null, startedAt: null },
    text: structuredClone(DEFAULT_TEXT),
  });
  renderAll();
}

function deleteSelectedBoxes(){
  const board = getActiveBoard();
  if (!board) return;
  if (state.selectedBoxIds.size === 0) return;

  for (const boxId of state.selectedBoxIds){
    const box = board.boxes.find(b=>b.id===boxId);
    if (!box) continue;
    if (box.seat.personId){
      const p = state.people.find(x=>x.id===box.seat.personId);
      if (p) toWaiting(p);
      box.seat.personId = null;
      box.seat.startedAt = null;
    }
  }

  board.boxes = board.boxes.filter(b=>!state.selectedBoxIds.has(b.id));
  state.selectedBoxIds.clear();
  renderAll();
}

function sortSelected(axis){
  const board = getActiveBoard();
  if (!board) return;

  const ids = Array.from(state.selectedBoxIds);
  if (ids.length < 2) return;

  const boxes = ids.map(id=>board.boxes.find(b=>b.id===id)).filter(Boolean);
  if (boxes.length < 2) return;

  boxes.sort((a,b)=> axis==="h" ? (a.x-b.x) : (a.y-b.y));

  const gapX = (DEFAULT_BOX_W + 40);
  const gapY = (DEFAULT_BOX_H + 30);

  if (axis === "h"){
    const y = Math.round(boxes.reduce((s,b)=>s+b.y,0)/boxes.length);
    let x = Math.min(...boxes.map(b=>b.x));
    boxes.forEach((b,i)=>{ b.x = x + i*gapX; b.y = y; });
  } else {
    const x = Math.round(boxes.reduce((s,b)=>s+b.x,0)/boxes.length);
    let y = Math.min(...boxes.map(b=>b.y));
    boxes.forEach((b,i)=>{ b.y = y + i*gapY; b.x = x; });
  }

  // 스냅이 켜져있으면 정렬 후도 스냅
  if (state.snapEnabled){
    boxes.forEach(b=>snapBoxXY(b));
  }

  renderAll();
}

/* =========================================================
   Assignment (board-aware)
========================================================= */
function seatPersonToBox(personId, boardId, boxId){
  const p = state.people.find(x=>x.id===personId);
  const board = state.boards.find(b=>b.id===boardId);
  if (!p || !board) return;

  const box = board.boxes.find(b=>b.id===boxId);
  if (!box) return;

  // 대상 박스에 기존 사람이 있으면 대기로
  if (box.seat.personId){
    const old = state.people.find(x=>x.id===box.seat.personId);
    if (old) toWaiting(old);
  }

  // 사람이 다른 보드/박스에 배치 중이면 그 자리 비우기
  if (p.status === "assigned" && p.boardId && p.boxId){
    const prevBoard = state.boards.find(b=>b.id===p.boardId);
    const prevBox = prevBoard?.boxes.find(x=>x.id===p.boxId);
    if (prevBox && prevBox.seat.personId === p.id){
      prevBox.seat.personId = null;
      prevBox.seat.startedAt = null;
    }
  }

  box.seat.personId = p.id;
  box.seat.startedAt = now();     // 박스 우상단 타이머 기준
  toAssigned(p, boardId, boxId);  // 목록(배치탭) 타이머 기준

  renderAll();
}

function unseatPersonFromBox(boardId, boxId){
  const board = state.boards.find(b=>b.id===boardId);
  const box = board?.boxes.find(x=>x.id===boxId);
  if (!board || !box || !box.seat.personId) return;

  const p = state.people.find(x=>x.id===box.seat.personId);
  if (p) toWaiting(p);

  box.seat.personId = null;
  box.seat.startedAt = null;
  renderAll();
}

/* =========================================================
   Rendering
========================================================= */
function renderAll(){
  renderLists();
  renderBoard();
  updateCounts();
  resizeBoardCanvas();
}

function updateCounts(){
  const w = state.people.filter(p=>p.status==="waiting").length;
  const a = state.people.filter(p=>p.status==="assigned").length;
  const b = getBoxes().length;
  const board = getActiveBoard();
  const boardName = board ? board.name : "-";
  const txt = `대기 ${w} / 배치 ${a} / 박스 ${b}  ·  ${boardName}`;
  $("#countsLabel").textContent = txt;
  $("#countsLabelBoard").textContent = txt;
}

function makeWaitingRowDraggable(rowEl, person){
  rowEl.classList.add("waiting-draggable");
  rowEl.draggable = true;

  rowEl.addEventListener("dragstart", (e)=>{
    rowEl.classList.add("dragging");
    e.dataTransfer.setData(DRAG_MIME, person.id);
    e.dataTransfer.setData("text/plain", person.id);
    e.dataTransfer.effectAllowed = "move";
  });
  rowEl.addEventListener("dragend", ()=> rowEl.classList.remove("dragging"));
}

function switchListTab(tab){
  $$(".tab").forEach(x=>{
    x.classList.toggle("active", x.dataset.tab === tab);
  });
  $("#tab_waiting").style.display  = (tab==="waiting") ? "" : "none";
  $("#tab_assigned").style.display = (tab==="assigned") ? "" : "none";
  $("#tab_boxes").style.display    = (tab==="boxes") ? "" : "none";
}

function renderLists(){
  const waiting = state.people.filter(p=>p.status==="waiting");
  const assigned = state.people.filter(p=>p.status==="assigned");

  // waiting tab
  const wEl = $("#tab_waiting");
  wEl.innerHTML = "";
  if (waiting.length === 0){
    wEl.innerHTML = `<div class="hint">대기 인원이 없습니다.</div>`;
  } else {
    waiting.forEach(p=>{
      const row = document.createElement("div");
      row.className = "row unassigned";
      row.dataset.personRow = p.id; // ✅ 검색 하이라이트용

      row.innerHTML = `
        <div class="left">
          <div class="name">${escapeHtml(p.name)}</div>
          <div class="meta">
            <span class="pill warn">미배정</span>
            <span class="pill">대기 생성: ${new Date(p.createdAt).toLocaleTimeString()}</span>
            <span class="pill blue">대기 경과: <b data-waittimer="${p.id}">00:00:00</b></span>
            <span class="pill">드래그해서 박스로</span>
          </div>
        </div>
        <div class="actions"><button class="danger" title="삭제">삭제</button></div>
      `;

      makeWaitingRowDraggable(row, p);
      row.querySelector("button").addEventListener("click", ()=>{
        state.people = state.people.filter(x=>x.id!==p.id);
        renderAll();
      });

      wEl.appendChild(row);
    });
  }

  // assigned tab
  const aEl = $("#tab_assigned");
  aEl.innerHTML = "";
  if (assigned.length === 0){
    aEl.innerHTML = `<div class="hint">배치된 인원이 없습니다.</div>`;
  } else {
    assigned.forEach(p=>{
      const board = state.boards.find(b=>b.id===p.boardId);
      const box = board?.boxes.find(x=>x.id===p.boxId);
      const boardName = board ? board.name : "-";
      const boxTitle = box ? box.title : "-";

      const row = document.createElement("div");
      row.className = "row inplay";
      row.dataset.personRow = p.id; // ✅ 검색 하이라이트용

      row.innerHTML = `
        <div class="left">
          <div class="name">${escapeHtml(p.name)}</div>
          <div class="meta">
            <span class="pill good">배치됨</span>
            <span class="pill blue">${escapeHtml(boardName)} · ${escapeHtml(boxTitle)}</span>
            <span class="pill blue">배치 경과: <b data-assigntimer="${p.id}">00:00:00</b></span>
          </div>
        </div>
        <div class="actions">
          <button class="blue" title="해당 보드로 이동">이동</button>
          <button title="대기로 이동">대기로</button>
        </div>
      `;

      const [btnGo, btnBack] = row.querySelectorAll("button");

      // ✅ 배치탭에서 클릭 → 보드 자동 전환 + 박스 하이라이트 + 중앙이동
      btnGo.addEventListener("click", ()=>{
        focusAssignedPerson(p);
        switchListTab("assigned");
      });

      btnBack.addEventListener("click", ()=>{
        if (p.boardId && p.boxId){
          const b = state.boards.find(x=>x.id===p.boardId);
          const bx = b?.boxes.find(x=>x.id===p.boxId);
          if (bx && bx.seat.personId === p.id){
            bx.seat.personId = null;
            bx.seat.startedAt = null;
          }
        }
        toWaiting(p);
        renderAll();
      });

      aEl.appendChild(row);
    });
  }

  // boxes tab (active board)
  const bEl = $("#tab_boxes");
  bEl.innerHTML = "";
  const board = getActiveBoard();
  const boxes = getBoxes();

  if (!board){
    bEl.innerHTML = `<div class="hint">활성 배치도가 없습니다.</div>`;
  } else if (boxes.length === 0){
    bEl.innerHTML = `<div class="hint">박스가 없습니다. 상단에서 “박스 추가”를 누르세요.</div>`;
  } else {
    boxes.forEach(box=>{
      ensureBoxText(box);
      const filled = box.seat.personId ? 1 : 0;
      const card = document.createElement("div");
      card.className = "box-card";
      card.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:2px;min-width:0">
          <b>${escapeHtml(box.title)}</b>
          <span>좌석 ${filled}/1 · ${box.w}×${box.h}</span>
        </div>
        <div class="btns">
          <button class="blue">선택</button>
          <button>이름 변경</button>
          <button class="blue">편집</button>
        </div>
      `;
      const [btnSel, btnRename, btnEdit] = card.querySelectorAll("button");
      btnSel.addEventListener("click", ()=>{
        state.selectedBoxIds.clear();
        state.selectedBoxIds.add(box.id);
        renderBoard();
      });
      btnRename.addEventListener("click", ()=>{
        const n = prompt("박스 이름", box.title);
        if (n && n.trim()){
          box.title = n.trim();
          renderAll();
        }
      });
      btnEdit.addEventListener("click", ()=>{
        state.selectedBoxIds.clear();
        state.selectedBoxIds.add(box.id);
        renderBoard();
        openTextModalForSelection();
      });
      bEl.appendChild(card);
    });
  }
}

function renderBoard(){
  const canvas = $("#boardCanvas");
  canvas.innerHTML = "";

  const board = getActiveBoard();
  if (!board) return;

  board.boxes.forEach(box=>{
    ensureBoxText(box);

    const el = document.createElement("div");
    el.className = "table-box";
    el.style.left = box.x + "px";
    el.style.top  = box.y + "px";
    el.style.width = (box.w ?? DEFAULT_BOX_W) + "px";
    el.style.height = (box.h ?? DEFAULT_BOX_H) + "px";
    el.style.background = `linear-gradient(180deg, ${hexToRgba(box.color, .26)}, rgba(255,255,255,.04))`;
    el.dataset.boxId = box.id;

    if (state.selectedBoxIds.has(box.id)) el.classList.add("selected");

    const seat = box.seat;
    let seatHtml = "";
    if (!seat.personId){
      seatHtml = `
        <div class="seat empty">
          <div class="who" style="font-size:${box.text.nameSize}px; color:${box.text.nameColor};">빈 자리</div>
          <div style="display:flex;gap:8px;align-items:center;">
            <span class="pill blue">여기로 드롭</span>
          </div>
        </div>
      `;
    } else {
      const p = state.people.find(x=>x.id===seat.personId);
      const name = p ? p.name : "Unknown";
      seatHtml = `
        <div class="seat occupied" data-seat="occupied" title="더블클릭: 대기로 이동">
          <div class="who" style="font-size:${box.text.nameSize}px; color:${box.text.nameColor};">${escapeHtml(name)}</div>
          <span class="pill good">배치</span>
        </div>
      `;
    }

    const wmFont = Math.round(box.text.titleSize * state.wmScale);

    el.innerHTML = `
      <div class="wm-title"
        style="font-size:${wmFont}px; color:${box.text.titleColor}; --wmOpacity:${state.wmOpacity};">
        ${escapeHtml(box.title)}
      </div>
      <div class="wm-time"
        style="font-size:${box.text.headerTimeSize}px; color:${box.text.headerTimeColor};">
        <span data-boxelapsed>--:--:--</span>
      </div>
      <div class="body">${seatHtml}</div>
      <div class="resize-handle" data-resize="br" title="드래그: 크기 조절 (Alt: 스냅 해제)"></div>
    `;

    // 좌석 더블클릭 → 대기로 이동 (텍스트편집 더블클릭과 충돌 방지)
    const occupiedSeatEl = el.querySelector('[data-seat="occupied"]');
    if (occupiedSeatEl){
      occupiedSeatEl.addEventListener("dblclick", (ev)=>{
        ev.preventDefault();
        ev.stopPropagation();
        unseatPersonFromBox(board.id, box.id);
      }, true);
    }

    // 박스 선택
    el.addEventListener("mousedown", (e)=>{
      if (e.target.closest(".resize-handle")) return;
      if (e.target.closest("button, input, select, textarea, a, label")) return;

      const id = box.id;
      if (e.shiftKey){
        if (state.selectedBoxIds.has(id)) state.selectedBoxIds.delete(id);
        else state.selectedBoxIds.add(id);
      } else {
        if (!state.selectedBoxIds.has(id) || state.selectedBoxIds.size > 1){
          state.selectedBoxIds.clear();
          state.selectedBoxIds.add(id);
        }
      }
      renderBoardSelectionOnly();
    });

    // 박스 더블클릭 → 텍스트 편집
    el.addEventListener("dblclick", (e)=>{
      if (e.target.closest(".resize-handle")) return;
      if (e.target.closest("[data-seat='occupied']")) return;
      if (e.target.closest("button")) return;
      state.selectedBoxIds.clear();
      state.selectedBoxIds.add(box.id);
      renderBoardSelectionOnly();
      openTextModalForSelection();
    });

    // Drop zone
    el.addEventListener("dragenter", (e)=>{ e.preventDefault(); el.classList.add("drop-over"); });
    el.addEventListener("dragover", (e)=>{ e.preventDefault(); e.dataTransfer.dropEffect = "move"; });
    el.addEventListener("dragleave", (e)=>{ if (el.contains(e.relatedTarget)) return; el.classList.remove("drop-over"); });
    el.addEventListener("drop", (e)=>{
      e.preventDefault();
      el.classList.remove("drop-over");
      const pid = getDraggedPersonId(e);
      if (!pid) return;
      seatPersonToBox(pid, board.id, box.id);
    });

    // Drag move + Resize
    makeDraggable(el, box);
    makeResizable(el, box);

    canvas.appendChild(el);
  });

  renderBoardSelectionOnly();
}

function renderBoardSelectionOnly(){
  $$(".table-box").forEach(el=>{
    const id = el.dataset.boxId;
    el.classList.toggle("selected", state.selectedBoxIds.has(id));
  });
}

/* =========================================================
   Drag move box (with snap)
========================================================= */
function makeDraggable(el, box){
  let startX=0, startY=0, ox=0, oy=0;
  let dragging=false;

  el.addEventListener("mousedown", (e)=>{
    if (e.button !== 0) return;
    if (e.target.closest(".resize-handle")) return;
    if (e.target.closest("button, input, select, textarea, a, label")) return;

    dragging = true;
    el.classList.add("dragging");

    startX = e.clientX;
    startY = e.clientY;
    ox = box.x;
    oy = box.y;

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
    e.preventDefault();
  });

  function onMove(e){
    if (!dragging) return;
    const dx = (e.clientX - startX) / state.zoom;
    const dy = (e.clientY - startY) / state.zoom;

    box.x = Math.round(ox + dx);
    box.y = Math.round(oy + dy);

    // ✅ Snap (Alt 누르면 해제)
    if (state.snapEnabled && !e.altKey){
      snapBoxXY(box);
    }

    el.style.left = box.x + "px";
    el.style.top  = box.y + "px";
  }

  function onUp(e){
    dragging = false;
    el.classList.remove("dragging");
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("mouseup", onUp, true);

    // 마지막에도 스냅 한번 더 고정(Alt 무시하고 정리)
    if (state.snapEnabled && !(e?.altKey)){
      snapBoxXY(box);
      el.style.left = box.x + "px";
      el.style.top  = box.y + "px";
    }

    resizeBoardCanvas();
  }
}

/* =========================================================
   Resize box (with snap)
========================================================= */
function makeResizable(el, box){
  const handle = el.querySelector(".resize-handle");
  if (!handle) return;

  let resizing = false;
  let startX=0, startY=0, ow=0, oh=0;

  handle.addEventListener("mousedown", (e)=>{
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    resizing = true;
    startX = e.clientX;
    startY = e.clientY;
    ow = box.w ?? DEFAULT_BOX_W;
    oh = box.h ?? DEFAULT_BOX_H;

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
  });

  function onMove(e){
    if (!resizing) return;
    const dx = (e.clientX - startX) / state.zoom;
    const dy = (e.clientY - startY) / state.zoom;

    box.w = Math.max(MIN_W, Math.min(MAX_W, Math.round(ow + dx)));
    box.h = Math.max(MIN_H, Math.min(MAX_H, Math.round(oh + dy)));

    // ✅ Snap (Alt 누르면 해제)
    if (state.snapEnabled && !e.altKey){
      snapBoxWH(box);
      box.w = Math.max(MIN_W, Math.min(MAX_W, box.w));
      box.h = Math.max(MIN_H, Math.min(MAX_H, box.h));
    }

    el.style.width = box.w + "px";
    el.style.height = box.h + "px";
  }

  function onUp(e){
    resizing = false;
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("mouseup", onUp, true);

    if (state.snapEnabled && !(e?.altKey)){
      snapBoxWH(box);
      box.w = Math.max(MIN_W, Math.min(MAX_W, box.w));
      box.h = Math.max(MIN_H, Math.min(MAX_H, box.h));
      el.style.width = box.w + "px";
      el.style.height = box.h + "px";
    }

    resizeBoardCanvas();
    renderLists(); // 박스 목록에 크기 표시 업데이트
  }
}

/* =========================================================
   Board selection rectangle
========================================================= */
function bindBoardSelection(){
  const viewport = $("#boardViewport");
  const overlay = $("#selectionOverlay");
  const rect = $("#selectionRect");
  const canvas = $("#boardCanvas");

  let selecting = false;
  let sx=0, sy=0;

  function setOverlayActive(active){
    overlay.style.pointerEvents = active ? "auto" : "none";
  }

  viewport.addEventListener("mousedown", (e)=>{
    if (e.target.closest("button, input, select, textarea, a, label")) return;
    if (e.target.closest(".table-box")) return;

    selecting = true;
    setOverlayActive(true);

    const vpRect = viewport.getBoundingClientRect();
    sx = e.clientX - vpRect.left + viewport.scrollLeft;
    sy = e.clientY - vpRect.top  + viewport.scrollTop;

    rect.style.left = sx + "px";
    rect.style.top  = sy + "px";
    rect.style.width = "0px";
    rect.style.height = "0px";
    rect.style.display = "block";

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
  }, true);

  function onMove(e){
    if (!selecting) return;
    const vpRect = viewport.getBoundingClientRect();
    const cx = e.clientX - vpRect.left + viewport.scrollLeft;
    const cy = e.clientY - vpRect.top  + viewport.scrollTop;

    const x1 = Math.min(sx, cx), y1 = Math.min(sy, cy);
    const x2 = Math.max(sx, cx), y2 = Math.max(sy, cy);

    rect.style.left = x1 + "px";
    rect.style.top  = y1 + "px";
    rect.style.width = (x2 - x1) + "px";
    rect.style.height = (y2 - y1) + "px";
  }

  function onUp(e){
    if (!selecting) return;
    selecting = false;
    setOverlayActive(false);
    rect.style.display = "none";

    const vpRect = viewport.getBoundingClientRect();
    const ex = e.clientX - vpRect.left + viewport.scrollLeft;
    const ey = e.clientY - vpRect.top  + viewport.scrollTop;

    const x1 = Math.min(sx, ex), y1 = Math.min(sy, ey);
    const x2 = Math.max(sx, ex), y2 = Math.max(sy, ey);

    const canvasOffsetX = (canvas.offsetLeft);
    const canvasOffsetY = (canvas.offsetTop);

    const selX1 = (x1 - canvasOffsetX) / state.zoom;
    const selY1 = (y1 - canvasOffsetY) / state.zoom;
    const selX2 = (x2 - canvasOffsetX) / state.zoom;
    const selY2 = (y2 - canvasOffsetY) / state.zoom;

    const board = getActiveBoard();
    if (!board) return;

    const newly = [];
    board.boxes.forEach(b=>{
      const w = b.w ?? DEFAULT_BOX_W;
      const h = b.h ?? DEFAULT_BOX_H;
      const bx1 = b.x, by1 = b.y;
      const bx2 = b.x + w, by2 = b.y + h;
      const hit = !(bx2 < selX1 || bx1 > selX2 || by2 < selY1 || by1 > selY2);
      if (hit) newly.push(b.id);
    });

    if (!e.shiftKey) state.selectedBoxIds.clear();
    newly.forEach(id=>state.selectedBoxIds.add(id));
    renderBoardSelectionOnly();

    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("mouseup", onUp, true);
  }
}

/* =========================================================
   Color modal
========================================================= */
function buildPalette(){
  const pal = $("#palette");
  pal.innerHTML = "";
  COLORS.forEach(c=>{
    const s = document.createElement("div");
    s.className = "swatch";
    s.style.background = c;
    s.title = c;
    s.addEventListener("click", ()=>{
      applyColorToSelected(c);
      closeColorModal();
    });
    pal.appendChild(s);
  });
}
function openColorModal(){
  if (state.selectedBoxIds.size === 0){
    alert("먼저 박스를 선택하세요. (Shift+클릭 가능)");
    return;
  }
  $("#colorModal").style.display = "flex";
}
function closeColorModal(){ $("#colorModal").style.display = "none"; }
function applyColorToSelected(color){
  const board = getActiveBoard();
  if (!board) return;
  for (const id of state.selectedBoxIds){
    const b = board.boxes.find(x=>x.id===id);
    if (b) b.color = color;
  }
  renderBoard();
}

/* =========================================================
   Text modal
========================================================= */
function openTextModalForSelection(){
  const board = getActiveBoard();
  if (!board) return;

  if (state.selectedBoxIds.size === 0){
    alert("먼저 박스를 선택하세요. (Shift+클릭 가능)");
    return;
  }
  const firstId = Array.from(state.selectedBoxIds)[0];
  const box = board.boxes.find(b=>b.id===firstId);
  if (!box) return;
  ensureBoxText(box);

  const n = state.selectedBoxIds.size;
  $("#textModalTarget").textContent = n === 1
    ? `선택된 박스(1개): ${box.title} 에 적용됩니다.`
    : `선택된 박스(${n}개)에 한 번에 적용됩니다.`;

  fillTextModal(box.text);
  $("#textModal").style.display = "flex";
}
function closeTextModal(){ $("#textModal").style.display = "none"; }

function fillTextModal(text){
  $("#f_titleSize").value = text.titleSize;
  $("#f_titleColor").value = text.titleColor;
  $("#f_headerTimeSize").value = text.headerTimeSize;
  $("#f_headerTimeColor").value = text.headerTimeColor;
  $("#f_nameSize").value = text.nameSize;
  $("#f_nameColor").value = text.nameColor;
  $("#f_seatTimeSize").value = text.seatTimeSize;
  $("#f_seatTimeColor").value = text.seatTimeColor;
}

function readTextModal(){
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  return {
    titleSize: clamp(parseInt($("#f_titleSize").value || DEFAULT_TEXT.titleSize, 10), 14, 56),
    titleColor: $("#f_titleColor").value || DEFAULT_TEXT.titleColor,

    headerTimeSize: clamp(parseInt($("#f_headerTimeSize").value || DEFAULT_TEXT.headerTimeSize, 10), 10, 22),
    headerTimeColor: $("#f_headerTimeColor").value || DEFAULT_TEXT.headerTimeColor,

    nameSize: clamp(parseInt($("#f_nameSize").value || DEFAULT_TEXT.nameSize, 10), 11, 28),
    nameColor: $("#f_nameColor").value || DEFAULT_TEXT.nameColor,

    seatTimeSize: clamp(parseInt($("#f_seatTimeSize").value || DEFAULT_TEXT.seatTimeSize, 10), 10, 24),
    seatTimeColor: $("#f_seatTimeColor").value || DEFAULT_TEXT.seatTimeColor,
  };
}

function applyTextFromModal(){
  const board = getActiveBoard();
  if (!board) return;

  const t = readTextModal();
  for (const id of state.selectedBoxIds){
    const b = board.boxes.find(x=>x.id===id);
    if (!b) continue;
    ensureBoxText(b);
    b.text = { ...b.text, ...t };
  }
  closeTextModal();
  renderBoard();
}

function stepNumberField(key, delta){
  const map = {
    titleSize: { el:"#f_titleSize", min:14, max:56 },
    headerTimeSize: { el:"#f_headerTimeSize", min:10, max:22 },
    nameSize: { el:"#f_nameSize", min:11, max:28 },
    seatTimeSize: { el:"#f_seatTimeSize", min:10, max:24 },
  };
  const cfg = map[key];
  if (!cfg) return;
  const input = $(cfg.el);
  const cur = parseInt(input.value || "0", 10) || 0;
  const next = Math.max(cfg.min, Math.min(cfg.max, cur + delta));
  input.value = String(next);
}

/* =========================================================
   ✅ Search: auto board switch + box highlight + center
========================================================= */
function clearListSearchHighlights(){
  $$(".row.search-hit").forEach(el=>el.classList.remove("search-hit"));
}
function collectMatches(q){
  const query = q.trim().toLowerCase();
  if (!query) return [];
  return state.people.filter(p => (p.name||"").toLowerCase().includes(query));
}
function highlightPersonInList(personId){
  const row = document.querySelector(`[data-person-row="${CSS.escape(personId)}"]`);
  if (row){
    row.classList.add("search-hit");
    row.scrollIntoView({behavior:"smooth", block:"center"});
  }
}

// ✅ 핵심: 배치된 사람 -> 해당 보드로 자동 전환 + 박스 선택 + 중앙 스크롤 + 깜빡 하이라이트
function focusAssignedPerson(p){
  if (!p || p.status !== "assigned" || !p.boardId || !p.boxId) return;

  // 1) 해당 보드로 이동
  if (state.activeBoardId !== p.boardId){
    state.activeBoardId = p.boardId;
    state.selectedBoxIds.clear();
    renderBoardsBar();
    renderAll();
  }

  // 2) 박스 선택
  state.selectedBoxIds.clear();
  state.selectedBoxIds.add(p.boxId);
  renderBoardSelectionOnly();

  // 3) 중앙으로 스크롤 + 박스 임시 하이라이트(2초)
  requestAnimationFrame(()=>{
    const viewport = $("#boardViewport");
    const boxEl = document.querySelector(`.table-box[data-box-id="${CSS.escape(p.boxId)}"], .table-box[data-boxid="${CSS.escape(p.boxId)}"]`)
      || document.querySelector(`.table-box[data-boxid="${CSS.escape(p.boxId)}"]`)
      || document.querySelector(`.table-box[data-boxId="${CSS.escape(p.boxId)}"]`);

    // data-boxId가 맞음
    const boxEl2 = document.querySelector(`.table-box[data-box-id="${CSS.escape(p.boxId)}"]`);
    const boxEl3 = document.querySelector(`.table-box[data-boxid="${CSS.escape(p.boxId)}"]`);
    const boxEl4 = document.querySelector(`.table-box[data-boxid="${CSS.escape(p.boxId)}"]`);
    const realBoxEl = document.querySelector(`.table-box[data-boxid="${CSS.escape(p.boxId)}"]`)
      || document.querySelector(`.table-box[data-boxId="${CSS.escape(p.boxId)}"]`)
      || document.querySelector(`.table-box[data-boxid="${CSS.escape(p.boxId)}"]`)
      || document.querySelector(`.table-box[data-boxId="${CSS.escape(p.boxId)}"]`);

    // 위가 좀 복잡해져서, 정확히 다시 잡음
    const el = document.querySelector(`.table-box[data-boxid="${CSS.escape(p.boxId)}"]`) ||
               document.querySelector(`.table-box[data-boxId="${CSS.escape(p.boxId)}"]`) ||
               document.querySelector(`.table-box[data-boxid="${CSS.escape(p.boxId)}"]`) ||
               document.querySelector(`.table-box[data-boxId="${CSS.escape(p.boxId)}"]`) ||
               document.querySelector(`.table-box[data-boxid="${CSS.escape(p.boxId)}"]`) ||
               document.querySelector(`.table-box[data-boxId="${CSS.escape(p.boxId)}"]`) ||
               document.querySelector(`.table-box[data-boxid="${CSS.escape(p.boxId)}"]`) ||
               document.querySelector(`.table-box[data-boxId="${CSS.escape(p.boxId)}"]`) ||
               document.querySelector(`.table-box[data-boxid="${CSS.escape(p.boxId)}"]`) ||
               document.querySelector(`.table-box[data-boxId="${CSS.escape(p.boxId)}"]`) ||
               document.querySelector(`.table-box[data-boxid="${CSS.escape(p.boxId)}"]`) ||
               document.querySelector(`.table-box[data-boxId="${CSS.escape(p.boxId)}"]`) ||
               document.querySelector(`.table-box[data-boxId="${CSS.escape(p.boxId)}"]`);

    const target = el || document.querySelector(`.table-box[data-boxid="${CSS.escape(p.boxId)}"]`) ||
                   document.querySelector(`.table-box[data-boxId="${CSS.escape(p.boxId)}"]`) ||
                   document.querySelector(`.table-box[data-boxid="${CSS.escape(p.boxId)}"]`) ||
                   document.querySelector(`.table-box[data-boxId="${CSS.escape(p.boxId)}"]`) ||
                   document.querySelector(`.table-box[data-boxId="${CSS.escape(p.boxId)}"]`);

    const boxNode = document.querySelector(`.table-box[data-boxid="${CSS.escape(p.boxId)}"]`) ||
                    document.querySelector(`.table-box[data-boxId="${CSS.escape(p.boxId)}"]`) ||
                    document.querySelector(`.table-box[data-boxId="${CSS.escape(p.boxId)}"]`);

    const finalEl = document.querySelector(`.table-box[data-boxid="${CSS.escape(p.boxId)}"]`) ||
                    document.querySelector(`.table-box[data-boxId="${CSS.escape(p.boxId)}"]`);

    const boxElFinal = finalEl;

    if (!viewport || !boxElFinal) return;

    // 박스 좌표는 "스케일된 캔버스" 안이므로 스크롤도 스케일 고려
    const boxId = p.boxId;
    const board = getActiveBoard();
    const box = board?.boxes.find(b=>b.id===boxId);
    if (!box) return;

    const w = box.w ?? DEFAULT_BOX_W;
    const h = box.h ?? DEFAULT_BOX_H;

    const cx = (box.x + w/2) * state.zoom;
    const cy = (box.y + h/2) * state.zoom;

    const targetLeft = Math.max(0, cx - viewport.clientWidth/2);
    const targetTop  = Math.max(0, cy - viewport.clientHeight/2);

    viewport.scrollTo({ left: targetLeft, top: targetTop, behavior:"smooth" });

    // 깜빡 하이라이트
    boxElFinal.classList.add("drop-over");
    setTimeout(()=> boxElFinal.classList.remove("drop-over"), 1200);
  });
}

function runSearchAndFocusNext(){
  const input = $("#searchInput");
  const q = (input.value || "").trim();

  clearListSearchHighlights();

  const isNew = (state.search.query !== q);
  if (isNew){
    state.search.query = q;
    state.search.matches = collectMatches(q);
    state.search.idx = -1;
  }

  const matches = state.search.matches;
  if (!q || matches.length === 0) return;

  state.search.idx = (state.search.idx + 1) % matches.length;
  const p = matches[state.search.idx];

  if (p.status === "assigned"){
    focusAssignedPerson(p);
    switchListTab("assigned");
  } else {
    switchListTab("waiting");
  }

  requestAnimationFrame(()=>{
    highlightPersonInList(p.id);
  });
}

/* =========================================================
   Timers tick
========================================================= */
function tick(){
  $$("[data-waittimer]").forEach(el=>{
    const pid = el.getAttribute("data-waittimer");
    const p = state.people.find(x=>x.id===pid);
    if (!p) return;
    const base = p.waitStartedAt ?? p.createdAt ?? now();
    el.textContent = fmtElapsed(now() - base);
  });

  $$("[data-assigntimer]").forEach(el=>{
    const pid = el.getAttribute("data-assigntimer");
    const p = state.people.find(x=>x.id===pid);
    if (!p) return;
    const base = p.assignedStartedAt ?? now();
    el.textContent = fmtElapsed(now() - base);
  });

  $$(".table-box").forEach(boxEl=>{
    const boxId = boxEl.dataset.boxId;
    const board = getActiveBoard();
    const box = board?.boxes.find(b=>b.id===boxId);
    if (!box) return;

    const boxElapsedEl = boxEl.querySelector("[data-boxelapsed]");
    if (!boxElapsedEl) return;

    if (!box.seat.startedAt){
      boxElapsedEl.textContent = "--:--:--";
    } else {
      boxElapsedEl.textContent = fmtElapsed(now() - box.seat.startedAt);
    }
  });

  requestAnimationFrame(()=>{ setTimeout(tick, 250); });
}
