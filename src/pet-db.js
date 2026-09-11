import { createClient } from "@supabase/supabase-js";

const TABLE_NAME = "pets";
const DEVICE_ID_KEY = "paintmomo.deviceId";
const DEVICE_HEADER = "x-device-id";

let clientPromise = null;

function readEnv(name) {
  const env = import.meta.env || {};
  const value = env[name];
  return typeof value === "string" ? value.trim() : "";
}

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

export function openPetDb() {
  if (clientPromise) return clientPromise;
  clientPromise = new Promise((resolve, reject) => {
    const url = readEnv("VITE_SUPABASE_URL");
    const key = readEnv("VITE_SUPABASE_PUBLISHABLE_KEY");
    if (!url || !key) {
      return reject(
        new Error(
          "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.",
        ),
      );
    }
    const deviceId = readDeviceId();
    if (!deviceId) {
      return reject(new Error("Device storage is not available."));
    }
    try {
      const client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { [DEVICE_HEADER]: deviceId } },
      });
      resolve({ client, deviceId });
    } catch (err) {
      reject(err);
    }
  });
  clientPromise.catch(() => {
    clientPromise = null;
  });
  return clientPromise;
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
  const { client, deviceId } = await openPetDb();
  const { data, error } = await client
    .from(TABLE_NAME)
    .select("id, data, created_at, updated_at")
    .eq("device_id", deviceId)
    .order("created_at", { ascending: true });
  throwIfError(error, "Could not load pets");
  return (data || []).map(toRecord);
}

export async function getPetById(id) {
  if (!id) return null;
  const { client, deviceId } = await openPetDb();
  const { data, error } = await client
    .from(TABLE_NAME)
    .select("id, data, created_at, updated_at")
    .eq("device_id", deviceId)
    .eq("id", id)
    .maybeSingle();
  throwIfError(error, "Could not load pet");
  return toRecord(data);
}

// The pets table keys rows by (owner_key, id), where owner_key is a generated
// column equal to the account id or, for browsers without an account, the
// device id. Rows written here carry only the device id.
export async function savePet(pet) {
  if (!pet || !pet.id) throw new Error("Pet must have an id");
  const { client, deviceId } = await openPetDb();
  const record = {
    ...pet,
    updatedAt: Date.now(),
    createdAt: pet.createdAt || Date.now(),
  };
  const { error } = await client.from(TABLE_NAME).upsert(
    {
      id: record.id,
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
  const { client, deviceId } = await openPetDb();
  const { error } = await client
    .from(TABLE_NAME)
    .delete()
    .eq("device_id", deviceId)
    .eq("id", id);
  throwIfError(error, "Storage request failed");
  return true;
}
