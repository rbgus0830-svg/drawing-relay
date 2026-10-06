import {
  db,
  ref,
  set,
  get,
  update,
  runTransaction,
  onValue,
  serverTimestamp
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
const studentNumberElement =
  document.getElementById("studentGameNumber");
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
// 설정 및 상태
// ========================================
const MAX_IMAGE_DATA_URL_LENGTH = 2000000;
const RETRY_INTERVAL_MS = 3000;
const IMAGE_LOAD_TIMEOUT_MS = 15000;

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
  if (!element) return;

  const text = String(value);
  if (element.textContent !== text) {
    element.textContent = text;
  }
}

function setStatus(message) {
  if (!session) return;

  setText(
    session.role === "host" ? hostStatus : studentStatus,
    message
  );
}

function setDrawingEnabled(enabled) {
  tools.disabled = !enabled;
  canvas.classList.toggle("is-locked", !enabled);

  if (!enabled) finishStroke();
}

function formatTime(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutesText = String(Math.floor(seconds / 60))
    .padStart(2, "0");
  const secondsText = String(seconds % 60).padStart(2, "0");

  return `${minutesText}:${secondsText}`;
}

function showTimer(milliseconds) {
  const ready = Number.isFinite(milliseconds);
  const text = ready ? formatTime(milliseconds) : "--:--";

  for (const timer of [hostTimer, studentTimer]) {
    setText(timer, text);
    timer.parentElement.classList.toggle(
      "is-warning",
      ready && milliseconds <= 10000
    );
  }
}

function serverNow(currentSession = session) {
  if (!Number.isFinite(currentSession?.offset)) return null;
  return Date.now() + currentSession.offset;
}

function remainingTime() {
  const now = serverNow();

  if (
    now === null ||
    !Number.isFinite(session?.game?.stepEndsAt)
  ) {
    return null;
  }

  return Math.max(0, session.game.stepEndsAt - now);
}

function getCanvasStepKey(currentSession, game) {
  return [
    currentSession.roomCode,
    currentSession.studentNumber,
    game.currentStep,
    game.stepStartedAt
  ].join(":");
}

function getHostStepKey(game) {
  return `${game.currentStep}:${game.stepStartedAt}`;
}

// ========================================
// ゲームデータ検証
// ========================================
function getValidatedGame() {
  const meta = session?.meta;
  const game = session?.game;

  if (!meta || !game || typeof game !== "object") return null;

  if (
    !Number.isInteger(meta.relaySteps) ||
    meta.relaySteps < 1 ||
    meta.relaySteps > 20 ||
    !Number.isInteger(meta.stepDurationMs) ||
    meta.stepDurationMs < 1000 ||
    !Number.isInteger(game.currentStep) ||
    game.currentStep < 1 ||
    game.currentStep > meta.relaySteps ||
    !["DRAWING", "FINISHED"].includes(game.phase) ||
    !Number.isInteger(game.playerCount) ||
    game.playerCount < 2 ||
    game.playerCount > meta.maxPlayers ||
    !Number.isFinite(game.stepStartedAt) ||
    !Number.isFinite(game.stepEndsAt) ||
    game.stepEndsAt !==
      game.stepStartedAt + meta.stepDurationMs ||
    !game.order ||
    typeof game.order !== "object"
  ) {
    return null;
  }

  const entries = Object.entries(game.order);
  if (entries.length !== game.playerCount) return null;

  entries.sort((a, b) => Number(a[0]) - Number(b[0]));

  const order = [];

  for (let index = 0; index < entries.length; index += 1) {
    const [key, number] = entries[index];

    if (
      key !== String(index) ||
      typeof number !== "string" ||
      !/^(0[1-9]|[12][0-9]|30)$/.test(number)
    ) {
      return null;
    }

    order.push(number);
  }

  if (new Set(order).size !== order.length) return null;

  return { game, order };
}

function validSubmission(value, orderIndex) {
  return Boolean(
    value &&
    typeof value === "object" &&
    value.orderIndex === orderIndex &&
    Number.isFinite(value.submittedAt) &&
    typeof value.image === "string" &&
    value.image.startsWith("data:image/png;base64,") &&
    value.image.length <= MAX_IMAGE_DATA_URL_LENGTH
  );
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

  if (!validated) return false;

  const stepKey = getCanvasStepKey(session, validated.game);

  return Boolean(
    validated.game.phase === "DRAWING" &&
    validated.order.includes(session.studentNumber) &&
    canvasStepKey === stepKey &&
    session.preparation?.key === stepKey &&
    session.preparation.ready &&
    session.submission?.key !== stepKey &&
    remaining !== null &&
    remaining > 0
  );
}

