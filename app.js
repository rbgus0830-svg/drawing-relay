import {
  loginAnonymously,
  db,
  ref,
  set,
  get,
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
  playerList.replaceChildren();

  playerCount.textContent =
    `0 / ${maxPlayers}`;

  hostLobbyStatus.textContent =
    "학생의 참가를 기다리고 있습니다.";

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

      if (players.length === 0) {
        hostLobbyStatus.textContent =
          "학생의 참가를 기다리고 있습니다.";
      } else if (
        players.length >= maxPlayers
      ) {
        hostLobbyStatus.textContent =
          "참가 인원이 모두 찼습니다.";
      } else {
        hostLobbyStatus.textContent =
          `${players.length}명이 참가했습니다.`;
      }

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

      if (isPermissionDeniedError(error)) {
        hostLobbyStatus.textContent =
          "참가자 목록을 읽을 권한이 없습니다.";
      } else {
        hostLobbyStatus.textContent =
          "참가자 목록을 불러오지 못했습니다.";
      }
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
      await set(
        ref(
          db,
          `rooms/${roomCode}`
        ),
        roomData
      );

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
      console.warn(
        `방 생성 시도 ${attempt}/${MAX_CREATE_ATTEMPTS} 실패:`,
        error
      );

      if (
        isPermissionDeniedError(error)
      ) {
        appStatus.textContent =
          "방 생성 권한이 거부되었습니다. Firebase Rules를 확인해 주세요.";

        isCreatingRoom = false;
        setCreateButtonsDisabled(false);
        return;
      }
    }
  }

  appStatus.textContent =
    "방을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.";

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
  // 기존 접속 상태 감시가 있다면
  // 해제합니다.
  if (stopPlayerPresenceListener) {
    stopPlayerPresenceListener();
    stopPlayerPresenceListener = null;
  }

  // 기존 연결 종료 예약이 있다면
  // 취소합니다.
  if (playerPresenceDisconnect) {
    try {
      await playerPresenceDisconnect.cancel();
    } catch (error) {
      console.warn(
        "기존 연결 종료 예약 취소 실패:",
        error
      );
    }

    playerPresenceDisconnect = null;
  }

  // 같은 페이지에서 다른 방 또는 번호로
  // 이동한 경우 이전 참가 상태를
  // 연결 끊김으로 변경합니다.
  if (activePlayerConnectedRef) {
    try {
      await set(
        activePlayerConnectedRef,
        false
      );
    } catch (error) {
      console.warn(
        "이전 접속 상태 변경 실패:",
        error
      );
    }

    activePlayerConnectedRef = null;
  }

  const firebaseConnectionRef = ref(
    db,
    ".info/connected"
  );

  const playerConnectedRef = ref(
    db,
    `rooms/${roomCode}/players/${studentNumber}/connected`
  );

  activePlayerConnectedRef =
    playerConnectedRef;

  stopPlayerPresenceListener = onValue(
    firebaseConnectionRef,
    async (snapshot) => {
      const isConnected =
        snapshot.val() === true;

      if (!isConnected) {
        console.log(
          "Firebase 서버와 연결이 끊겼습니다."
        );
        return;
      }

      try {
        /*
         * 브라우저가 닫히거나 네트워크 연결이
         * 끊어지면 Firebase 서버가 connected를
         * false로 변경합니다.
         *
         * true를 기록하기 전에 onDisconnect를
         * 먼저 예약합니다.
         */
        const disconnectHandler =
          onDisconnect(
            playerConnectedRef
          );

        await disconnectHandler.set(false);

        playerPresenceDisconnect =
          disconnectHandler;

        await set(
          playerConnectedRef,
          true
        );

        console.log(
          "학생 접속 상태 등록 완료:",
          {
            roomCode,
            studentNumber
          }
        );
      } catch (error) {
        console.error(
          "학생 접속 상태 등록 실패:",
          error
        );

        if (
          isPermissionDeniedError(error)
        ) {
          joinStatus.textContent =
            "참가는 완료되었지만 접속 상태 기록 권한이 거부되었습니다.";
        }
      }
    },
    (error) => {
      console.error(
        "Firebase 연결 상태 확인 실패:",
        error
      );
    }
  );
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