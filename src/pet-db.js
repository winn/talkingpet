import { getSupabase, getSession } from "./auth.js";

/**
 * Pets live in Supabase (`public.pets`), one JSON record per row, scoped to
 * the signed-in account by row level security. The per-browser device id is
 * still recorded for diagnostics.
 */

const TABLE_NAME = "pets";
const DEVICE_ID_KEY = "paintmomo.deviceId";

function readDeviceId() {
  if (typeof localStorage === "undefined") return null;
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export function getDeviceId() {
  return readDeviceId();
}

/** Resolves { client, deviceId, userId }. Rejects when not configured or signed out. */
export async function openPetDb() {
  const client = getSupabase();
  const deviceId = readDeviceId();
  if (!deviceId) throw new Error("Device storage is not available.");
  const session = await getSession();
  if (!session?.user) throw new Error("Sign in to see your pets.");
  return { client, deviceId, userId: session.user.id };
}

function toRecord(row) {
  if (!row) return null;
  const data = row.data && typeof row.data === "object" ? row.data : {};
  return {
    ...data,
    id: row.id,
    createdAt: Number(row.created_at) || data.createdAt || Date.now(),
    updatedAt: Number(row.updated_at) || data.updatedAt || Date.now(),
  };
}

function throwIfError(error, fallback) {
  if (error) throw new Error(error.message || fallback);
}

export async function getAllPets() {
  const { client, userId } = await openPetDb();
  const { data, error } = await client
    .from(TABLE_NAME)
    .select("id, data, created_at, updated_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  throwIfError(error, "Could not load pets");
  return (data || []).map(toRecord);
}

export async function getPetById(id) {
  if (!id) return null;
  const { client, userId } = await openPetDb();
  const { data, error } = await client
    .from(TABLE_NAME)
    .select("id, data, created_at, updated_at")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  throwIfError(error, "Could not load pet");
  return toRecord(data);
}

export async function savePet(pet) {
  if (!pet || !pet.id) throw new Error("Pet must have an id");
  const { client, deviceId, userId } = await openPetDb();
  const record = {
    ...pet,
    updatedAt: Date.now(),
    createdAt: pet.createdAt || Date.now(),
  };
  const { error } = await client.from(TABLE_NAME).upsert(
    {
      id: record.id,
      user_id: userId,
      device_id: deviceId,
      data: record,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    },
    { onConflict: "owner_key,id" },
  );
  throwIfError(error, "Storage request failed");
  return record;
}

export async function deletePetById(id) {
  if (!id) return false;
  const { client, userId } = await openPetDb();
  const { error } = await client
    .from(TABLE_NAME)
    .delete()
    .eq("user_id", userId)
    .eq("id", id);
  throwIfError(error, "Storage request failed");
  return true;
}
