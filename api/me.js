import { assertWritesAllowed, fail, handle, readJson, requireUser } from "../server/http.js";
import {
  addOwnedMachine,
  getUserData,
  importGuestData,
  removeOwnedMachine,
  selectOwnedMachine,
  toggleFavorite,
} from "../server/user-data.js";

export default handle(["GET", "POST"], async (request) => {
  const user = await requireUser(request);

  if (request.method === "GET") {
    const data = await getUserData(user.id);
    return { status: 200, body: { user, ...data } };
  }

  await assertWritesAllowed();
  const body = await readJson(request);

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
    default:
      fail(400, "UNKNOWN_ACTION", "지원하지 않는 요청입니다.");
  }
});
