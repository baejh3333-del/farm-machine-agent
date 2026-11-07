export async function accountRequest(action, data) {
  const response = await fetch(`/api/account?action=${action}`, {
    cache: "no-store",
    ...(data && {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  });
  const result = await response.json();
  if (!response.ok) {
    const messages = {
      USER_ALREADY_EXISTS: "이미 가입된 아이디입니다. 로그인해 주세요.",
      USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "이미 가입된 이메일입니다. 로그인해 주세요.",
      INVALID_EMAIL_OR_PASSWORD: "아이디 또는 비밀번호가 올바르지 않습니다.",
      INVALID_EMAIL: "아이디를 확인해 주세요.",
      INVALID_USERNAME: "아이디는 영문, 숫자, 밑줄(_), 하이픈(-)으로 3~30자 입력해 주세요.",
      INVALID_NAME: "이름을 40자 이내로 입력해 주세요.",
      INVALID_PASSWORD: "비밀번호를 128자 이내로 입력해 주세요.",
      PASSWORD_TOO_SHORT: "비밀번호는 8자 이상으로 입력해 주세요.",
      TOO_MANY_REQUESTS: "시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.",
    };
    if (response.status === 429) throw new Error(messages.TOO_MANY_REQUESTS);
    throw new Error(messages[result.code] || "계정 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  return result;
}
