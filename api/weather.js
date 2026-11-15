import { handle, queryParams } from "../server/http.js";
import { getWeatherAndMapConfig } from "../server/weather.js";

export default handle(["GET"], async (request) => {
  const params = queryParams(request);
  const region = params.get("region") || "영양읍";
  const date = params.get("date") || "";
  const endDate = params.get("endDate") || "";
  const days = params.get("days") ? Number(params.get("days")) : 5;
  const body = await getWeatherAndMapConfig({ region, date, endDate, days });
  return { status: 200, body };
});
