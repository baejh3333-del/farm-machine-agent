import { fail, handle, query, readJson, requireUser } from "../server/http.js";
import { getUserData, mergeGuestData, saveOwnedMachines, setFavorite } from "../server/user-data.js";

const actions = { favorite: setFavorite, machines: saveOwnedMachines, merge: mergeGuestData };

// GET  /api/me                   { favorites, ownedMachines }
// POST /api/me?action=favorite   { listingId, on }
// POST /api/me?action=machines   { ownedMachines: [...] } 보유 목록 전체 저장
// POST /api/me?action=merge      { favorites, ownedMachines } 로그인 전 브라우저 데이터 합치기
export default handle(["GET", "POST"], async (request) => {
  if (request.method === "GET") return { body: await getUserData(await requireUser(request)) };
  const body = readJson(request);
  const user = await requireUser(request);
  const action = query(request).get("action");
  if (!Object.hasOwn(actions, action ?? "")) fail(404, "UNKNOWN_ACTION", "지원하지 않는 요청입니다.");
  return { body: await actions[action](user, body) };
});
