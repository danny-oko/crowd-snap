import { NextRequest, NextResponse } from "next/server";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { hashDeviceId } from "@/lib/mediaOwner";
import {
  s3,
  FOLDER_PREFIX,
  BUCKETS,
  WRITE_ORDER,
  isBucketConfigured,
  type BucketId,
} from "@/lib/r2";

export async function GET(request: NextRequest) {
  try {
    const deviceId = request.headers.get("x-device-id");
    const ownerTag = deviceId ? hashDeviceId(deviceId) : null;

    const configuredBuckets = WRITE_ORDER.filter(isBucketConfigured);

    const listings = await Promise.all(
      configuredBuckets.map(async (bucketId) => {
        try {
          const response = await s3.send(
            new ListObjectsV2Command({
              Bucket: BUCKETS[bucketId].name,
              Prefix: FOLDER_PREFIX,
            }),
          );
          return { bucketId, contents: response.Contents || [] };
        } catch (err) {
          console.error(`Failed to list R2 "${bucketId}" bucket:`, err);
          return { bucketId, contents: [] };
        }
      }),
    );

    const items = listings
      .flatMap(({ bucketId, contents }) =>
        contents
          .filter(
            (item) =>
              item.Key && item.Key !== FOLDER_PREFIX && (item.Size ?? 0) > 0,
          )
          .map((item) => {
            const isVideo = item.Key?.match(/\.(mp4|webm|mov)$/i);
            const filename = item.Key?.slice(FOLDER_PREFIX.length) || "";
            const isOwner = ownerTag
              ? filename.startsWith(`${ownerTag}__`)
              : false;
            return {
              url: `${BUCKETS[bucketId as BucketId].publicUrl}/${item.Key}`,
              type: isVideo ? ("video" as const) : ("image" as const),
              key: item.Key,
              bucket: bucketId as BucketId,
              isOwner,
              lastModified: item.LastModified?.getTime() || 0,
            };
          }),
      )
      .sort((a, b) => b.lastModified - a.lastModified)
      .map(({ lastModified, ...item }) => item);

    return NextResponse.json({ items });
  } catch (error: any) {
    console.error("Failed to fetch R2 items:", error);
    return NextResponse.json(
      { items: [], error: error.message },
      { status: 500 },
    );
  }
}
