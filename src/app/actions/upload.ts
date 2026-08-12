"use server";

import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { hashDeviceId } from "@/lib/mediaOwner";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
  forcePathStyle: true,
});

const FOLDER_PREFIX = "events/enh-amar-bday/";

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

    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: file.type,
    });

    await s3.send(command);

    const publicDomain = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || "";
    const publicUrl = `${publicDomain}/${key}`;

    return { success: true, publicUrl };
  } catch (error: any) {
    console.error("R2 Upload Action Error:", error);
    return { success: false, error: error.message };
  }
}

export async function deleteFromR2Action(key: string, deviceId: string) {
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

    await s3.send(
      new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
      }),
    );

    return { success: true };
  } catch (error: any) {
    console.error("R2 Delete Action Error:", error);
    return { success: false, error: error.message };
  }
}
