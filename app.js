import {
  loginAnonymously,
  db,
  ref,
  set,
  get,
  update,
  serverTimestamp
} from "./js/firebase.js";

// 방 생성 화면
const classGameBtn = document.getElementById("classGameBtn");
const groupGameBtn = document.getElementById("groupGameBtn");
const appStatus = document.getElementById("appStatus");
const roomResult = document.getElementById("roomResult");
const roomCodeElement = document.getElementById("roomCode");
const roomLinkElement = document.getElementById("roomLink");

// 방 참가 화면
const joinRoomCodeInput = document.getElementById("joinRoomCode");
const studentNumberInput = document.getElementById("studentNumber");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const joinStatus = document.getElementById("joinStatus");
const joinedRoomResult = document.getElementById("joinedRoomResult");
const joinedRoomCode = document.getElementById("joinedRoomCode");
const joinedStudentNumber =
  document.getElementById("joinedStudentNumber");
const joinedRoomType = document.getElementById("joinedRoomType");

const ROOM_CODE_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}$/;
const STUDENT_NUMBER_PATTERN = /^(0[1-9]|[1-3][0-9]|40)$/;
const MAX_CREATE_ATTEMPTS = 5;

let currentUser = null;
let isCreatingRoom = false;
let isJoiningRoom = false;

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
  const digitsOnly = value.replace(/\D/g, "").slice(0, 2);

  if (digitsOnly.length === 1) {
    return digitsOnly.padStart(2, "0");
  }

  return digitsOnly;
}

function showJoinedRoom(roomCode, studentNumber, roomType) {
  joinedRoomCode.textContent = roomCode;
  joinedStudentNumber.textContent = studentNumber;

  joinedRoomType.textContent =
    roomType === "class"
      ? "학급 게임에 참가했습니다."
      : "모둠 게임에 참가했습니다.";

  joinedRoomResult.hidden = false;
}

async function createRoom(roomType) {
  if (!currentUser || isCreatingRoom) {
    return;
  }

  isCreatingRoom = true;
  setCreateButtonsDisabled(true);
  roomResult.hidden = true;
  appStatus.textContent = "방을 만드는 중입니다...";

  const maxPlayers = roomType === "class" ? 30 : 5;

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
      await set(ref(db, `rooms/${roomCode}`), roomData);

      showCreatedRoom(roomCode);
      appStatus.textContent = "방 생성이 완료되었습니다.";

      console.log("방 생성 성공:", roomCode, roomData);

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
  joinStatus.textContent = "방을 확인하는 중입니다...";

  try {
    const metaSnapshot = await get(
      ref(db, `rooms/${roomCode}/meta`)
    );

    if (!metaSnapshot.exists()) {
      joinStatus.textContent =
        "존재하지 않는 방 코드입니다.";

      isJoiningRoom = false;
      joinRoomBtn.disabled = false;
      return;
    }

    const roomMeta = metaSnapshot.val();

    if (roomMeta.status !== "LOBBY") {
      joinStatus.textContent =
        "이미 시작되었거나 참가할 수 없는 방입니다.";

      isJoiningRoom = false;
      joinRoomBtn.disabled = false;
      return;
    }

    const updates = {};

    updates[`rooms/${roomCode}/claims/${studentNumber}`] =
      currentUser.uid;

    updates[`rooms/${roomCode}/players/${studentNumber}`] = {
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

    joinStatus.textContent = "방 참가가 완료되었습니다.";

    console.log("방 참가 성공:", {
      roomCode,
      studentNumber,
      roomType: roomMeta.type
    });
  } catch (error) {
    console.error("방 참가 실패:", error);

    joinStatus.textContent =
      "이미 사용 중인 학생번호이거나 참가할 수 없는 방입니다.";
  } finally {
    isJoiningRoom = false;
    joinRoomBtn.disabled = false;
  }
}

async function startApp() {
  try {
    setCreateButtonsDisabled(true);
    joinRoomBtn.disabled = true;

    readRoomCodeFromUrl();

    currentUser = await loginAnonymously();

    console.log("Firebase 로그인 성공");
    console.log("사용자 ID:", currentUser.uid);

    appStatus.textContent =
      "연결되었습니다. 만들 게임을 선택하세요.";

    setCreateButtonsDisabled(false);
    joinRoomBtn.disabled = false;
  } catch (error) {
    console.error("Firebase 로그인 실패:", error);

    appStatus.textContent =
      "Firebase 연결에 실패했습니다. 페이지를 새로고침해 주세요.";

    joinStatus.textContent =
      "Firebase 연결에 실패하여 참가할 수 없습니다.";
  }
}

classGameBtn.addEventListener("click", () => {
  createRoom("class");
});

groupGameBtn.addEventListener("click", () => {
  createRoom("group");
});

joinRoomBtn.addEventListener("click", () => {
  joinRoom();
});

joinRoomCodeInput.addEventListener("input", () => {
  joinRoomCodeInput.value = joinRoomCodeInput.value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4);
});

studentNumberInput.addEventListener("input", () => {
  studentNumberInput.value =
    studentNumberInput.value
      .replace(/\D/g, "")
      .slice(0, 2);
});

startApp();