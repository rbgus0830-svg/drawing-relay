import {
  loginAnonymously,
  db,
  ref,
  set,
  get,
  update,
  onValue,
  onDisconnect,
  serverTimestamp
} from "./js/firebase.js";

// ========================================
// 방 생성 화면
// ========================================

const classGameBtn =
  document.getElementById("classGameBtn");

const groupGameBtn =
  document.getElementById("groupGameBtn");

const appStatus =
  document.getElementById("appStatus");

const roomResult =
  document.getElementById("roomResult");

const roomCodeElement =
  document.getElementById("roomCode");

const roomLinkElement =
  document.getElementById("roomLink");

// ========================================
// 방장 대기실
// ========================================

const hostLobby =
  document.getElementById("hostLobby");

const playerCount =
  document.getElementById("playerCount");

const hostLobbyStatus =
  document.getElementById("hostLobbyStatus");

const startGameBtn =
  document.getElementById("startGameBtn");

const playerList =
  document.getElementById("playerList");

// ========================================
// 방 참가 화면
// ========================================

const joinRoomCodeInput =
  document.getElementById("joinRoomCode");

const studentNumberInput =
  document.getElementById("studentNumber");

const joinRoomBtn =
  document.getElementById("joinRoomBtn");

const joinStatus =
  document.getElementById("joinStatus");

const joinedRoomResult =
  document.getElementById("joinedRoomResult");

const joinedRoomCode =
  document.getElementById("joinedRoomCode");

const joinedStudentNumber =
  document.getElementById("joinedStudentNumber");

const joinedRoomType =
  document.getElementById("joinedRoomType");

// ========================================
// 설정값
// ========================================

const ROOM_CODE_CHARACTERS =
  "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const ROOM_CODE_PATTERN =
  /^[A-HJ-NP-Z2-9]{4}$/;

const STUDENT_NUMBER_PATTERN =
  /^(0[1-9]|[1-3][0-9]|40)$/;

const MAX_CREATE_ATTEMPTS = 5;

// ========================================
// 앱 상태
// ========================================

let currentUser = null;
let isCreatingRoom = false;
let isJoiningRoom = false;
let isStartingGame = false;
let currentHostRoomCode = null;
let currentHostLobbyNotice = null;
let stopRoomStatusListener = null;
let stopPlayerStatusListener = null;
let currentHostRoomStatus = null;
let currentHostPlayerCount = 0;
let currentHostMaxPlayers = 0;
let playerPresenceSession = 0;
let playerPresenceCallbackGeneration = 0;
let playerPresenceTransition = Promise.resolve();

// 현재 감시 중인 대기실의 구독 해제 함수
let stopHostLobbyListener = null;

// 학생 접속 상태 감시 및 연결 종료 예약
let stopPlayerPresenceListener = null;
let playerPresenceDisconnect = null;
let activePlayerConnectedRef = null;

// ========================================
// 공통 함수
// ========================================

function generateRoomCode() {
  let roomCode = "";

  for (
    let index = 0;
    index < 4;
    index += 1
  ) {
    const randomIndex = Math.floor(
      Math.random() *
      ROOM_CODE_CHARACTERS.length
    );

    roomCode +=
      ROOM_CODE_CHARACTERS[randomIndex];
  }

  return roomCode;
}

function createInvitationUrl(roomCode) {
  const invitationUrl =
    new URL(window.location.href);

  invitationUrl.searchParams.set(
    "room",
    roomCode
  );

  return invitationUrl.toString();
}

function setCreateButtonsDisabled(disabled) {
  classGameBtn.disabled = disabled;
  groupGameBtn.disabled = disabled;
}

function showCreatedRoom(roomCode) {
  const invitationUrl =
    createInvitationUrl(roomCode);

  roomCodeElement.textContent = roomCode;
  roomLinkElement.textContent = invitationUrl;
  roomLinkElement.href = invitationUrl;
  roomResult.hidden = false;
}

