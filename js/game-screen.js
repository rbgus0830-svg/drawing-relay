import {
  db,
  ref,
  onValue
} from "./firebase.js";

// ========================================
// 화면 요소
// ========================================
const lobbyScreens = document.getElementById("lobbyScreens");
const hostScreen = document.getElementById("hostGameScreen");
const studentScreen = document.getElementById("studentGameScreen");

const hostRoomCode = document.getElementById("hostGameRoomCode");
const hostStep = document.getElementById("hostGameStep");
const hostPlayerCount = document.getElementById("hostGamePlayerCount");
const hostPhase = document.getElementById("hostGamePhase");
const hostTimer = document.getElementById("hostGameTimer");
const hostStatus = document.getElementById("hostGameStatus");

const studentRoomCode = document.getElementById("studentGameRoomCode");
const studentNumberElement = document.getElementById("studentGameNumber");
const studentStep = document.getElementById("studentGameStep");
const studentTimer = document.getElementById("studentGameTimer");
const studentStatus = document.getElementById("studentGameStatus");

const tools = document.getElementById("drawingTools");
const canvas = document.getElementById("drawingCanvas");
const context = canvas.getContext("2d");

const penColor = document.getElementById("penColor");
const penWidth = document.getElementById("penWidth");
const penWidthValue = document.getElementById("penWidthValue");
const penButton = document.getElementById("penToolBtn");
const eraserButton = document.getElementById("eraserToolBtn");
const clearButton = document.getElementById("clearCanvasBtn");

// ========================================
// モジュール 상태
// ========================================
let session = null;
let cleanups = [];
let timerId = null;

let selectedTool = "pen";
let activePointerId = null;
let previousPoint = null;
let canvasStepKey = null;

// ========================================
// 공통 화면 처리
// ========================================
function setText(element, value) {
  const text = String(value);
  if (element.textContent !== text) {
    element.textContent = text;
  }
}

function setStatus(message) {
  if (!session) {
    return;
  }

  const target = session.role === "host"
    ? hostStatus
    : studentStatus;

  setText(target, message);
}

function setDrawingEnabled(enabled) {
  tools.disabled = !enabled;
  canvas.classList.toggle("is-locked", !enabled);

  if (!enabled) {
    finishStroke();
  }
}

function formatTime(milliseconds) {
  const totalSeconds = Math.max(
    0,
    Math.ceil(milliseconds / 1000)
  );

  const minutes = String(
    Math.floor(totalSeconds / 60)
  ).padStart(2, "0");

  const seconds = String(
    totalSeconds % 60
  ).padStart(2, "0");

  return `${minutes}:${seconds}`;
}

function showTimer(milliseconds) {
  const ready = Number.isFinite(milliseconds);
  const text = ready ? formatTime(milliseconds) : "--:--";

  setText(hostTimer, text);
  setText(studentTimer, text);

  for (const timer of [hostTimer, studentTimer]) {
    timer.parentElement.classList.toggle(
      "is-warning",
      ready && milliseconds <= 10000
    );
  }
}

function remainingTime() {
  if (
    !session ||
    !Number.isFinite(session.offset) ||
    !Number.isFinite(session.game?.stepEndsAt)
  ) {
    return null;
  }

  return Math.max(
    0,
    session.game.stepEndsAt - (Date.now() + session.offset)
  );
}

