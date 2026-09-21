import { loginAnonymously, db, ref, set } from "./js/firebase.js";

async function startApp() {
  try {
    const user = await loginAnonymously();

    console.log("Firebase 로그인 성공");
    console.log("사용자 ID:", user.uid);

    await set(ref(db, `test/${user.uid}`), {
      message: "그림 릴레이 Firebase 연결 테스트",
      createdAt: Date.now()
    });

    console.log("Realtime Database 저장 성공");
  } catch (error) {
    console.error("Firebase 로그인 또는 DB 저장 실패:", error);
  }
}

startApp();

const classGameBtn = document.getElementById("classGameBtn");
const groupGameBtn = document.getElementById("groupGameBtn");

classGameBtn.addEventListener("click", () => {
  alert("학급 게임을 준비합니다.");
});

groupGameBtn.addEventListener("click", () => {
  alert("모둠 게임을 준비합니다.");
});