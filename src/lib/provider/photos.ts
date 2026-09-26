/**
 * CAPACITY PHOTOS — real pictures of the vehicle being offered.
 *
 * Operators upload photographs of their own vehicle into their own folder of
 * the private `capacity-photos` bucket. The stored paths are recorded against
 * the listing, and browsing customers read them through short-lived signed
 * links. No stock photography is ever substituted: a listing without uploaded
 * pictures says so.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";

export const CAPACITY_PHOTO_BUCKET = "capacity-photos";
export const MAX_CAPACITY_PHOTOS = 8;
const MAX_BYTES = 8 * 1024 * 1024;
const SIGNED_URL_TTL = 60 * 60; // one hour

export const PHOTO_REFUSAL: Record<string, string> = {
  PHOTO_TOO_LARGE: "That picture is larger than 8 MB. Please upload a smaller one.",
  PHOTO_TYPE_UNSUPPORTED: "Please upload a JPEG, PNG or WebP picture.",
  TOO_MANY_PHOTOS: `You can show up to ${MAX_CAPACITY_PHOTOS} pictures on a listing.`,
  NOT_YOUR_CAPACITY: "This listing belongs to another operator.",
  CAPACITY_LOCKED_FOR_EDITING: "This listing is under review, so its pictures cannot change now.",
};

export const explainPhotoRefusal = (m: string) => PHOTO_REFUSAL[m] ?? m;

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

/** Uploads one photograph and returns its storage path. */
export async function uploadCapacityPhoto(capacityId: string, file: File): Promise<string> {
  const { data: session } = await supabase.auth.getUser();
  const uid = session.user?.id;
  if (!uid) throw new Error("AUTHENTICATION_REQUIRED");
  if (file.size > MAX_BYTES) throw new Error("PHOTO_TOO_LARGE");
  if (!ALLOWED.includes(file.type)) throw new Error("PHOTO_TYPE_UNSUPPORTED");

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${uid}/${capacityId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(CAPACITY_PHOTO_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

/** Records the full ordered photo list against the listing. */
export async function setCapacityPhotos(capacityId: string, paths: string[]) {
   
  const { data, error } = await untypedDb.rpc("provider_capacity_photos_set", {
    _capacity_id: capacityId,
    _paths: paths,
  });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; photo_paths: string[] };
}

export async function removeCapacityPhoto(capacityId: string, current: string[], path: string) {
  await supabase.storage.from(CAPACITY_PHOTO_BUCKET).remove([path]);
  return setCapacityPhotos(capacityId, current.filter((p) => p !== path));
}

/** Signed links for a batch of stored paths, keyed by path. */
export async function signCapacityPhotos(paths: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length === 0) return {};
  const { data, error } = await supabase.storage
    .from(CAPACITY_PHOTO_BUCKET)
    .createSignedUrls(unique, SIGNED_URL_TTL);
  if (error) return {};
  const out: Record<string, string> = {};
  (data ?? []).forEach((row, i) => {
    const url = row.signedUrl;
    if (url) out[row.path ?? unique[i]] = url;
  });
  return out;
}
