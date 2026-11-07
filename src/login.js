// 이 파일은 main.js에서 나눈 모듈이다. 다른 화면 함수는 app(app.js)을 통해 부른다.
// 아이디 로그인·회원가입 화면과 계정 상태.
import { accountRequest } from "./account.js";
import { app } from "./app.js";
import { loadCatalog, state } from "./app-state.js";
import { $, toast } from "./ui.js";

// 아이디 기반 로그인 및 회원가입 화면
export function initLoginForm() {
  const form = $("loginForm");
  const username = $("loginId");
  const password = $("loginPassword");
  const name = $("signupName");
  const confirm = $("signupConfirm");
  const submit = $("loginSubmit");
  const eye = $("loginEye");
  const switchButton = $("switchAccount");
  const headerButton = $("loginButton");
  const logout = $("accountLogoutButton");
  let signup = false;

  function showError(message) {
    const error = $("accountError");
    error.textContent = message;
    error.hidden = !message;
  }

  function setMode(nextSignup) {
    signup = nextSignup;
    const label = signup ? "회원가입" : "로그인";
    $("accountHeading").textContent = "모아농 " + label;
    submit.textContent = label;
    switchButton.textContent = signup ? "로그인" : "회원가입";
    $("signupNameField").hidden = $("signupConfirmField").hidden = !signup;
    name.disabled = confirm.disabled = !signup;
    name.required = confirm.required = signup;
    password.minLength = signup ? 8 : 0;
    password.autocomplete = signup ? "new-password" : "current-password";
    password.value = confirm.value = "";
    password.type = "password";
    eye.setAttribute("aria-pressed", "false");
    eye.setAttribute("aria-label", "비밀번호 보기");
    eye.classList.remove("is-showing");
    showError("");
    (signup ? name : username).focus();
  }

  // 계정이 바뀌면 사용자 데이터를 다시 불러오고, 매물의 "내 매물" 표시도 새 사용자 기준으로 다시 받는다.
  async function renderAccount(user) {
    app.setAccountUser(user ?? null);
    headerButton.textContent = app.isLoggedIn() ? "내 계정" : "로그인";
    app.updateBadges();
    await app.store.setUser(app.accountUser());
    await loadCatalog();
  }

  function openLogin() {
    if (app.isLoggedIn()) return app.setView("owner");
    app.setView("login");
    setMode(false);
  }
  app.openLogin = openLogin;

  headerButton.addEventListener("click", openLogin);
  $("ownerLoginGoButton").addEventListener("click", openLogin);
  switchButton.addEventListener("click", () => setMode(!signup));

  eye.addEventListener("click", () => {
    const show = password.type === "password";
    password.type = show ? "text" : "password";
    eye.setAttribute("aria-pressed", String(show));
    eye.setAttribute("aria-label", show ? "비밀번호 숨기기" : "비밀번호 보기");
    eye.classList.toggle("is-showing", show);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    showError("");
    if (signup && !name.value.trim()) {
      showError("이름을 입력해 주세요.");
      name.focus();
      return;
    }
    if (signup && password.value !== confirm.value) {
      showError("비밀번호가 일치하지 않습니다.");
      confirm.focus();
      return;
    }
    submit.disabled = switchButton.disabled = true;
    try {
      const data = { username: username.value.trim(), password: password.value };
      if (signup) data.name = name.value.trim();
      const result = await accountRequest(signup ? "signup" : "login", data);
      renderAccount(result.user);
      password.value = confirm.value = "";
      app.setView("owner");
    } catch (error) {
      showError(error instanceof TypeError || error instanceof SyntaxError
        ? "서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요."
        : error.message);
    } finally {
      submit.disabled = switchButton.disabled = false;
    }
  });

  logout.addEventListener("click", async () => {
    logout.disabled = true;
    try {
      await accountRequest("logout", {});
      renderAccount(null);
      app.setView("home");
      toast("로그아웃되었습니다.");
    } catch {
      toast("로그아웃에 실패했습니다. 다시 시도해 주세요.");
    } finally {
      logout.disabled = false;
    }
  });

  for (const el of document.querySelectorAll("[data-view-target]")) {
    el.addEventListener("click", () => app.setView(el.dataset.viewTarget));
  }

  accountRequest("session")
    .then((result) => {
      renderAccount(result.user);
      if (app.isLoggedIn() && state.view === "ownerLoginRequired") app.setView("owner");
    })
    .catch(() => {})
    .finally(() => { submit.disabled = false; });
}
