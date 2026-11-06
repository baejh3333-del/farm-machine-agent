import { listListings } from "../server/listings-db.js";

export default function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "GET만 지원합니다." });
  }
  try {
    return response.status(200).json({ listings: listListings() });
  } catch (error) {
    console.error("listings failed", error.message);
    return response.status(500).json({ error: "매물을 불러오지 못했습니다." });
  }
}