function readRoomCodeFromUrl() {
  const url =
    new URL(window.location.href);

  const roomCode =
    url.searchParams.get("room");

  if (!roomCode) {
    return;
  }

  const normalizedRoomCode =
    roomCode
      .trim()
      .toUpperCase();

  if (
    ROOM_CODE_PATTERN.test(
      normalizedRoomCode
    )
  ) {
    joinRoomCodeInput.value =
      normalizedRoomCode;
  }
}

function normalizeStudentNumber(value) {
  const digitsOnly = String(value ?? "")
    .replace(/\D/g, "")
    .slice(0, 2);

  if (digitsOnly.length === 1) {
    return digitsOnly.padStart(2, "0");
  }

  return digitsOnly;
}

function showJoinedRoom(
  roomCode,
  studentNumber,
  roomType
) {
  joinedRoomCode.textContent = roomCode;

  joinedStudentNumber.textContent =
    studentNumber;

  joinedRoomType.textContent =
    roomType === "class"
      ? "학급 게임에 참가했습니다."
      : "모둠 게임에 참가했습니다.";

  joinedRoomResult.hidden = false;
}

function watchRoomStatus(roomCode, role) {
  const statusRef = ref(db, `rooms/${roomCode}/meta/status`);
  const listener = onValue(statusRef, (snapshot) => {
    const status = snapshot.val();
    if (status === "PLAYING") {
      if (role === "host") {
        currentHostRoomStatus = status;
        currentHostLobbyNotice = null;
        renderHostLobbyStatus();
      } else {
        joinStatus.textContent = "게임이 시작되었습니다.";
      }
    } else if (status === "LOBBY") {
      if (role === "host") {
        currentHostRoomStatus = status;
        renderHostLobbyStatus();
      }
    } else {
      const message = "방 상태를 확인할 수 없습니다.";
      if (role === "host") {
        currentHostRoomStatus = null;
        currentHostLobbyNotice = message;
        renderHostLobbyStatus();
      }
      else joinStatus.textContent = message;
    }
  }, (error) => {
    const message = isPermissionDeniedError(error)
      ? "방 상태를 읽을 권한이 없습니다."
      : "방 상태를 불러오지 못했습니다.";
    if (role === "host") {
      currentHostRoomStatus = null;
      currentHostLobbyNotice = message;
      renderHostLobbyStatus();
    }
    else joinStatus.textContent = message;
  });
  return listener;
}

function renderHostLobbyStatus() {
  syncStartGameButton();
  if (currentHostRoomStatus === "PLAYING") {
    hostLobbyStatus.textContent = "게임이 시작되었습니다.";
    return;
  }
  if (currentHostLobbyNotice) {
    hostLobbyStatus.textContent = currentHostLobbyNotice;
    return;
  }
  if (currentHostPlayerCount === 0) {
    hostLobbyStatus.textContent = "학생의 참가를 기다리고 있습니다.";
  } else if (currentHostPlayerCount >= currentHostMaxPlayers) {
    hostLobbyStatus.textContent = "참가 인원이 모두 찼습니다.";
  } else {
    hostLobbyStatus.textContent = `${currentHostPlayerCount}명이 참가했습니다.`;
  }
}

function syncStartGameButton() {
  startGameBtn.disabled = currentHostRoomStatus !== "LOBBY" || isStartingGame;
}

