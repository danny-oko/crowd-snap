"use server";

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

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
    if (!file) {
      return { success: false, error: "No file provided" };
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const key = `${FOLDER_PREFIX}${file.name}`;

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
