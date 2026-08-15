"use server";

import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { hashDeviceId } from "@/lib/mediaOwner";
import {
  s3,
  FOLDER_PREFIX,
  BUCKETS,
  WRITE_ORDER,
  isBucketConfigured,
  type BucketId,
} from "@/lib/r2";

export async function uploadToR2Action(formData: FormData) {
  try {
    const file = formData.get("file") as File;
    const deviceId = formData.get("deviceId") as string | null;
    if (!file) {
      return { success: false, error: "No file provided" };
    }
    if (!deviceId) {
      return { success: false, error: "Missing device id" };
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const ownerTag = hashDeviceId(deviceId);
    const key = `${FOLDER_PREFIX}${ownerTag}__${file.name}`;

    let lastError: unknown = null;
    let uploadedTo: BucketId | null = null;

    for (const bucketId of WRITE_ORDER) {
      if (!isBucketConfigured(bucketId)) continue;

      try {
        await s3.send(
          new PutObjectCommand({
            Bucket: BUCKETS[bucketId].name,
            Key: key,
            Body: buffer,
            ContentType: file.type,
          }),
        );
        uploadedTo = bucketId;
        break;
      } catch (err) {
        console.error(`R2 upload to "${bucketId}" bucket failed:`, err);
        lastError = err;
      }
    }

    if (!uploadedTo) {
      throw lastError instanceof Error
        ? lastError
        : new Error("All configured R2 buckets rejected the upload");
    }

    const publicUrl = `${BUCKETS[uploadedTo].publicUrl}/${key}`;

    return { success: true, publicUrl, key, bucket: uploadedTo };
  } catch (error: any) {
    console.error("R2 Upload Action Error:", error);
    return { success: false, error: error.message };
  }
}

export async function deleteFromR2Action(
  key: string,
  deviceId: string,
  bucket: BucketId = "primary",
) {
  try {
    if (!key || !deviceId) {
      return { success: false, error: "Missing key or device id" };
    }
    if (!key.startsWith(FOLDER_PREFIX)) {
      return { success: false, error: "Invalid key" };
    }

    const ownerTag = hashDeviceId(deviceId);
    const filename = key.slice(FOLDER_PREFIX.length);
    if (!filename.startsWith(`${ownerTag}__`)) {
      return { success: false, error: "You can only delete media you captured" };
    }

    if (!isBucketConfigured(bucket)) {
      return { success: false, error: "Unknown storage bucket" };
    }

    await s3.send(
      new DeleteObjectCommand({
        Bucket: BUCKETS[bucket].name,
        Key: key,
      }),
    );

    return { success: true };
  } catch (error: any) {
    console.error("R2 Delete Action Error:", error);
    return { success: false, error: error.message };
  }
}