// ========================================
// ゲーム 데이터 검증
// ========================================
function getValidatedGame() {
  const meta = session?.meta;
  const game = session?.game;

  if (!meta || !game || typeof game !== "object") {
    return null;
  }

  if (
    !Number.isInteger(meta.relaySteps) ||
    meta.relaySteps < 1 ||
    !Number.isInteger(game.currentStep) ||
    game.currentStep < 1 ||
    game.currentStep > meta.relaySteps ||
    typeof game.phase !== "string" ||
    !Number.isInteger(game.playerCount) ||
    game.playerCount < 2 ||
    !Number.isFinite(game.stepStartedAt) ||
    !Number.isFinite(game.stepEndsAt) ||
    game.stepEndsAt <= game.stepStartedAt ||
    !game.order ||
    typeof game.order !== "object"
  ) {
    return null;
  }

  // Firebase는 숫자 키 목록을 배열 또는 객체로 반환할 수 있습니다.
  const entries = Object.entries(game.order);

  if (entries.length !== game.playerCount) {
    return null;
  }

  entries.sort((first, second) => {
    return Number(first[0]) - Number(second[0]);
  });

  const order = [];

  for (let index = 0; index < entries.length; index += 1) {
    const [key, number] = entries[index];

    if (
      key !== String(index) ||
      typeof number !== "string" ||
      !/^\d{2}$/.test(number)
    ) {
      return null;
    }

    order.push(number);
  }

  if (new Set(order).size !== order.length) {
    return null;
  }

  return { game, order };
}

function canDrawNow() {
  if (
    !context ||
    !session ||
    session.role !== "player" ||
    session.meta?.status !== "PLAYING" ||
    session.connected !== true ||
    Object.values(session.errors).some(Boolean)
  ) {
    return false;
  }

  const validated = getValidatedGame();
  const remaining = remainingTime();

  return Boolean(
    validated &&
    validated.game.phase === "DRAWING" &&
    validated.order.includes(session.studentNumber) &&
    remaining !== null &&
    remaining > 0
  );
}

// ========================================
// ゲーム 화면 렌더링
// ========================================
function render() {
  if (!session) {
    return;
  }

  const status = session.meta?.status;

  if (status === "LOBBY") {
    lobbyScreens.hidden = false;
    hostScreen.hidden = true;
    studentScreen.hidden = true;
    session.hasShownGame = false;
    setDrawingEnabled(false);
    return;
  }

  // PLAYING을 확인하기 전에는 기존 대기실을 유지합니다.
  if (status !== "PLAYING" && !session.hasShownGame) {
    setDrawingEnabled(false);
    return;
  }

  session.hasShownGame = true;
  lobbyScreens.hidden = true;
  hostScreen.hidden = session.role !== "host";
  studentScreen.hidden = session.role !== "player";

  // 모든 조건이 확인될 때만 마지막에 다시 활성화합니다.
  const error = Object.values(session.errors).find(Boolean);

  if (error) {
    setDrawingEnabled(false);
    showTimer(null);
    setStatus(error);
    return;
  }

  if (status !== "PLAYING") {
    setDrawingEnabled(false);
    showTimer(null);
    setStatus("게임 진행 상태를 확인할 수 없습니다.");
    return;
  }

  const validated = getValidatedGame();

  if (!validated) {
    setDrawingEnabled(false);
    showTimer(null);
    setStatus("게임 데이터를 기다리는 중입니다. 계속되면 DB를 확인해 주세요.");
    return;
  }

  const { game, order } = validated;
  const stepLabel = `${game.currentStep} / ${session.meta.relaySteps}`;

  setText(hostStep, stepLabel);
  setText(studentStep, stepLabel);
  setText(hostPlayerCount, `${game.playerCount}명`);
  setText(
    hostPhase,
    game.phase === "DRAWING" ? "그리기" : game.phase
  );

  if (
    session.role === "player" &&
    !order.includes(session.studentNumber)
  ) {
    setDrawingEnabled(false);
    showTimer(null);
    setStatus("이번 게임의 시작 참가자 목록에 포함되어 있지 않습니다.");
    return;
  }

  if (session.role === "player" && !context) {
    setDrawingEnabled(false);
    setStatus("이 브라우저에서는 그림판을 사용할 수 없습니다.");
    return;
  }

  // 같은 단계의 구독 갱신은 그림을 지우지 않습니다.
  if (session.role === "player") {
    const nextKey = [
      session.roomCode,
      session.studentNumber,
      game.currentStep,
      game.stepStartedAt
    ].join(":");

    if (canvasStepKey !== nextKey) {
      finishStroke();
      clearCanvas();
      canvasStepKey = nextKey;
    }
  }

  const remaining = remainingTime();
  showTimer(remaining);

  if (session.connected !== true) {
    setDrawingEnabled(false);
    setStatus("서버 연결이 끊겼습니다. 재연결될 때까지 입력을 잠급니다.");
    return;
  }

  if (remaining === null) {
    setDrawingEnabled(false);
    setStatus("서버 시간 정보를 확인하는 중입니다.");
    return;
  }

  if (game.phase !== "DRAWING") {
    setDrawingEnabled(false);
    setStatus("현재는 그리기 단계가 아닙니다.");
    return;
  }

  if (remaining <= 0) {
    setDrawingEnabled(false);
    setStatus("시간이 종료되었습니다. 현재 버전에는 자동 단계 전환이 없습니다.");
    return;
  }

  if (session.role === "player") {
    setDrawingEnabled(true);
    setStatus("그림을 그려 주세요. 시간이 끝나면 입력이 잠깁니다.");
  } else {
    setDrawingEnabled(false);
    setStatus("학생들이 그림을 그리고 있습니다.");
  }
}

