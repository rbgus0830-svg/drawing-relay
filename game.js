import {
  loginAnonymously,
  db,
  ref,
  get,
  set,
  onValue,
  onDisconnect
} from "./js/firebase.js";

// ========================================
// 화면 요소
// ========================================

const gameStatus =
  document.getElementById("gameStatus");

const gameInfo =
  document.getElementById("gameInfo");

const gameRoleTitle =
  document.getElementById(
    "gameRoleTitle"
  );

const gameRoomCode =
  document.getElementById(
    "gameRoomCode"
  );

const gameRole =
  document.getElementById("gameRole");

const gameStudentRow =
  document.getElementById(
    "gameStudentRow"
  );

const gameStudentNumber =
  document.getElementById(
    "gameStudentNumber"
  );

const gameRoomStatus =
  document.getElementById(
    "gameRoomStatus"
  );

const hostGameSection =
  document.getElementById(
    "hostGameSection"
  );

const playerGameSection =
  document.getElementById(
    "playerGameSection"
  );

// ========================================
// 설정값
// ========================================

const ROOM_CODE_PATTERN =
  /^[A-HJ-NP-Z2-9]{4}$/;

/*
 * Firebase Rules의 최대 학생번호와 동일하게
 * 01부터 30까지만 허용합니다.
 */
const STUDENT_NUMBER_PATTERN =
  /^(0[1-9]|[12][0-9]|30)$/;

// ========================================
// 앱 상태
// ========================================

let currentUser = null;
let currentRoomCode = null;
let currentStudentNumber = null;
let currentRole = null;

let stopRoomStatusListener = null;
let stopPlayerPresenceListener = null;
let playerPresenceDisconnect = null;

// ========================================
// 공통 함수
// ========================================

function readGameParameters() {
  const url =
    new URL(window.location.href);

  const roomCode =
    String(
      url.searchParams.get("room") ?? ""
    )
      .trim()
      .toUpperCase();

  const rawStudentNumber =
    String(
      url.searchParams.get("player") ?? ""
    )
      .trim()
      .replace(/\D/g, "")
      .slice(0, 2);

  const studentNumber =
    rawStudentNumber.length === 1
      ? rawStudentNumber.padStart(2, "0")
      : rawStudentNumber;

  return {
    roomCode,
    studentNumber
  };
}

function isPermissionDeniedError(error) {
  const errorCode =
    String(error?.code ?? "")
      .toUpperCase();

  const errorMessage =
    String(error?.message ?? "")
      .toUpperCase();

  return (
    errorCode.includes(
      "PERMISSION_DENIED"
    ) ||
    errorCode.includes(
      "PERMISSION-DENIED"
    ) ||
    errorMessage.includes(
      "PERMISSION_DENIED"
    ) ||
    errorMessage.includes(
      "PERMISSION DENIED"
    )
  );
}

function showError(message) {
  gameStatus.textContent = message;

  gameInfo.hidden = true;
  hostGameSection.hidden = true;
  playerGameSection.hidden = true;
}

function showGameScreen() {
  gameRoomCode.textContent =
    currentRoomCode;

  gameRoomStatus.textContent =
    "PLAYING";

  if (currentRole === "host") {
    gameRoleTitle.textContent =
      "방장 게임 화면";

    gameRole.textContent = "방장";
    gameStudentRow.hidden = true;

    hostGameSection.hidden = false;
    playerGameSection.hidden = true;
  } else {
    gameRoleTitle.textContent =
      "학생 게임 화면";

    gameRole.textContent = "학생";

    gameStudentNumber.textContent =
      currentStudentNumber;

    gameStudentRow.hidden = false;
    hostGameSection.hidden = true;
    playerGameSection.hidden = false;
  }

  gameInfo.hidden = false;

  gameStatus.textContent =
    "게임에 연결되었습니다.";
}

// ========================================
// 학생 Presence
// ========================================