// ========================================
// 前段階の画像読み込み・提出済み画像の復元
// ========================================
function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    const timeoutId = setTimeout(() => {
      image.onload = null;
      image.onerror = null;
      reject(new Error("画像読み込みがタイムアウトしました。"));
    }, IMAGE_LOAD_TIMEOUT_MS);

    image.onload = () => {
      clearTimeout(timeoutId);
      image.onload = null;
      image.onerror = null;
      resolve(image);
    };

    image.onerror = () => {
      clearTimeout(timeoutId);
      image.onload = null;
      image.onerror = null;
      reject(new Error("画像を読み込めませんでした。"));
    };

    image.src = dataUrl;
  });
}

async function prepareCanvas(currentSession, validated) {
  const { game, order } = validated;
  const key = getCanvasStepKey(currentSession, game);

  let preparation = currentSession.preparation;

  if (!preparation || preparation.key !== key) {
    finishStroke();
    setDrawingEnabled(false);

    canvasStepKey = null;
    currentSession.submission = null;
    clearCanvas();

    preparation = {
      key,
      ready: false,
      loading: false,
      error: null,
      nextRetryAt: 0
    };

    currentSession.preparation = preparation;
  }

  if (
    preparation.ready ||
    preparation.loading ||
    Date.now() < preparation.nextRetryAt
  ) {
    return;
  }

  preparation.loading = true;
  preparation.error = null;

  function stillCurrent() {
    return (
      session === currentSession &&
      currentSession.meta?.status === "PLAYING" &&
      currentSession.game?.phase === "DRAWING" &&
      currentSession.preparation === preparation &&
      getCanvasStepKey(currentSession, currentSession.game) === key
    );
  }

  try {
    const myIndex = order.indexOf(currentSession.studentNumber);

    if (myIndex < 0) {
      throw new Error("참가자 순서에 없는 학생입니다.");
    }

    // 새로고침 전에 이미 제출했다면 같은 그림을 복원합니다.
    const ownSnapshot = await get(
      ref(
        db,
        `rooms/${currentSession.roomCode}/submissions/` +
        `${game.currentStep}/${currentSession.studentNumber}`
      )
    );

    if (!stillCurrent()) return;

    const ownSubmission = ownSnapshot.val();
    let imageUrl = null;

    if (ownSnapshot.exists()) {
      if (!validSubmission(ownSubmission, myIndex)) {
        throw new Error("기존 제출 데이터가 올바르지 않습니다.");
      }

      imageUrl = ownSubmission.image;
    } else if (game.currentStep > 1) {
      // 순서가 01 → 03 → 05이면 03은 01의 그림을 받습니다.
      const previousIndex =
        (myIndex - 1 + order.length) % order.length;
      const previousNumber = order[previousIndex];

      // 학생은 단계 전체가 아닌 개별 제출 경로를 읽어야 합니다.
      const previousSnapshot = await get(
        ref(
          db,
          `rooms/${currentSession.roomCode}/submissions/` +
          `${game.currentStep - 1}/${previousNumber}`
        )
      );

      if (!stillCurrent()) return;

      const previousSubmission = previousSnapshot.val();

      if (!validSubmission(previousSubmission, previousIndex)) {
        throw new Error("전달받을 그림이 없거나 올바르지 않습니다.");
      }

      imageUrl = previousSubmission.image;
    }

    const image = imageUrl ? await loadImage(imageUrl) : null;

    if (!stillCurrent()) return;

    clearCanvas();

    if (image) {
      context.save();
      context.globalCompositeOperation = "source-over";
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      context.restore();
    }

    if (ownSnapshot.exists()) {
      currentSession.submission = {
        key,
        step: game.currentStep,
        orderIndex: myIndex,
        image: ownSubmission.image,
        saved: true,
        saving: false,
        error: null,
        nextRetryAt: 0,
        fatal: false
      };
    }

    canvasStepKey = key;
    preparation.ready = true;
    preparation.error = null;
  } catch (error) {
    if (!stillCurrent()) return;

    console.error("그림 준비 실패:", error);

    preparation.error =
      "그림을 불러오지 못했습니다. 연결·읽기 규칙을 확인해 주세요. " +
      "3초 간격으로 재시도합니다.";

    preparation.nextRetryAt = Date.now() + RETRY_INTERVAL_MS;
  } finally {
    preparation.loading = false;

    if (stillCurrent()) render();
  }
}

