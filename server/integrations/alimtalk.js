import { createHmac, randomBytes } from "node:crypto";

const SOLAPI_SEND_URL = "https://api.solapi.com/messages/v4/send";
const DEFAULT_TIMEOUT_MS = 5000;

export function getAlimtalkConfig(env = process.env) {
  const apiKey = env.KAKAO_ALIMTALK_API_KEY?.trim() || "";
  const apiSecret = env.KAKAO_ALIMTALK_API_SECRET?.trim() || "";
  const pfId = env.KAKAO_ALIMTALK_PF_ID?.trim() || "";
  const senderPhone = normalizeKoreanPhone(env.KAKAO_ALIMTALK_SENDER_PHONE || "");
  const templates = {
    rental_requested: env.KAKAO_ALIMTALK_TPL_RENTAL_REQUEST?.trim() || "",
    rental_approved: env.KAKAO_ALIMTALK_TPL_RENTAL_DECISION?.trim() || "",
    rental_rejected: env.KAKAO_ALIMTALK_TPL_RENTAL_DECISION?.trim() || "",
    rental_cancelled: env.KAKAO_ALIMTALK_TPL_RENTAL_DECISION?.trim() || "",
    chat_message: env.KAKAO_ALIMTALK_TPL_CHAT_MESSAGE?.trim() || "",
  };

  return {
    apiKey,
    apiSecret,
    pfId,
    senderPhone,
    templates,
    configured: Boolean(apiKey && apiSecret && pfId),
  };
}

export function isAlimtalkConfigured(env = process.env) {
  return getAlimtalkConfig(env).configured;
}

export function normalizeKoreanPhone(raw) {
  if (typeof raw !== "string") return "";
  const digits = raw.replace(/\D/g, "");
  if (/^8210\d{7,8}$/.test(digits)) {
    return `0${digits.slice(2)}`;
  }
  if (/^01[016789]\d{7,8}$/.test(digits)) {
    return digits;
  }
  return "";
}

export function buildSolapiAuthHeader(apiKey, apiSecret, { date = new Date().toISOString(), salt = randomBytes(16).toString("hex") } = {}) {
  const signature = createHmac("sha256", apiSecret).update(`${date}${salt}`).digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

export function buildAlimtalkMessage(templateKey, variables = {}) {
  const safe = (value, fallback = "-") => {
    const text = typeof value === "string" ? value.trim() : String(value ?? "").trim();
    return text || fallback;
  };

  switch (templateKey) {
    case "rental_requested":
      return {
        text: `[모아농기계] ${safe(variables.requesterName, "회원")}님이 '${safe(variables.listingTitle)}' 대여를 요청했습니다. (${safe(variables.start)} ~ ${safe(variables.end)})`,
        variables: {
          "#{requesterName}": safe(variables.requesterName, "회원"),
          "#{listingTitle}": safe(variables.listingTitle),
          "#{start}": safe(variables.start),
          "#{end}": safe(variables.end),
        },
      };
    case "rental_approved":
      return {
        text: `[모아농기계] '${safe(variables.listingTitle)}' 대여 요청이 승인되었습니다. (${safe(variables.start)} ~ ${safe(variables.end)})`,
        variables: {
          "#{statusLabel}": "승인",
          "#{listingTitle}": safe(variables.listingTitle),
          "#{start}": safe(variables.start),
          "#{end}": safe(variables.end),
        },
      };
    case "rental_rejected":
      return {
        text: `[모아농기계] '${safe(variables.listingTitle)}' 대여 요청이 거절되었습니다.`,
        variables: {
          "#{statusLabel}": "거절",
          "#{listingTitle}": safe(variables.listingTitle),
          "#{start}": safe(variables.start),
          "#{end}": safe(variables.end),
        },
      };
    case "rental_cancelled":
      return {
        text: `[모아농기계] '${safe(variables.listingTitle)}' 대여 일정이 취소되었습니다. (${safe(variables.start)} ~ ${safe(variables.end)})`,
        variables: {
          "#{statusLabel}": "취소",
          "#{listingTitle}": safe(variables.listingTitle),
          "#{start}": safe(variables.start),
          "#{end}": safe(variables.end),
        },
      };
    case "chat_message":
      return {
        text: `[모아농기계] ${safe(variables.senderName, "상대방")}님의 새 메시지: ${safe(variables.preview).slice(0, 40)}`,
        variables: {
          "#{senderName}": safe(variables.senderName, "상대방"),
          "#{listingTitle}": safe(variables.listingTitle),
          "#{preview}": safe(variables.preview).slice(0, 60),
        },
      };
    default:
      return null;
  }
}

export async function sendAlimtalk({ to, templateKey, variables = {}, env = process.env, fetchImpl = fetch } = {}) {
  const built = buildAlimtalkMessage(templateKey, variables);
  if (!built) {
    return { sent: false, reason: "UNKNOWN_TEMPLATE" };
  }

  const recipient = normalizeKoreanPhone(to);
  if (!recipient) {
    return { sent: false, reason: "INVALID_RECIPIENT", preview: built.text };
  }

  const config = getAlimtalkConfig(env);
  if (!config.configured) {
    return { sent: false, reason: "NOT_CONFIGURED", preview: built.text };
  }

  const templateId = config.templates[templateKey];
  if (!templateId) {
    return { sent: false, reason: "TEMPLATE_NOT_CONFIGURED", preview: built.text };
  }

  const payload = {
    message: {
      to: recipient,
      ...(config.senderPhone ? { from: config.senderPhone } : {}),
      text: built.text,
      kakaoOptions: {
        pfId: config.pfId,
        templateId,
        variables: built.variables,
      },
    },
  };

  try {
    const response = await fetchImpl(SOLAPI_SEND_URL, {
      method: "POST",
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      headers: {
        Authorization: buildSolapiAuthHeader(config.apiKey, config.apiSecret),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return { sent: false, reason: "REQUEST_FAILED", status: response.status };
    }
    const data = await response.json().catch(() => null);
    return { sent: true, messageId: data?.messageId ?? null };
  } catch (error) {
    return {
      sent: false,
      reason: "NETWORK_ERROR",
      error: error instanceof Error ? error.name : "unknown",
    };
  }
}

export function notifyAlimtalkSafe(options) {
  if (!options?.to || !isAlimtalkConfigured()) return;
  void sendAlimtalk(options).catch((error) => {
    console.warn("alimtalk notify failed", error instanceof Error ? error.message : "unknown");
  });
}
