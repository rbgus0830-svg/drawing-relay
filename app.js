import {
  loginAnonymously,
  db,
  ref,
  set,
  serverTimestamp
} from "./js/firebase.js";

const classGameBtn = document.getElementById("classGameBtn");
const groupGameBtn = document.getElementById("groupGameBtn");
const appStatus = document.getElementById("appStatus");
const roomResult = document.getElementById("roomResult");
const roomCodeElement = document.getElementById("roomCode");
const roomLinkElement = document.getElementById("roomLink");

const ROOM_CODE_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_CREATE_ATTEMPTS = 5;

let currentUser = null;
let isCreatingRoom = false;

/**
 * 혼동하기 쉬운 I, O, 0, 1을 제외한 4자리 방 코드를 만듭니다.
 */
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

/**
 * 방 코드가 포함된 초대 주소를 만듭니다.
 * 예: http://127.0.0.1:5500/?room=Q7KP
 */
function createInvitationUrl(roomCode) {
  const invitationUrl = new URL(window.location.href);

  invitationUrl.searchParams.set("room", roomCode);

  return invitationUrl.toString();
}

function setButtonsDisabled(disabled) {
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

/**
 * 보안 규칙의 !data.exists() 조건을 이용해
 * 기존 방을 덮어쓰지 않고 새 방만 생성합니다.
 */
async function createRoom(roomType) {
  if (!currentUser || isCreatingRoom) {
    return;
  }

  isCreatingRoom = true;
  setButtonsDisabled(true);
  roomResult.hidden = true;
  appStatus.textContent = "방을 만드는 중입니다...";

  const maxPlayers = roomType === "class" ? 30 : 5;

  for (let attempt = 1; attempt <= MAX_CREATE_ATTEMPTS; attempt += 1) {
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
      setButtonsDisabled(false);
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
  setButtonsDisabled(false);
}

async function startApp() {
  try {
    setButtonsDisabled(true);

    currentUser = await loginAnonymously();

    console.log("Firebase 로그인 성공");
    console.log("사용자 ID:", currentUser.uid);

    appStatus.textContent =
      "연결되었습니다. 만들 게임을 선택하세요.";

    setButtonsDisabled(false);
  } catch (error) {
    console.error("Firebase 로그인 실패:", error);

    appStatus.textContent =
      "Firebase 연결에 실패했습니다. 페이지를 새로고침해 주세요.";
  }
}

classGameBtn.addEventListener("click", () => {
  createRoom("class");
});

groupGameBtn.addEventListener("click", () => {
  createRoom("group");
});

startApp();