// ========================================
// 時間終了後の自動提出
// ========================================
function getSubmissionMessage() {
  const submission = session?.submission;

  if (!submission) {
    return "시간이 종료되었습니다. 그림 저장을 준비하고 있습니다.";
  }

  if (submission.saved) {
    return "그림이 저장되었습니다. 다른 참가자의 제출을 기다리고 있습니다.";
  }

  if (submission.saving) {
    return "시간이 종료되었습니다. 그림을 저장하는 중입니다.";
  }

  return submission.error ||
    "시간이 종료되었습니다. 그림 저장을 준비하고 있습니다.";
}

async function submitExpiredDrawing() {
  const currentSession = session;

  if (
    !currentSession ||
    currentSession.role !== "player" ||
    !context ||
    currentSession.meta?.status !== "PLAYING" ||
    currentSession.connected !== true ||
    Object.values(currentSession.errors).some(Boolean)
  ) {
    return;
  }

  const validated = getValidatedGame();
  const remaining = remainingTime();

  if (
    !validated ||
    validated.game.phase !== "DRAWING" ||
    remaining === null
  ) {
    return;
  }

  const { game, order } = validated;
  const orderIndex = order.indexOf(currentSession.studentNumber);
  const key = getCanvasStepKey(currentSession, game);

  if (
    orderIndex < 0 ||
    canvasStepKey !== key ||
    !currentSession.preparation?.ready
  ) {
    return;
  }

  let submission = currentSession.submission;

  if (!submission || submission.key !== key) {
    if (remaining > 0) return;

    finishStroke();

    submission = {
      key,
      step: game.currentStep,
      orderIndex,
      image: null,
      saved: false,
      saving: false,
      error: null,
      nextRetryAt: 0,
      fatal: false
    };

    currentSession.submission = submission;

    try {
      // 재시도 시에도 처음 추출한 이미지를 그대로 보냅니다.
      submission.image = canvas.toDataURL("image/png");

      if (
        !submission.image.startsWith("data:image/png;base64,") ||
        submission.image.length > MAX_IMAGE_DATA_URL_LENGTH
      ) {
        throw new Error("이미지가 PNG 형식 또는 크기 제한을 충족하지 않습니다.");
      }
    } catch (error) {
      console.error("이미지 생성 실패:", error);
      submission.fatal = true;
      submission.error =
        "그림을 저장할 수 없습니다. 이미지 크기 제한 또는 콘솔 오류를 확인해 주세요.";
      return;
    }
  }

  if (
    submission.saved ||
    submission.saving ||
    submission.fatal ||
    Date.now() < submission.nextRetryAt
  ) {
    return;
  }

  submission.saving = true;
  submission.error = null;

  function stillCurrent() {
    return (
      session === currentSession &&
      currentSession.submission === submission &&
      canvasStepKey === submission.key
    );
  }

  try {
    await set(
      ref(
        db,
        `rooms/${currentSession.roomCode}/submissions/` +
        `${submission.step}/${currentSession.studentNumber}`
      ),
      {
        image: submission.image,
        orderIndex: submission.orderIndex,
        submittedAt: serverTimestamp()
      }
    );

    if (!stillCurrent()) return;

    submission.saved = true;
    submission.error = null;
  } catch (error) {
    if (!stillCurrent()) return;

    console.error("그림 저장 실패:", error);

    submission.error =
      "그림 저장에 실패했습니다. 연결·규칙을 확인해 주세요. " +
      "3초 간격으로 재시도합니다.";

    submission.nextRetryAt = Date.now() + RETRY_INTERVAL_MS;
  } finally {
    submission.saving = false;

    if (stillCurrent()) render();
  }
}

// ========================================
// ホスト：提出監視と自動段階移行
// ========================================
function stopHostSubmissionWatch(currentSession) {
  const watch = currentSession?.hostWatch;
  if (!watch) return;

  currentSession.hostWatch = null;
  watch.unsubscribe?.();
}