async function startGamePlayerPresence() {
  if (
    currentRole !== "player" ||
    !currentStudentNumber
  ) {
    return;
  }

  if (stopPlayerPresenceListener) {
    stopPlayerPresenceListener();
    stopPlayerPresenceListener = null;
  }

  if (playerPresenceDisconnect) {
    try {
      await playerPresenceDisconnect.cancel();
    } catch (error) {
      console.warn(
        "기존 Presence 예약 취소 실패:",
        error
      );
    }

    playerPresenceDisconnect = null;
  }

  const firebaseConnectionRef = ref(
    db,
    ".info/connected"
  );

  const playerConnectedRef = ref(
    db,
    `rooms/${currentRoomCode}/players/${currentStudentNumber}/connected`
  );

  stopPlayerPresenceListener = onValue(
    firebaseConnectionRef,
    async (snapshot) => {
      const isConnected =
        snapshot.val() === true;

      if (!isConnected) {
        console.log(
          "Firebase 서버 연결이 끊겼습니다."
        );

        return;
      }

      try {
        /*
         * 브라우저 종료 또는 네트워크 단절 시
         * connected를 false로 변경하도록 먼저
         * 예약합니다.
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
          "게임 화면 Presence 등록 완료:",
          {
            roomCode:
              currentRoomCode,
            studentNumber:
              currentStudentNumber
          }
        );
      } catch (error) {
        console.error(
          "게임 화면 Presence 등록 실패:",
          error
        );

        if (
          isPermissionDeniedError(error)
        ) {
          gameStatus.textContent =
            "게임에는 연결되었지만 접속 상태 기록 권한이 없습니다.";
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
// 방 상태 실시간 감시
// ========================================

function watchRoomStatus() {
  if (stopRoomStatusListener) {
    stopRoomStatusListener();
    stopRoomStatusListener = null;
  }

  const roomStatusRef = ref(
    db,
    `rooms/${currentRoomCode}/meta/status`
  );

  stopRoomStatusListener = onValue(
    roomStatusRef,
    (snapshot) => {
      const roomStatus =
        snapshot.val();

      gameRoomStatus.textContent =
        roomStatus ?? "UNKNOWN";

      if (roomStatus === "PLAYING") {
        showGameScreen();
        return;
      }

      if (roomStatus === "FINISHED") {
        gameStatus.textContent =
          "게임이 종료되었습니다.";

        hostGameSection.hidden = true;
        playerGameSection.hidden = true;
        return;
      }

      if (roomStatus === "LOBBY") {
        gameStatus.textContent =
          "아직 게임이 시작되지 않았습니다.";

        hostGameSection.hidden = true;
        playerGameSection.hidden = true;
        return;
      }

      showError(
        "방이 삭제되었거나 알 수 없는 상태입니다."
      );
    },
    (error) => {
      console.error(
        "방 상태 실시간 확인 실패:",
        error
      );

      if (
        isPermissionDeniedError(error)
      ) {
        showError(
          "방 상태를 읽을 권한이 없습니다."
        );
      } else {
        showError(
          "방 상태를 불러오지 못했습니다."
        );
      }
    }
  );
}

// ========================================
// 접근 권한 확인
// ========================================

async function verifyGameAccess() {
  /*
   * 중요:
   * 현재 Rules에서는 아래와 같은 방 전체 읽기가
   * 허용되지 않습니다.
   *
   * get(ref(db, `rooms/${currentRoomCode}`))
   *
   * 따라서 읽기가 허용된 개별 경로만 요청합니다.
   */
  const hostUidSnapshot = await get(
    ref(
      db,
      `rooms/${currentRoomCode}/hostUid`
    )
  );

  const metaSnapshot = await get(
    ref(
      db,
      `rooms/${currentRoomCode}/meta`
    )
  );

  if (
    !hostUidSnapshot.exists() ||
    !metaSnapshot.exists()
  ) {
    throw new Error("ROOM_NOT_FOUND");
  }

  const hostUid =
    hostUidSnapshot.val();

  const roomMeta =
    metaSnapshot.val();

  /*
   * URL의 역할 정보가 아니라 Firebase UID를
   * 비교하여 방장 여부를 결정합니다.
   */
  if (hostUid === currentUser.uid) {
    currentRole = "host";
    currentStudentNumber = null;
  } else {
    if (
      !STUDENT_NUMBER_PATTERN.test(
        currentStudentNumber
      )
    ) {
      throw new Error(
        "PLAYER_NUMBER_REQUIRED"
      );
    }

    /*
     * 방 유형에 따라 학생번호 범위를 한 번 더
     * 검증합니다.
     */
    const studentNumberValue =
      Number(currentStudentNumber);

    if (
      roomMeta.type === "class" &&
      (
        studentNumberValue < 1 ||
        studentNumberValue > 30
      )
    ) {
      throw new Error(
        "PLAYER_NUMBER_INVALID"
      );
    }

    if (
      roomMeta.type === "group" &&
      (
        studentNumberValue < 1 ||
        studentNumberValue > 5
      )
    ) {
      throw new Error(
        "PLAYER_NUMBER_INVALID"
      );
    }

    if (
      roomMeta.type !== "class" &&
      roomMeta.type !== "group"
    ) {
      throw new Error(
        "INVALID_ROOM_TYPE"
      );
    }

    const playerSnapshot = await get(
      ref(
        db,
        `rooms/${currentRoomCode}/players/${currentStudentNumber}`
      )
    );

    if (!playerSnapshot.exists()) {
      throw new Error(
        "PLAYER_NOT_FOUND"
      );
    }

    const playerData =
      playerSnapshot.val();

    if (
      !playerData ||
      playerData.uid !== currentUser.uid
    ) {
      throw new Error(
        "PLAYER_UID_MISMATCH"
      );
    }

    currentRole = "player";
  }

  if (roomMeta.status !== "PLAYING") {
    if (roomMeta.status === "LOBBY") {
      throw new Error(
        "GAME_NOT_STARTED"
      );
    }

    if (roomMeta.status === "FINISHED") {
      throw new Error(
        "GAME_FINISHED"
      );
    }

    throw new Error(
      "INVALID_ROOM_STATUS"
    );
  }
}

function getAccessErrorMessage(error) {
  if (isPermissionDeniedError(error)) {
    return (
      "게임 정보를 읽을 권한이 없습니다. Firebase Rules를 확인해 주세요."
    );
  }

  switch (error.message) {
    case "ROOM_NOT_FOUND":
      return "존재하지 않는 방입니다.";

    case "PLAYER_NUMBER_REQUIRED":
      return "학생 참가 정보가 없습니다.";

    case "PLAYER_NUMBER_INVALID":
      return "이 방에서 사용할 수 없는 학생번호입니다.";

    case "PLAYER_NOT_FOUND":
      return "이 방의 참가자로 등록되어 있지 않습니다.";

    case "PLAYER_UID_MISMATCH":
      return "현재 사용자와 참가자 정보가 일치하지 않습니다.";

    case "INVALID_ROOM_TYPE":
      return "방의 게임 유형 정보가 올바르지 않습니다.";

    case "GAME_NOT_STARTED":
      return "아직 게임이 시작되지 않았습니다.";

    case "GAME_FINISHED":
      return "이미 종료된 게임입니다.";

    case "INVALID_ROOM_STATUS":
      return "방 상태 정보가 올바르지 않습니다.";

    default:
      return "게임 정보를 확인하지 못했습니다.";
  }
}

// ========================================
// 앱 시작
// ========================================

async function startGameApp() {
  const {
    roomCode,
    studentNumber
  } = readGameParameters();

  currentRoomCode = roomCode;
  currentStudentNumber =
    studentNumber;

  if (
    !ROOM_CODE_PATTERN.test(
      currentRoomCode
    )
  ) {
    showError(
      "올바른 방 코드가 필요합니다."
    );

    return;
  }

  try {
    gameStatus.textContent =
      "Firebase에 연결하는 중입니다...";

    currentUser =
      await loginAnonymously();

    gameStatus.textContent =
      "게임 참가 권한을 확인하는 중입니다...";

    await verifyGameAccess();

    /*
     * 학생인 경우 게임 페이지에서도 접속 상태를
     * 다시 등록합니다.
     */
    await startGamePlayerPresence();

    showGameScreen();
    watchRoomStatus();

    console.log(
      "게임 화면 연결 성공:",
      {
        roomCode: currentRoomCode,
        role: currentRole,
        studentNumber:
          currentStudentNumber,
        uid: currentUser.uid
      }
    );
  } catch (error) {
    console.error(
      "게임 화면 연결 실패:",
      error
    );

    showError(
      getAccessErrorMessage(error)
    );
  }
}

startGameApp();