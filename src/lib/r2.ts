import { S3Client } from "@aws-sdk/client-s3";

export const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
  forcePathStyle: true,
});

export const FOLDER_PREFIX = "events/enh-amar-bday/";

export type BucketId = "primary" | "backup";

type BucketConfig = { id: BucketId; name: string; publicUrl: string };

export const BUCKETS: Record<BucketId, BucketConfig> = {
  primary: {
    id: "primary",
    name: process.env.R2_BUCKET_NAME || "",
    publicUrl: (process.env.NEXT_PUBLIC_R2_PUBLIC_URL || "").replace(/\/$/, ""),
  },
  backup: {
    id: "backup",
    name: process.env.R2_BUCKET_NAME_BACKUP || "",
    publicUrl: (process.env.NEXT_PUBLIC_R2_PUBLIC_URL_BACKUP || "").replace(
      /\/$/,
      "",
    ),
  },
};

// Order to try writes in: primary first, backup as overflow if primary fails.
export const WRITE_ORDER: BucketId[] = ["primary", "backup"];

export function isBucketConfigured(bucket: BucketId) {
  return Boolean(BUCKETS[bucket].name && BUCKETS[bucket].publicUrl);
}