function syncHostSubmissionWatch(currentSession, game) {
  const key = getHostStepKey(game);

  if (currentSession.hostWatch?.key === key) return;

  stopHostSubmissionWatch(currentSession);

  const watch = {
    key,
    submissions: {},
    loaded: false,
    error: null,
    unsubscribe: null
  };

  currentSession.hostWatch = watch;
  currentSession.advanceError = null;
  currentSession.advanceRetryAt = 0;

  watch.unsubscribe = onValue(
    ref(
      db,
      `rooms/${currentSession.roomCode}/submissions/${game.currentStep}`
    ),
    (snapshot) => {
      if (
        session !== currentSession ||
        currentSession.hostWatch !== watch
      ) {
        return;
      }

      watch.submissions = snapshot.val() || {};
      watch.loaded = true;
      watch.error = null;
      render();
    },
    (error) => {
      if (
        session !== currentSession ||
        currentSession.hostWatch !== watch
      ) {
        return;
      }

      console.error("제출 목록 읽기 실패:", error);
      watch.error =
        "제출 목록을 읽지 못했습니다. 규칙을 확인한 뒤 방장 화면을 다시 열어 주세요.";
      render();
    }
  );
}

function getSubmittedCount(watch, order) {
  if (!watch?.loaded) return 0;

  return order.filter((number, index) =>
    validSubmission(watch.submissions[number], index)
  ).length;
}

async function advanceIfReady() {
  const currentSession = session;

  if (
    !currentSession ||
    currentSession.role !== "host" ||
    currentSession.meta?.status !== "PLAYING" ||
    currentSession.connected !== true ||
    currentSession.advancing ||
    Date.now() < currentSession.advanceRetryAt ||
    Object.values(currentSession.errors).some(Boolean)
  ) {
    return;
  }

  const validated = getValidatedGame();
  const remaining = remainingTime();

  if (
    !validated ||
    validated.game.phase !== "DRAWING" ||
    remaining === null ||
    remaining > 0
  ) {
    return;
  }

  const { game, order } = validated;
  const watch = currentSession.hostWatch;

  if (
    !watch ||
    watch.key !== getHostStepKey(game) ||
    watch.error ||
    !watch.loaded ||
    getSubmittedCount(watch, order) !== order.length
  ) {
    return;
  }

  currentSession.advancing = true;
  currentSession.advanceError = null;

  const expectedStep = game.currentStep;
  const expectedStartedAt = game.stepStartedAt;
  const duration = currentSession.meta.stepDurationMs;
  const totalSteps = currentSession.meta.relaySteps;
  const roomPath = `rooms/${currentSession.roomCode}`;

  try {
    if (expectedStep === totalSteps) {
      // 最終段階：両方を一度の更新で終了させます。
      await update(ref(db, roomPath), {
        "game/phase": "FINISHED",
        "meta/status": "FINISHED"
      });
    } else {
      const nextStartedAt = Math.max(
        Math.ceil(serverNow(currentSession)),
        game.stepEndsAt
      );

      // game だけをトランザクション対象にします。
      // 他のホストタブが先に進めた場合は更新を中止します。
      await runTransaction(
        ref(db, `${roomPath}/game`),
        (currentGame) => {
          if (
            session !== currentSession ||
            currentSession.meta?.status !== "PLAYING" ||
            !currentGame ||
            currentGame.phase !== "DRAWING" ||
            currentGame.currentStep !== expectedStep ||
            currentGame.stepStartedAt !== expectedStartedAt
          ) {
            return;
          }

          return {
            ...currentGame,
            currentStep: expectedStep + 1,
            stepStartedAt: nextStartedAt,
            stepEndsAt: nextStartedAt + duration
          };
        },
        {
          applyLocally: false
        }
      );
    }

    if (session === currentSession) {
      // 구독 결과가 도착하기 전 같은 요청을 반복하지 않도록 합니다.
      currentSession.advanceRetryAt = Date.now() + RETRY_INTERVAL_MS;
    }
  } catch (error) {
    if (session !== currentSession) return;

    // 다른 방장 탭이 이미 완료했는지 다시 확인합니다.
    try {
      const latest = await get(ref(db, `${roomPath}/game`));

      if (session !== currentSession) return;

      const latestGame = latest.val();
      const alreadyAdvanced = latestGame && (
        latestGame.phase === "FINISHED" ||
        latestGame.currentStep > expectedStep
      );

      if (!alreadyAdvanced) {
        throw error;
      }
    } catch (checkError) {
      if (session !== currentSession) return;

      console.error("단계 전환 실패:", checkError);

      currentSession.advanceError =
        "단계 전환에 실패했습니다. 연결·쓰기 규칙을 확인해 주세요. " +
        "3초 간격으로 재시도합니다.";
    }

    currentSession.advanceRetryAt = Date.now() + RETRY_INTERVAL_MS;
  } finally {
    if (session === currentSession) {
      currentSession.advancing = false;
      render();
    }
  }
}