async function startGame() {
  if (!currentUser || !currentHostRoomCode || isStartingGame) return;
  isStartingGame = true;
  currentHostLobbyNotice = "게임을 시작하는 중입니다...";
  renderHostLobbyStatus();
  const roomCode = currentHostRoomCode;
  try {
    const [hostSnapshot, metaSnapshot, playersSnapshot] = await Promise.all([
      get(ref(db, `rooms/${roomCode}/hostUid`)),
      get(ref(db, `rooms/${roomCode}/meta`)),
      get(ref(db, `rooms/${roomCode}/players`))
    ]);
    const hostUid = hostSnapshot.val();
    const roomMeta = metaSnapshot.val();
    if (!hostSnapshot.exists() || !metaSnapshot.exists() || hostUid !== currentUser.uid || roomMeta.status !== "LOBBY") {
      if (currentHostRoomCode === roomCode) {
        currentHostLobbyNotice = "이미 시작되었거나 시작할 수 없는 방입니다.";
        renderHostLobbyStatus();
      }
      return;
    }
    const maxPlayers = Number(roomMeta.maxPlayers);
    const expectedMax = roomMeta.type === "class" ? 30 : roomMeta.type === "group" ? 5 : 0;
    if (!expectedMax || !Number.isInteger(maxPlayers) || maxPlayers !== expectedMax) {
      if (currentHostRoomCode === roomCode) {
        currentHostLobbyNotice = "방 설정이 올바르지 않아 게임을 시작할 수 없습니다.";
        renderHostLobbyStatus();
      }
      return;
    }
    const stepDurationMs = Number(roomMeta.stepDurationMs);
    if (!Number.isFinite(stepDurationMs) || stepDurationMs < 1000 || stepDurationMs > 3600000) {
      if (currentHostRoomCode === roomCode) {
        currentHostLobbyNotice = "게임 시간 설정이 올바르지 않습니다.";
        renderHostLobbyStatus();
      }
      return;
    }
    const seenNumbers = new Set();
    const connectedPlayers = Object.entries(playersSnapshot.val() ?? {})
      .filter(([key, player]) => {
        const studentNumber = player?.number;
        if (!player || player.connected !== true || typeof studentNumber !== "string" || key !== studentNumber || !STUDENT_NUMBER_PATTERN.test(studentNumber) || !isStudentNumberAllowed(roomMeta.type, studentNumber) || seenNumbers.has(studentNumber)) return false;
        seenNumbers.add(studentNumber);
        return true;
      })
      .map(([, player]) => player)
      .sort((first, second) => first.number.localeCompare(second.number));
    if (connectedPlayers.length < 2) {
      if (currentHostRoomCode === roomCode) {
        currentHostLobbyNotice = "게임 시작에는 연결된 참가자가 2명 이상 필요합니다.";
        renderHostLobbyStatus();
      }
      return;
    }
    if (connectedPlayers.length > maxPlayers) {
      if (currentHostRoomCode === roomCode) {
        currentHostLobbyNotice = "참가 인원이 방 정원을 초과하여 게임을 시작할 수 없습니다.";
        renderHostLobbyStatus();
      }
      return;
    }
    const offsetSnapshot = await get(ref(db, ".info/serverTimeOffset"));
    if (currentHostRoomCode !== roomCode) return;
    const validOffset = Number(offsetSnapshot.val());
    const now = Math.round(Date.now() + (Number.isFinite(validOffset) ? validOffset : 0));
    const order = Object.fromEntries(connectedPlayers.map((player, index) => [String(index), player.number]));
    const gameData = {
      phase: "DRAWING",
      currentStep: 1,
      startedAt: now,
      stepStartedAt: now,
      stepEndsAt: now + stepDurationMs,
      playerCount: connectedPlayers.length,
      order
    };
    await update(ref(db, `rooms/${roomCode}`), {
      "meta/status": "PLAYING",
      game: gameData
    });
    if (currentHostRoomCode === roomCode) {
      currentHostRoomStatus = "PLAYING";
      currentHostLobbyNotice = null;
    }
  } catch (error) {
    console.error("게임 시작 실패:", error);
    if (currentHostRoomCode === roomCode) {
      currentHostLobbyNotice = isPermissionDeniedError(error)
        ? "게임 시작 권한이 없거나 참가자 상태가 변경되었습니다."
        : "게임을 시작하지 못했습니다.";
    }
  } finally {
    isStartingGame = false;
    if (currentHostRoomCode === roomCode) {
      renderHostLobbyStatus();
    } else {
      syncStartGameButton();
    }
  }
}

function isPermissionDeniedError(error) {
  const errorCode =
    String(error?.code ?? "")
      .toUpperCase();

  const errorMessage =
    String(error?.message ?? "")
      .toUpperCase();

  return (
    errorCode.includes("PERMISSION_DENIED") ||
    errorCode.includes("PERMISSION-DENIED") ||
    errorMessage.includes("PERMISSION_DENIED") ||
    errorMessage.includes("PERMISSION DENIED")
  );
}

