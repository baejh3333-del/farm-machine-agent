import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { buildMockListings } from "./listing-seed.js";

const localDirectory = new URL("../data/", import.meta.url);
export const localDatabase = new URL("farm-machines.sqlite", localDirectory);
let database;
let listQuery;
const catalog = new Map(buildMockListings().map((item) => [item.id, item]));

const columns = [
  "id", "type", "title", "brand", "machineType", "cropIds", "operations",
  "areaMin", "areaMax", "price", "region", "condition", "inspectedAt",
  "included", "pickup", "description", "summary", "booked", "owner", "status",
];
const jsonColumns = ["cropIds", "operations", "booked"];

export function initListingsDb(location = ":memory:") {
  if (database) return;
  if (location === localDatabase) mkdirSync(localDirectory, { recursive: true });
  const connection = new DatabaseSync(location, { timeout: 5000 });
  try {
    connection.exec(`
      CREATE TABLE IF NOT EXISTS listings (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('rent', 'sale')),
        title TEXT NOT NULL,
        brand TEXT NOT NULL,
        machineType TEXT NOT NULL,
        cropIds TEXT NOT NULL CHECK (json_type(cropIds) = 'array'),
        operations TEXT NOT NULL CHECK (json_type(operations) = 'array'),
        areaMin INTEGER NOT NULL CHECK (areaMin > 0),
        areaMax INTEGER NOT NULL CHECK (areaMax >= areaMin),
        price INTEGER NOT NULL CHECK (price >= 0),
        region TEXT NOT NULL,
        condition TEXT NOT NULL CHECK (condition IN ('good', 'used', 'repair')),
        inspectedAt TEXT NOT NULL,
        included TEXT NOT NULL,
        pickup TEXT NOT NULL,
        description TEXT NOT NULL,
        summary TEXT NOT NULL,
        booked TEXT NOT NULL CHECK (json_type(booked) = 'array'),
        owner INTEGER NOT NULL CHECK (owner IN (0, 1)),
        status TEXT NOT NULL CHECK (status IN ('open', 'dealing', 'done'))
      ) STRICT;
      BEGIN IMMEDIATE;
    `);
    const insert = connection.prepare(`
      INSERT INTO listings (${columns.join(", ")})
      VALUES (${columns.map(() => "?").join(", ")})
      ON CONFLICT(id) DO UPDATE SET
        ${columns.slice(1).map((key) => `${key} = excluded.${key}`).join(", ")}
    `);
    for (const item of catalog.values()) {
      insert.run(...columns.map((key) => jsonColumns.includes(key) ? JSON.stringify(item[key])
        : key === "owner" ? Number(item[key]) : item[key]));
    }
    connection.exec("COMMIT");
    listQuery = connection.prepare("SELECT * FROM listings ORDER BY rowid");
    database = connection;
  } catch (error) {
    connection.close();
    throw error;
  }
}

export function listListings() {
  initListingsDb();
  return listQuery.all().map((row) => {
    for (const key of jsonColumns) row[key] = JSON.parse(row[key]);
    const model = catalog.get(row.id);
    return { ...row, owner: Boolean(row.owner), ...(model ? {
      modelId: model.modelId, model: model.model, specification: model.specification, demo: true,
    } : {}) };
  });
}