// ========================================
// 画面描画
// ========================================
function render() {
  if (!session) return;

  const currentSession = session;
  const status = currentSession.meta?.status;

  if (status === "LOBBY") {
    lobbyScreens.hidden = false;
    hostScreen.hidden = true;
    studentScreen.hidden = true;
    currentSession.hasShownGame = false;
    stopHostSubmissionWatch(currentSession);
    setDrawingEnabled(false);
    return;
  }

  if (
    status !== "PLAYING" &&
    status !== "FINISHED" &&
    !currentSession.hasShownGame
  ) {
    setDrawingEnabled(false);
    return;
  }

  currentSession.hasShownGame = true;
  lobbyScreens.hidden = true;
  hostScreen.hidden = currentSession.role !== "host";
  studentScreen.hidden = currentSession.role !== "player";

  const error = Object.values(currentSession.errors).find(Boolean);

  if (error) {
    setDrawingEnabled(false);
    showTimer(null);
    setStatus(error);
    return;
  }

  // meta와 game 구독 콜백의 도착 순서는 다를 수 있습니다.
  if (
    status === "FINISHED" ||
    currentSession.game?.phase === "FINISHED"
  ) {
    stopHostSubmissionWatch(currentSession);
    setDrawingEnabled(false);
    showTimer(0);
    setText(hostPhase, "종료");
    setStatus("모든 단계가 끝났습니다. 그림 릴레이가 종료되었습니다.");
    return;
  }

  if (status !== "PLAYING") {
    setDrawingEnabled(false);
    showTimer(null);
    setStatus("게임 진행 상태를 확인하는 중입니다.");
    return;
  }

  const validated = getValidatedGame();

  if (!validated) {
    setDrawingEnabled(false);
    showTimer(null);
    setStatus("게임 데이터를 기다리는 중입니다.");
    return;
  }

  const { game, order } = validated;
  const stepLabel =
    `${game.currentStep} / ${currentSession.meta.relaySteps}`;

  setText(hostStep, stepLabel);
  setText(studentStep, stepLabel);
  setText(hostPlayerCount, `${game.playerCount}명`);
  setText(hostPhase, "그리기");

  if (
    currentSession.role === "player" &&
    !order.includes(currentSession.studentNumber)
  ) {
    setDrawingEnabled(false);
    showTimer(null);
    setStatus("이번 게임의 시작 참가자 목록에 포함되어 있지 않습니다.");
    return;
  }

  const remaining = remainingTime();
  showTimer(remaining);

  if (currentSession.connected !== true) {
    setDrawingEnabled(false);
    setStatus("서버 연결이 끊겼습니다. 재연결될 때까지 입력을 잠급니다.");
    return;
  }

  if (remaining === null) {
    setDrawingEnabled(false);
    setStatus("서버 시간 정보를 확인하는 중입니다.");
    return;
  }

  if (currentSession.role === "host") {
    setDrawingEnabled(false);
    syncHostSubmissionWatch(currentSession, game);

    const watch = currentSession.hostWatch;
    const count = getSubmittedCount(watch, order);

    if (watch?.error) {
      setStatus(watch.error);
    } else if (currentSession.advanceError) {
      setStatus(currentSession.advanceError);
    } else if (currentSession.advancing) {
      setStatus(
        game.currentStep === currentSession.meta.relaySteps
          ? "모든 그림이 제출되었습니다. 게임을 종료하는 중입니다."
          : "모든 그림이 제출되었습니다. 다음 단계로 이동하는 중입니다."
      );
    } else if (remaining <= 0) {
      setStatus(
        `그림 제출을 기다리고 있습니다. ${count} / ${order.length}명`
      );
    } else {
      setStatus("학생들이 그림을 그리고 있습니다.");
    }

    void advanceIfReady();
    return;
  }

  if (!context) {
    setDrawingEnabled(false);
    setStatus("이 브라우저에서는 그림판을 사용할 수 없습니다.");
    return;
  }

  const key = getCanvasStepKey(currentSession, game);

  if (
    currentSession.preparation?.key !== key ||
    !currentSession.preparation.ready ||
    canvasStepKey !== key
  ) {
    setDrawingEnabled(false);
    void prepareCanvas(currentSession, validated);

    setStatus(
      currentSession.preparation?.error ||
      (game.currentStep === 1
        ? "그림판을 준비하는 중입니다."
        : "이전 참가자의 그림을 불러오는 중입니다.")
    );
    return;
  }

  const hasSubmission =
    currentSession.submission?.key === key;

  if (remaining <= 0 || hasSubmission) {
    setDrawingEnabled(false);
    void submitExpiredDrawing();
    setStatus(getSubmissionMessage());
    return;
  }

  setDrawingEnabled(canDrawNow());

  setStatus(
    game.currentStep === 1
      ? "그림을 그려 주세요. 시간이 끝나면 자동으로 저장합니다."
      : "전달받은 그림에 이어 그려 주세요. 시간이 끝나면 자동으로 저장합니다."
  );
}