// ========================================
// 캔버스 처리
// ========================================
function clearCanvas() {
  if (!context) {
    return;
  }

  context.save();
  context.globalCompositeOperation = "source-over";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.restore();
}

function getPoint(event) {
  const rectangle = canvas.getBoundingClientRect();

  if (!rectangle.width || !rectangle.height) {
    return null;
  }

  return {
    x: (event.clientX - rectangle.left) *
      (canvas.width / rectangle.width),
    y: (event.clientY - rectangle.top) *
      (canvas.height / rectangle.height)
  };
}

function applyBrush() {
  context.globalCompositeOperation = "source-over";
  context.strokeStyle = selectedTool === "eraser"
    ? "#ffffff"
    : penColor.value;
  context.fillStyle = context.strokeStyle;
  context.lineWidth = Number(penWidth.value);
  context.lineCap = "round";
  context.lineJoin = "round";
}

function drawDot(point) {
  context.save();
  applyBrush();
  context.beginPath();
  context.arc(
    point.x,
    point.y,
    context.lineWidth / 2,
    0,
    Math.PI * 2
  );
  context.fill();
  context.restore();
}

function drawLine(from, to) {
  context.save();
  applyBrush();
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
  context.restore();
}

function finishStroke() {
  const pointerId = activePointerId;

  activePointerId = null;
  previousPoint = null;

  if (pointerId !== null) {
    try {
      if (canvas.hasPointerCapture(pointerId)) {
        canvas.releasePointerCapture(pointerId);
      }
    } catch {
      // 포인터가 이미 해제된 경우에는 추가 처리가 필요 없습니다.
    }
  }
}

function selectTool(tool) {
  finishStroke();
  selectedTool = tool;
  penButton.setAttribute(
    "aria-pressed",
    String(tool === "pen")
  );
  eraserButton.setAttribute(
    "aria-pressed",
    String(tool === "eraser")
  );
}

canvas.addEventListener("pointerdown", (event) => {
  if (
    !canDrawNow() ||
    activePointerId !== null ||
    !event.isPrimary ||
    event.button !== 0
  ) {
    return;
  }

  const point = getPoint(event);

  if (!point) {
    return;
  }

  event.preventDefault();

  try {
    canvas.setPointerCapture(event.pointerId);
  } catch {
    return;
  }

  activePointerId = event.pointerId;
  previousPoint = point;
  drawDot(point);
});

canvas.addEventListener("pointermove", (event) => {
  if (event.pointerId !== activePointerId) {
    return;
  }

  // 타이머 갱신 사이에 마감 시각을 넘었어도 입력을 차단합니다.
  if (!canDrawNow()) {
    finishStroke();
    render();
    return;
  }

  event.preventDefault();

  const point = getPoint(event);

  if (!point || !previousPoint) {
    return;
  }

  drawLine(previousPoint, point);
  previousPoint = point;
});

function endPointer(event) {
  if (event.pointerId === activePointerId) {
    finishStroke();
  }
}

canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("lostpointercapture", endPointer);
canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