function isStudentNumberAllowed(
  roomType,
  studentNumber
) {
  const studentNumberValue =
    Number(studentNumber);

  if (roomType === "class") {
    return (
      studentNumberValue >= 1 &&
      studentNumberValue <= 30
    );
  }

  if (roomType === "group") {
    return (
      studentNumberValue >= 1 &&
      studentNumberValue <= 5
    );
  }

  return false;
}

// ========================================
// 방장 실시간 대기실
// ========================================

function watchHostLobby(
  roomCode,
  maxPlayers
) {
  // 이전에 감시하던 방이 있으면
  // 구독을 해제합니다.
  if (stopHostLobbyListener) {
    stopHostLobbyListener();
    stopHostLobbyListener = null;
  }

  hostLobby.hidden = false;
  currentHostRoomCode = roomCode;
  currentHostMaxPlayers = maxPlayers;
  currentHostRoomStatus = null;
  currentHostPlayerCount = 0;
  currentHostLobbyNotice = null;
  stopRoomStatusListener?.();
  stopRoomStatusListener = watchRoomStatus(roomCode, "host");
  playerList.replaceChildren();

  playerCount.textContent =
    `0 / ${maxPlayers}`;

  renderHostLobbyStatus();

  const playersRef = ref(
    db,
    `rooms/${roomCode}/players`
  );

  stopHostLobbyListener = onValue(
    playersRef,
    (snapshot) => {
      const playersData =
        snapshot.val() ?? {};

      const players =
        Object.values(playersData)
          .filter((player) => {
            return (
              player &&
              typeof player.number === "string"
            );
          })
          .sort(
            (
              firstPlayer,
              secondPlayer
            ) => {
              return firstPlayer.number
                .localeCompare(
                  secondPlayer.number
                );
            }
          );

      playerList.replaceChildren();

      for (const player of players) {
        const listItem =
          document.createElement("li");

        listItem.textContent =
          `${player.number}번`;

        if (player.connected === false) {
          listItem.textContent +=
            " · 연결 끊김";
        }

        playerList.appendChild(listItem);
      }

      playerCount.textContent =
        `${players.length} / ${maxPlayers}`;
      currentHostPlayerCount = players.length;
      renderHostLobbyStatus();

      console.log(
        "대기실 참가자 갱신:",
        players
      );
    },
    (error) => {
      console.error(
        "대기실 참가자 목록 읽기 실패:",
        error
      );

      currentHostLobbyNotice = isPermissionDeniedError(error)
        ? "참가자 목록을 읽을 권한이 없습니다."
        : "참가자 목록을 불러오지 못했습니다.";
      renderHostLobbyStatus();
    }
  );
}

// ========================================
// 방 생성
// ========================================

async function createRoom(roomType) {
  if (!currentUser) {
    appStatus.textContent =
      "Firebase 인증이 완료되지 않아 방을 만들 수 없습니다.";
    return;
  }

  if (isCreatingRoom) {
    return;
  }

  isCreatingRoom = true;
  setCreateButtonsDisabled(true);

  roomResult.hidden = true;
  hostLobby.hidden = true;

  appStatus.textContent =
    "방을 만드는 중입니다...";

  const maxPlayers =
    roomType === "class" ? 30 : 5;
  let lastCreateError = null;

  for (
    let attempt = 1;
    attempt <= MAX_CREATE_ATTEMPTS;
    attempt += 1
  ) {
    const roomCode =
      generateRoomCode();

    const roomData = {
      hostUid: currentUser.uid,
      meta: {
        type: roomType,
        status: "LOBBY",
        maxPlayers,
        relaySteps: 4,
        stepDurationMs: 60000,
        createdAt: serverTimestamp()
      }
    };

    try {
      await set(ref(db, `rooms/${roomCode}`), roomData);

      showCreatedRoom(roomCode);

      watchHostLobby(
        roomCode,
        maxPlayers
      );

      appStatus.textContent =
        "방 생성이 완료되었습니다.";

      console.log(
        "방 생성 성공:",
        roomCode,
        roomData
      );

      isCreatingRoom = false;
      setCreateButtonsDisabled(false);
      return;
    } catch (error) {
      lastCreateError = error;
      console.warn(
        `방 생성 시도 ${attempt}/${MAX_CREATE_ATTEMPTS} 실패:`,
        error
      );

      continue;
    }
  }

  appStatus.textContent = isPermissionDeniedError(lastCreateError)
    ? "방 코드 충돌 또는 쓰기 권한 문제로 방을 만들지 못했습니다."
    : "방을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.";

  isCreatingRoom = false;
  setCreateButtonsDisabled(false);
}