// ========================================
// キャンバス
// ========================================
function clearCanvas() {
  if (!context) return;

  context.save();
  context.globalCompositeOperation = "source-over";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.restore();
}

function getPoint(event) {
  const rectangle = canvas.getBoundingClientRect();

  if (!rectangle.width || !rectangle.height) return null;

  return {
    x: (event.clientX - rectangle.left) *
      (canvas.width / rectangle.width),
    y: (event.clientY - rectangle.top) *
      (canvas.height / rectangle.height)
  };
}

function applyBrush() {
  context.globalCompositeOperation = "source-over";
  context.strokeStyle =
    selectedTool === "eraser" ? "#ffffff" : penColor.value;
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

  if (pointerId === null) return;

  try {
    if (canvas.hasPointerCapture(pointerId)) {
      canvas.releasePointerCapture(pointerId);
    }
  } catch {
    // 이미 해제된 포인터는 무시합니다.
  }
}

function selectTool(tool) {
  finishStroke();
  selectedTool = tool;

  penButton.setAttribute("aria-pressed", String(tool === "pen"));
  eraserButton.setAttribute(
    "aria-pressed",
    String(tool === "eraser")
  );
}

// ========================================
// 그림판 이벤트
// ========================================
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
  if (!point) return;

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
  if (event.pointerId !== activePointerId) return;

  if (!canDrawNow()) {
    finishStroke();
    render();
    return;
  }

  event.preventDefault();

  const point = getPoint(event);
  if (!point || !previousPoint) return;

  drawLine(previousPoint, point);
  previousPoint = point;
});

function endPointer(event) {
  if (event.pointerId === activePointerId) finishStroke();
}

canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("lostpointercapture", endPointer);
canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

penButton.addEventListener("click", () => selectTool("pen"));
eraserButton.addEventListener("click", () => selectTool("eraser"));
penColor.addEventListener("input", () => selectTool("pen"));

penWidth.addEventListener("input", () => {
  setText(penWidthValue, penWidth.value);
});

clearButton.addEventListener("click", () => {
  if (!canDrawNow()) return;

  finishStroke();

  if (!window.confirm("전달받은 그림을 포함해 현재 그림을 모두 지울까요?")) {
    return;
  }

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
// 구독 시작 및 정리
// ========================================
function stopWatching() {
  const oldSession = session;

  // 이전 비동기 작업이 새 화면을 변경하지 못하도록 합니다.
  session = null;

  stopHostSubmissionWatch(oldSession);

  for (const unsubscribe of cleanups) unsubscribe();
  cleanups = [];

  clearInterval(timerId);
  timerId = null;

  canvasStepKey = null;
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

    preparation: null,
    submission: null,

    hostWatch: null,
    advancing: false,
    advanceError: null,
    advanceRetryAt: 0,

    errors: {
      meta: null,
      game: null,
      clock: null,
      connection: null
    }
  };

  session = nextSession;

  clearCanvas();
  selectTool("pen");

  setText(hostRoomCode, roomCode);
  setText(studentRoomCode, roomCode);
  setText(studentNumberElement, studentNumber ?? "");
  setText(hostStep, "-");
  setText(studentStep, "-");
  setText(hostPlayerCount, "-");
  setText(hostPhase, "-");
  setText(penWidthValue, penWidth.value);
  showTimer(null);

  function listen(path, errorKey, applyValue, errorMessage) {
    const unsubscribe = onValue(
      ref(db, path),
      (snapshot) => {
        if (session !== nextSession) return;

        nextSession.errors[errorKey] = null;
        applyValue(snapshot.val());
        render();
      },
      (error) => {
        if (session !== nextSession) return;

        console.error(`${path} 읽기 실패:`, error);
        nextSession.errors[errorKey] = errorMessage;

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
      nextSession.offset = Number.isFinite(value) ? value : null;
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

// ========================================
// 초기 상태
// ========================================
setDrawingEnabled(false);
clearCanvas();