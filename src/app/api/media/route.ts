import { NextRequest, NextResponse } from "next/server";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
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

export async function GET(request: NextRequest) {
  try {
    const deviceId = request.headers.get("x-device-id");
    const ownerTag = deviceId ? hashDeviceId(deviceId) : null;

    const command = new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME,
      Prefix: FOLDER_PREFIX,
    });

    const response = await s3.send(command);

    const publicDomain = (process.env.NEXT_PUBLIC_R2_PUBLIC_URL || "").replace(
      /\/$/,
      "",
    );

    const items = (response.Contents || [])
      .filter(
        (item) =>
          item.Key && item.Key !== FOLDER_PREFIX && (item.Size ?? 0) > 0,
      )
      .sort(
        (a, b) =>
          (b.LastModified?.getTime() || 0) - (a.LastModified?.getTime() || 0),
      )
      .map((item) => {
        const isVideo = item.Key?.match(/\.(mp4|webm|mov)$/i);
        const filename = item.Key?.slice(FOLDER_PREFIX.length) || "";
        const isOwner = ownerTag ? filename.startsWith(`${ownerTag}__`) : false;
        return {
          url: `${publicDomain}/${item.Key}`,
          type: isVideo ? ("video" as const) : ("image" as const),
          key: item.Key,
          isOwner,
        };
      });

    return NextResponse.json({ items });
  } catch (error: any) {
    console.error("Failed to fetch R2 items:", error);
    return NextResponse.json(
      { items: [], error: error.message },
      { status: 500 },
    );
  }
}