// ========================================
// 학생 접속 상태 감지
// ========================================

async function startPlayerPresence(
  roomCode,
  studentNumber
) {
  const session = ++playerPresenceSession;
  const transition = playerPresenceTransition.then(async () => {
    if (session !== playerPresenceSession) return;
    const previousListener = stopPlayerPresenceListener;
    const previousDisconnect = playerPresenceDisconnect;
    const previousConnectedRef = activePlayerConnectedRef;
    stopPlayerPresenceListener = null;
    playerPresenceDisconnect = null;
    previousListener?.();

    if (previousDisconnect) {
      try {
        await previousDisconnect.cancel();
      } catch (error) {
        console.warn("기존 연결 종료 예약 취소 실패:", error);
      }
      if (session !== playerPresenceSession) return;
    }

    const playerConnectedRef = ref(db, `rooms/${roomCode}/players/${studentNumber}/connected`);
    const samePlayer = previousConnectedRef?.toString() === playerConnectedRef.toString();
    if (previousConnectedRef && !samePlayer) {
      if (session !== playerPresenceSession) return;
      try {
        await set(previousConnectedRef, false);
      } catch (error) {
        console.warn("이전 접속 상태 변경 실패:", error);
      }
      if (session !== playerPresenceSession) return;
    }

    if (session !== playerPresenceSession) return;
    const listener = onValue(ref(db, ".info/connected"), (snapshot) => {
      if (session !== playerPresenceSession) return;
      if (snapshot.val() !== true) {
        ++playerPresenceCallbackGeneration;
        return;
      }

      const callbackGeneration = ++playerPresenceCallbackGeneration;
      const connectionTask = playerPresenceTransition.then(async () => {
        if (session !== playerPresenceSession || callbackGeneration !== playerPresenceCallbackGeneration) return;
        let disconnectHandler = null;
        try {
          disconnectHandler = onDisconnect(playerConnectedRef);
          await disconnectHandler.set(false);
          if (session !== playerPresenceSession || callbackGeneration !== playerPresenceCallbackGeneration) {
            try {
              // Presence writes share this queue, so no newer reservation for this path can exist yet.
              await disconnectHandler.cancel();
            } catch (cancelError) {
              console.warn("오래된 연결 종료 예약 취소 실패:", cancelError);
            }
            return;
          }

          await set(playerConnectedRef, true);
          if (session !== playerPresenceSession || callbackGeneration !== playerPresenceCallbackGeneration) {
            try {
              // The next queued session has not registered its handler yet.
              await disconnectHandler.cancel();
            } catch (cancelError) {
              console.warn("오래된 연결 종료 예약 취소 실패:", cancelError);
            }
            return;
          }
          playerPresenceDisconnect = disconnectHandler;
        } catch (error) {
          if (disconnectHandler) {
            try {
              await disconnectHandler.cancel();
            } catch (cancelError) {
              console.warn(
                "실패한 접속 등록의 연결 종료 예약 취소 실패:",
                cancelError
              );
            }
          }
          console.error("학생 접속 상태 등록 실패:", error);
          if (session === playerPresenceSession && callbackGeneration === playerPresenceCallbackGeneration && isPermissionDeniedError(error)) {
            joinStatus.textContent = "참가는 완료되었지만 접속 상태 기록 권한이 거부되었습니다.";
          }
        }
      });
      playerPresenceTransition = connectionTask.catch((error) => console.warn("presence 처리 실패:", error));
    }, (error) => {
      if (session !== playerPresenceSession) return;
      ++playerPresenceCallbackGeneration;
      console.error("Firebase 연결 상태 확인 실패:", error);
    });

    if (session !== playerPresenceSession) {
      listener();
      return;
    }
    activePlayerConnectedRef = playerConnectedRef;
    stopPlayerPresenceListener = listener;
  });
  playerPresenceTransition = transition.catch((error) => console.warn("presence 전환 실패:", error));
  await playerPresenceTransition;
}

