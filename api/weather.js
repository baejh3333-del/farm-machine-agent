import { handle, queryParams } from "../server/http.js";
import { getWeatherAndMapConfig } from "../server/weather.js";

export default handle(["GET"], async (request) => {
  const params = queryParams(request);
  const region = params.get("region") || "영양읍";
  const date = params.get("date") || "";
  const body = await getWeatherAndMapConfig({ region, date });
  return { status: 200, body };
});