penButton.addEventListener("click", () => {
  selectTool("pen");
});

eraserButton.addEventListener("click", () => {
  selectTool("eraser");
});

penColor.addEventListener("input", () => {
  selectTool("pen");
});

penWidth.addEventListener("input", () => {
  setText(penWidthValue, penWidth.value);
});

clearButton.addEventListener("click", () => {
  if (!canDrawNow()) {
    return;
  }

  finishStroke();

  if (!window.confirm("현재 그림을 모두 지울까요?")) {
    return;
  }

  // 확인 창이 열린 동안 시간이 종료될 수 있습니다.
  if (canDrawNow()) {
    clearCanvas();
  } else {
    render();
  }
});

window.addEventListener("blur", finishStroke);

document.addEventListener("visibilitychange", () => {
  finishStroke();
  render();
});

// ========================================
// 구독 시작·정리
// ========================================
function stopWatching() {
  // 먼저 세션을 무효화해 이전 콜백을 차단합니다.
  session = null;

  for (const unsubscribe of cleanups) {
    unsubscribe();
  }

  cleanups = [];
  clearInterval(timerId);
  timerId = null;

  finishStroke();
  setDrawingEnabled(false);

  hostScreen.hidden = true;
  studentScreen.hidden = true;
  lobbyScreens.hidden = false;
}

export function watchGameScreen({
  roomCode,
  role,
  studentNumber = null
}) {
  if (role !== "host" && role !== "player") {
    throw new Error("게임 화면 역할이 올바르지 않습니다.");
  }

  stopWatching();

  const nextSession = {
    roomCode,
    role,
    studentNumber,
    meta: null,
    game: null,
    offset: null,
    connected: false,
    hasShownGame: false,
    errors: {
      meta: null,
      game: null,
      clock: null,
      connection: null
    }
  };

  session = nextSession;
  canvasStepKey = null;

  clearCanvas();
  selectTool("pen");

  setText(hostRoomCode, roomCode);
  setText(studentRoomCode, roomCode);
  setText(studentNumberElement, studentNumber ?? "");

  setText(hostStep, "-");
  setText(studentStep, "-");
  setText(hostPlayerCount, "-");
  setText(hostPhase, "-");
  showTimer(null);

  function listen(path, errorKey, applyValue, errorMessage) {
    const unsubscribe = onValue(
      ref(db, path),
      (snapshot) => {
        if (session !== nextSession) {
          return;
        }

        nextSession.errors[errorKey] = null;
        applyValue(snapshot.val());
        render();
      },
      (error) => {
        if (session !== nextSession) {
          return;
        }

        console.error(`${path} 읽기 실패:`, error);
        nextSession.errors[errorKey] = errorMessage;

        // 게임 시작 전 오류도 기존 화면에서 확인할 수 있습니다.
        const notice = document.getElementById(
          role === "host" ? "appStatus" : "joinStatus"
        );
        setText(notice, errorMessage);

        render();
      }
    );

    cleanups.push(unsubscribe);
  }

  listen(
    `rooms/${roomCode}/meta`,
    "meta",
    (value) => {
      nextSession.meta = value;
    },
    "방 정보를 읽지 못했습니다. 연결과 읽기 권한을 확인해 주세요."
  );

  listen(
    `rooms/${roomCode}/game`,
    "game",
    (value) => {
      nextSession.game = value;
    },
    "게임 정보를 읽지 못했습니다. 연결과 읽기 권한을 확인해 주세요."
  );

  listen(
    ".info/serverTimeOffset",
    "clock",
    (value) => {
      nextSession.offset =
        typeof value === "number" && Number.isFinite(value)
          ? value
          : null;
    },
    "서버 시간 정보를 읽지 못했습니다."
  );

  listen(
    ".info/connected",
    "connection",
    (value) => {
      nextSession.connected = value === true;
    },
    "서버 연결 상태를 확인하지 못했습니다."
  );

  timerId = setInterval(render, 200);
  render();
}

setDrawingEnabled(false);
clearCanvas();