// ========================================
// 방 참가 오류 재확인
// ========================================

async function classifyJoinWriteFailure(
  error,
  roomCode,
  studentNumber
) {
  if (!currentUser) {
    return (
      "Firebase 인증이 완료되지 않아 참가할 수 없습니다."
    );
  }

  try {
    const metaSnapshot = await get(
      ref(
        db,
        `rooms/${roomCode}/meta`
      )
    );

    if (!metaSnapshot.exists()) {
      return "존재하지 않는 방 코드입니다.";
    }

    const latestMeta = metaSnapshot.val();
    if (latestMeta.status === "PLAYING") {
      return "이미 게임이 시작되어 참가할 수 없습니다.";
    }
    if (latestMeta.status !== "LOBBY") {
      return "현재 참가할 수 없는 상태의 방입니다.";
    }

    const playerSnapshot = await get(
      ref(
        db,
        `rooms/${roomCode}/players/${studentNumber}`
      )
    );

    if (playerSnapshot.exists()) {
      const existingPlayer =
        playerSnapshot.val();

      if (
        existingPlayer?.uid &&
        existingPlayer.uid !== currentUser.uid
      ) {
        return (
          `${studentNumber}번은 다른 사용자가 이미 사용 중입니다.`
        );
      }
    }
  } catch (classificationError) {
    console.warn(
      "참가 실패 원인 재확인 실패:",
      classificationError
    );
  }

  if (isPermissionDeniedError(error)) {
    return (
      "Firebase 쓰기 권한이 거부되었습니다. Realtime Database Rules와 참가자 데이터 형식을 확인해 주세요."
    );
  }

  return (
    "방 참가 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
  );
}

// ========================================
// 방 참가
// ========================================

