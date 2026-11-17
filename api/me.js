import { assertWritesAllowed, fail, handle, MAX_UPLOAD_JSON_BYTES, readJson, requireUser } from "../server/http.js";
import { enforceRateLimit } from "../server/rate-limit.js";
import {
  deleteEducationCertificate,
  getEducationCertificateImage,
  getEducationCertificateStatus,
  saveEducationCertificate,
} from "../server/education-certificate.js";
import {
  addOwnedMachine,
  getUserData,
  importGuestData,
  removeOwnedMachine,
  selectOwnedMachine,
  toggleFavorite,
  updateUserNickname,
} from "../server/user-data.js";

export default handle(["GET", "POST"], async (request) => {
  const user = await requireUser(request);

  if (request.method === "GET") {
    const [data, educationCertificate] = await Promise.all([
      getUserData(user.id),
      getEducationCertificateStatus(user.id),
    ]);
    return { status: 200, body: { user, ...data, educationCertificate } };
  }

  // 교육이수증 사진(data URL)은 일반 요청보다 커서 업로드 상한으로 읽는다.
  const body = await readJson(request, { maxBytes: MAX_UPLOAD_JSON_BYTES });

  // 사진 보기는 읽기 전용이라 쓰기 점검 상태와 관계없이 허용한다.
  if (body.action === "getEducationCertificate") {
    const result = await getEducationCertificateImage(user.id);
    return { status: 200, body: result };
  }

  await assertWritesAllowed();

  switch (body.action) {
    case "toggleFavorite": {
      const result = await toggleFavorite(user.id, body.listingId, { favorite: body.favorite });
      return { status: 200, body: result };
    }
    case "addOwned": {
      const result = await addOwnedMachine(user.id, body);
      return { status: 200, body: result };
    }
    case "selectOwned": {
      const result = await selectOwnedMachine(user.id, body.id);
      return { status: 200, body: result };
    }
    case "removeOwned": {
      const result = await removeOwnedMachine(user.id, body.id);
      return { status: 200, body: result };
    }
    case "importGuest": {
      const result = await importGuestData(user.id, {
        favorites: body.favorites,
        ownedMachines: body.ownedMachines,
      });
      return { status: 200, body: result };
    }
    case "updateNickname": {
      const result = await updateUserNickname(user.id, body.name);
      return { status: 200, body: result };
    }
    case "uploadEducationCertificate": {
      await enforceRateLimit(request, "listing", { userId: user.id });
      const educationCertificate = await saveEducationCertificate(user.id, body.photoDataUrl);
      return { status: 200, body: { educationCertificate } };
    }
    case "deleteEducationCertificate": {
      const educationCertificate = await deleteEducationCertificate(user.id);
      return { status: 200, body: { educationCertificate } };
    }
    default:
      fail(400, "UNKNOWN_ACTION", "지원하지 않는 요청입니다.");
  }
});
