import {
  loginAnonymously,
  db,
  ref,
  set,
  get,
  update,
  onValue,
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

// ========================================
// 공통 함수
// ========================================

function generateRoomCode() {
  let roomCode = "";

  for (let index = 0; index < 4; index += 1) {
    const randomIndex = Math.floor(
      Math.random() * ROOM_CODE_CHARACTERS.length
    );

    roomCode += ROOM_CODE_CHARACTERS[randomIndex];
  }

  return roomCode;
}

function createInvitationUrl(roomCode) {
  const invitationUrl = new URL(window.location.href);

  invitationUrl.searchParams.set("room", roomCode);

  return invitationUrl.toString();
}

function setCreateButtonsDisabled(disabled) {
  classGameBtn.disabled = disabled;
  groupGameBtn.disabled = disabled;
}

function showCreatedRoom(roomCode) {
  const invitationUrl = createInvitationUrl(roomCode);

  roomCodeElement.textContent = roomCode;
  roomLinkElement.textContent = invitationUrl;
  roomLinkElement.href = invitationUrl;

  roomResult.hidden = false;
}

function readRoomCodeFromUrl() {
  const url = new URL(window.location.href);
  const roomCode = url.searchParams.get("room");

  if (!roomCode) {
    return;
  }

  const normalizedRoomCode = roomCode
    .trim()
    .toUpperCase();

  if (ROOM_CODE_PATTERN.test(normalizedRoomCode)) {
    joinRoomCodeInput.value = normalizedRoomCode;
  }
}

function normalizeStudentNumber(value) {
  const digitsOnly = value
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
  joinedStudentNumber.textContent = studentNumber;

  joinedRoomType.textContent =
    roomType === "class"
      ? "학급 게임에 참가했습니다."
      : "모둠 게임에 참가했습니다.";

  joinedRoomResult.hidden = false;
}

// ========================================
// 방장 실시간 대기실
// ========================================

function watchHostLobby(roomCode, maxPlayers) {
  // 이전에 감시하던 방이 있으면 구독을 해제합니다.
  if (stopHostLobbyListener) {
    stopHostLobbyListener();
    stopHostLobbyListener = null;
  }

  hostLobby.hidden = false;
  playerList.replaceChildren();

  playerCount.textContent = `0 / ${maxPlayers}`;

  hostLobbyStatus.textContent =
    "학생의 참가를 기다리고 있습니다.";

  const playersRef = ref(
    db,
    `rooms/${roomCode}/players`
  );

  stopHostLobbyListener = onValue(
    playersRef,

    (snapshot) => {
      const playersData = snapshot.val() ?? {};

      const players = Object.values(playersData)
        .filter((player) => {
          return player && player.number;
        })
        .sort((firstPlayer, secondPlayer) => {
          return firstPlayer.number.localeCompare(
            secondPlayer.number
          );
        });

      playerList.replaceChildren();

      for (const player of players) {
        const listItem =
          document.createElement("li");

        listItem.textContent =
          `${player.number}번`;

        if (player.connected === false) {
          listItem.textContent += " · 연결 끊김";
        }

        playerList.appendChild(listItem);
      }

      playerCount.textContent =
        `${players.length} / ${maxPlayers}`;

      if (players.length === 0) {
        hostLobbyStatus.textContent =
          "학생의 참가를 기다리고 있습니다.";
      } else if (players.length >= maxPlayers) {
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

      hostLobbyStatus.textContent =
        "참가자 목록을 불러오지 못했습니다.";
    }
  );
}

// ========================================
// 방 생성
// ========================================

async function createRoom(roomType) {
  if (!currentUser || isCreatingRoom) {
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
    const roomCode = generateRoomCode();

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
        ref(db, `rooms/${roomCode}`),
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
    }
  }

  appStatus.textContent =
    "방을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.";

  isCreatingRoom = false;
  setCreateButtonsDisabled(false);
}

// ========================================
// 방 참가
// ========================================

async function joinRoom() {
  if (!currentUser || isJoiningRoom) {
    return;
  }

  const roomCode = joinRoomCodeInput.value
    .trim()
    .toUpperCase();

  const studentNumber = normalizeStudentNumber(
    studentNumberInput.value
  );

  joinRoomCodeInput.value = roomCode;
  studentNumberInput.value = studentNumber;

  if (!ROOM_CODE_PATTERN.test(roomCode)) {
    joinStatus.textContent =
      "방 코드는 영문과 숫자로 된 4자리입니다.";

    return;
  }

  if (!STUDENT_NUMBER_PATTERN.test(studentNumber)) {
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
    const metaSnapshot = await get(
      ref(db, `rooms/${roomCode}/meta`)
    );

    if (!metaSnapshot.exists()) {
      joinStatus.textContent =
        "존재하지 않는 방 코드입니다.";

      return;
    }

    const roomMeta = metaSnapshot.val();

    if (roomMeta.status !== "LOBBY") {
      joinStatus.textContent =
        "이미 시작되었거나 참가할 수 없는 방입니다.";

      return;
    }

    // 화면에서도 방 유형에 맞는 학생번호를 확인합니다.
    const studentNumberValue =
      Number(studentNumber);

    if (
      roomMeta.type === "class" &&
      studentNumberValue > 30
    ) {
      joinStatus.textContent =
        "학급 게임의 학생번호는 01부터 30까지입니다.";

      return;
    }

    if (
      roomMeta.type === "group" &&
      studentNumberValue > 5
    ) {
      joinStatus.textContent =
        "모둠 게임의 학생번호는 01부터 05까지입니다.";

      return;
    }

    const updates = {};

    updates[
      `rooms/${roomCode}/claims/${studentNumber}`
    ] = currentUser.uid;

    updates[
      `rooms/${roomCode}/players/${studentNumber}`
    ] = {
      uid: currentUser.uid,
      number: studentNumber,
      joinedAt: serverTimestamp(),
      connected: true
    };

    await update(ref(db), updates);

    showJoinedRoom(
      roomCode,
      studentNumber,
      roomMeta.type
    );

    joinStatus.textContent =
      "방 참가가 완료되었습니다.";

    console.log("방 참가 성공:", {
      roomCode,
      studentNumber,
      roomType: roomMeta.type
    });
  } catch (error) {
    console.error(
      "방 참가 실패:",
      error
    );

    joinStatus.textContent =
      "이미 사용 중인 학생번호이거나 참가할 수 없는 방입니다.";
  } finally {
    isJoiningRoom = false;
    joinRoomBtn.disabled = false;
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

    currentUser = await loginAnonymously();

    console.log("Firebase 로그인 성공");
    console.log(
      "사용자 ID:",
      currentUser.uid
    );

    appStatus.textContent =
      "연결되었습니다. 만들 게임을 선택하세요.";

    setCreateButtonsDisabled(false);
    joinRoomBtn.disabled = false;
  } catch (error) {
    console.error(
      "Firebase 로그인 실패:",
      error
    );

    appStatus.textContent =
      "Firebase 연결에 실패했습니다. 페이지를 새로고침해 주세요.";

    joinStatus.textContent =
      "Firebase 연결에 실패하여 참가할 수 없습니다.";
  }
}

// ========================================
// 이벤트 등록
// ========================================

classGameBtn.addEventListener("click", () => {
  createRoom("class");
});

groupGameBtn.addEventListener("click", () => {
  createRoom("group");
});

joinRoomBtn.addEventListener("click", () => {
  joinRoom();
});

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