async function joinRoom() {
  if (isJoiningRoom) {
    return;
  }

  if (!currentUser) {
    joinStatus.textContent =
      "Firebase 인증이 완료되지 않아 참가할 수 없습니다.";
    return;
  }

  const roomCode =
    joinRoomCodeInput.value
      .trim()
      .toUpperCase();

  const studentNumber =
    normalizeStudentNumber(
      studentNumberInput.value
    );

  joinRoomCodeInput.value =
    roomCode;

  studentNumberInput.value =
    studentNumber;

  if (
    !ROOM_CODE_PATTERN.test(roomCode)
  ) {
    joinStatus.textContent =
      "방 코드는 영문과 숫자로 된 4자리입니다.";
    return;
  }

  if (
    !STUDENT_NUMBER_PATTERN.test(
      studentNumber
    )
  ) {
    joinStatus.textContent =
      "학생번호는 01부터 40까지 입력해 주세요.";
    return;
  }

  isJoiningRoom = true;
  joinRoomBtn.disabled = true;

  joinedRoomResult.hidden = true;

  joinStatus.textContent =
    "방을 확인하는 중입니다...";

  try {
    const metaRef = ref(
      db,
      `rooms/${roomCode}/meta`
    );

    const metaSnapshot =
      await get(metaRef);

    if (!metaSnapshot.exists()) {
      joinStatus.textContent =
        "존재하지 않는 방 코드입니다.";
      return;
    }

    const roomMeta =
      metaSnapshot.val();

    if (
      roomMeta.status !== "LOBBY"
    ) {
      joinStatus.textContent =
        "이미 시작되었거나 참가할 수 없는 방입니다.";
      return;
    }

    if (
      roomMeta.type !== "class" &&
      roomMeta.type !== "group"
    ) {
      joinStatus.textContent =
        "방의 게임 유형 정보가 올바르지 않습니다.";
      return;
    }

    if (
      !isStudentNumberAllowed(
        roomMeta.type,
        studentNumber
      )
    ) {
      if (roomMeta.type === "class") {
        joinStatus.textContent =
          "학급 게임의 학생번호는 01부터 30까지입니다.";
      } else {
        joinStatus.textContent =
          "모둠 게임의 학생번호는 01부터 05까지입니다.";
      }

      return;
    }

    const playerRef = ref(
      db,
      `rooms/${roomCode}/players/${studentNumber}`
    );

    const playerSnapshot =
      await get(playerRef);

    let joinedAtValue =
      serverTimestamp();

    if (playerSnapshot.exists()) {
      const existingPlayer =
        playerSnapshot.val();

      if (
        !existingPlayer ||
        existingPlayer.uid !== currentUser.uid
      ) {
        joinStatus.textContent =
          `${studentNumber}번은 다른 사용자가 이미 사용 중입니다.`;
        return;
      }

      /*
       * 같은 UID의 재접속입니다.
       * 최초 참가 시각은 변경하지 않습니다.
       */
      if (
        typeof existingPlayer.joinedAt ===
        "number"
      ) {
        joinedAtValue =
          existingPlayer.joinedAt;
      }
    }

    const playerData = {
      uid: currentUser.uid,
      number: studentNumber,
      joinedAt: joinedAtValue,
      connected: true
    };

    /*
     * 루트 경로 다중 update를 사용하지 않고
     * 해당 참가자 경로에만 set합니다.
     *
     * 동시 참가가 발생하더라도 Rules에서
     * 기존 UID와 새 UID를 비교하여 다른 UID의
     * 덮어쓰기를 거부합니다.
     */
    await set(
      playerRef,
      playerData
    );

    await startPlayerPresence(
      roomCode,
      studentNumber
    );

    showJoinedRoom(
      roomCode,
      studentNumber,
      roomMeta.type
    );

    stopPlayerStatusListener?.();
    stopPlayerStatusListener = watchRoomStatus(roomCode, "player");

    joinStatus.textContent =
      playerSnapshot.exists()
        ? "기존 참가 정보로 다시 연결되었습니다."
        : "방 참가가 완료되었습니다.";

    console.log(
      "방 참가 성공:",
      {
        roomCode,
        studentNumber,
        roomType: roomMeta.type,
        reconnected:
          playerSnapshot.exists()
      }
    );
  } catch (error) {
    console.error(
      "방 참가 실패:",
      error
    );

    joinStatus.textContent =
      await classifyJoinWriteFailure(
        error,
        roomCode,
        studentNumber
      );
  } finally {
    isJoiningRoom = false;

    joinRoomBtn.disabled =
      currentUser === null;
  }
}

// ========================================
// 앱 시작
// ========================================

async function startApp() {
  try {
    setCreateButtonsDisabled(true);
    joinRoomBtn.disabled = true;

    readRoomCodeFromUrl();

    currentUser =
      await loginAnonymously();

    console.log(
      "Firebase 로그인 성공"
    );

    console.log(
      "사용자 ID:",
      currentUser.uid
    );

    appStatus.textContent =
      "연결되었습니다. 만들 게임을 선택하세요.";

    setCreateButtonsDisabled(false);
    joinRoomBtn.disabled = false;
  } catch (error) {
    currentUser = null;

    console.error(
      "Firebase 로그인 실패:",
      error
    );

    appStatus.textContent =
      "Firebase 인증에 실패했습니다. 페이지를 새로고침해 주세요.";

    joinStatus.textContent =
      "Firebase 인증이 완료되지 않아 참가할 수 없습니다.";

    setCreateButtonsDisabled(true);
    joinRoomBtn.disabled = true;
  }
}

// ========================================
// 이벤트 등록
// ========================================

classGameBtn.addEventListener(
  "click",
  () => {
    createRoom("class");
  }
);

groupGameBtn.addEventListener(
  "click",
  () => {
    createRoom("group");
  }
);

startGameBtn.addEventListener("click", startGame);

joinRoomBtn.addEventListener(
  "click",
  () => {
    joinRoom();
  }
);

joinRoomCodeInput.addEventListener(
  "input",
  () => {
    joinRoomCodeInput.value =
      joinRoomCodeInput.value
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 4);
  }
);

studentNumberInput.addEventListener(
  "input",
  () => {
    studentNumberInput.value =
      studentNumberInput.value
        .replace(/\D/g, "")
        .slice(0, 2);
  }
);

startApp();
