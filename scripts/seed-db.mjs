import { fileURLToPath } from "node:url";
import { initListingsDb, listListings, localDatabase } from "../server/listings-db.js";

initListingsDb(localDatabase);
const listings = listListings();
const rentals = listings.filter(({ type }) => type === "rent").length;
console.log(`${fileURLToPath(localDatabase)}: 총 ${listings.length}건 (대여 ${rentals}건, 판매 ${listings.length - rentals}건)`);
