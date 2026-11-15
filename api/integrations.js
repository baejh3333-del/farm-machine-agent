import { fail, handle, queryParams } from "../server/http.js";
import { getIntegrationStatus } from "../server/integrations/index.js";
import { fetchCropGuidance } from "../server/integrations/nongsaro.js";
import { fetchRentalOffices } from "../server/integrations/rental-offices.js";

export default handle(["GET"], async (request) => {
  const query = queryParams(request);
  const type = (query.get("type") || "status").trim();

  switch (type) {
    case "status":
      return { status: 200, body: { integrations: getIntegrationStatus() } };
    case "rental-offices": {
      const region = query.get("region") || "";
      const machineType = query.get("machineType") || "";
      const pageNo = query.get("pageNo") || 1;
      const numOfRows = query.get("numOfRows") || 20;
      const data = await fetchRentalOffices({ region, machineType, pageNo, numOfRows });
      return { status: 200, body: data };
    }
    case "crop-guidance": {
      const cropName = query.get("crop") || "";
      const pageNo = query.get("pageNo") || 1;
      const numOfRows = query.get("numOfRows") || 10;
      const data = await fetchCropGuidance({ cropName, pageNo, numOfRows });
      return { status: 200, body: data };
    }
    default:
      fail(400, "UNKNOWN_INTEGRATION_TYPE", "지원하지 않는 연동 조회 유형입니다.");
  }
});
