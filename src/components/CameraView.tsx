"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  RefreshCw,
  Image as ImageIcon,
  Video,
  Download,
  Settings,
  X,
  Trash2,
} from "lucide-react";
import { Drawer } from "vaul";
import { uploadToR2Action, deleteFromR2Action } from "@/app/actions/upload";

const ZOOM_PRESETS = [0.5, 1, 1.5, 2, 5];
const DEVICE_ID_STORAGE_KEY = "crowd-snap-device-id";

type MediaItem = {
  url: string;
  type: "image" | "video";
  key?: string;
  bucket?: "primary" | "backup";
  blob?: Blob;
  isOwner?: boolean;
};

type AspectRatio = "16:9" | "4:3" | "1:1";

// width / height, portrait orientation
const ASPECT_RATIOS: Record<AspectRatio, number> = {
  "16:9": 9 / 16,
  "4:3": 3 / 4,
  "1:1": 1,
};

export default function CameraView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<NodeJS.Timeout | null>(null);
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pressStartTimeRef = useRef<number>(0);
  const lastTapRef = useRef<number>(0);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [showSettings, setShowSettings] = useState(false);

  const [mediaList, setMediaList] = useState<MediaItem[]>([]);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const previewVideoRefs = useRef<(HTMLVideoElement | null)[]>([]);

  const [deviceId] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    let id = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, id);
    }
    return id;
  });

  const [isFlashing, setIsFlashing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const [zoom, setZoom] = useState(1);
  const [zoomCap, setZoomCap] = useState<{
    min: number;
    max: number;
    step: number;
  }>({
    min: 1,
    max: 5,
    step: 0.1,
  });

  const pointerStartYRef = useRef<number>(0);
  const initialZoomOnPointerRef = useRef<number>(1);
  const initialPinchDistRef = useRef<number | null>(null);
  const zoomFrameRef = useRef<number | null>(null);
  const pendingZoomRef = useRef<number | null>(null);

  const fetchBucketItems = useCallback(async () => {
    try {
      const res = await fetch("/api/media", {
        headers: deviceId ? { "x-device-id": deviceId } : undefined,
      });
      if (res.ok) {
        const data = await res.json();
        if (data.items) {
          setMediaList(data.items);
        }
      }
    } catch (err) {
      console.error("Failed to sync bucket media:", err);
    }
  }, [deviceId]);

  useEffect(() => {
    fetchBucketItems();
    const interval = setInterval(fetchBucketItems, 3000);
    return () => clearInterval(interval);
  }, [fetchBucketItems]);

  useEffect(() => {
    let currentStream: MediaStream | null = null;

    async function startCamera() {
      try {
        if (stream) {
          stream.getTracks().forEach((track) => track.stop());
        }

        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            facingMode: facingMode,
          },
          audio: true,
        });

        currentStream = mediaStream;
        setStream(mediaStream);

        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }

        const videoTrack = mediaStream.getVideoTracks()[0];
        if (videoTrack && "getCapabilities" in videoTrack) {
          const capabilities = videoTrack.getCapabilities() as any;
          if (capabilities.zoom) {
            const min = capabilities.zoom.min ?? 1;
            const max = capabilities.zoom.max ?? 5;
            const step = capabilities.zoom.step || 0.1;
            setZoomCap({ min, max, step });

            // Some devices default multi-lens back cameras to a wide/ultra-wide
            // lens (e.g. zoom 0.5) even though our UI defaults to showing "1x".
            // Force the hardware to true 1x so the displayed zoom is accurate.
            if (min <= 1 && max >= 1) {
              await videoTrack
                .applyConstraints({ advanced: [{ zoom: 1 }] } as any)
                .catch(() => {});
              setZoom(1);
            } else {
              const settings = videoTrack.getSettings() as any;
              setZoom(settings.zoom ?? min);
            }
          } else {
            setZoomCap({ min: 1, max: 1, step: 1 });
            setZoom(1);
          }
        }
      } catch (err) {
        console.error("Error accessing camera:", err);
        setError("Could not access camera and microphone.");
      }
    }

    startCamera();

    return () => {
      if (currentStream) {
        currentStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [facingMode]);

  const applyHardwareZoom = useCallback(
    (targetZoom: number) => {
      const clamped = Math.min(Math.max(targetZoom, zoomCap.min), zoomCap.max);
      setZoom(clamped);

      if (stream) {
        const track = stream.getVideoTracks()[0];
        if (track && "applyConstraints" in track) {
          const constraints = { advanced: [{ zoom: clamped }] } as any;
          track.applyConstraints(constraints).catch(() => {});
        }
      }
    },
    [stream, zoomCap],
  );

  // Pointer/touch move events can fire far faster than the display refreshes
  // (especially high-frequency touch reporting), and each one was triggering
  // a full re-render plus a hardware applyConstraints() call. Coalesce to at
  // most one zoom commit per animation frame so small finger movements don't
  // hammer the camera pipeline and cause visible preview stutter.
  const queueZoomUpdate = useCallback(
    (targetZoom: number) => {
      pendingZoomRef.current = targetZoom;
      if (zoomFrameRef.current !== null) return;
      zoomFrameRef.current = requestAnimationFrame(() => {
        zoomFrameRef.current = null;
        if (pendingZoomRef.current !== null) {
          applyHardwareZoom(pendingZoomRef.current);
          pendingZoomRef.current = null;
        }
      });
    },
    [applyHardwareZoom],
  );

  useEffect(() => {
    return () => {
      if (zoomFrameRef.current !== null) {
        cancelAnimationFrame(zoomFrameRef.current);
      }
    };
  }, []);

  const triggerDownload = (url: string, filename: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const deleteMedia = async (item: MediaItem) => {
    if (!item.key || !deviceId || !item.isOwner) return;
    if (!window.confirm("Delete this item? This can't be undone.")) return;

    const res = await deleteFromR2Action(
      item.key,
      deviceId,
      item.bucket || "primary",
    );
    if (res.success) {
      setMediaList((prev) => prev.filter((m) => m.key !== item.key));
      setPreviewIndex(null);
    } else {
      console.error("Delete failed:", res.error);
    }
  };

  const uploadToR2 = async (
    blob: Blob,
    fileName: string,
    contentType: string,
  ) => {
    try {
      const formData = new FormData();
      const file = new File([blob], fileName, { type: contentType });
      formData.append("file", file);
      formData.append("deviceId", deviceId);

      const res = await uploadToR2Action(formData);
      if (!res.success) {
        throw new Error(res.error);
      }
      if (!res.publicUrl) {
        throw new Error("Upload succeeded without a URL");
      }

      // Show the new capture immediately instead of waiting on a full
      // bucket re-list, which gets slower the more the event fills up and
      // was the main source of lag right after taking a photo/video.
      setMediaList((prev) => [
        {
          url: res.publicUrl,
          type: contentType.startsWith("video") ? "video" : "image",
          key: res.key,
          bucket: res.bucket,
          isOwner: true,
        },
        ...prev,
      ]);
      return res.publicUrl;
    } catch (err) {
      console.error("R2 Upload error:", err);
      return null;
    }
  };

  const isSoftwareZoom = !(
    stream?.getVideoTracks()[0]?.getCapabilities?.() as any
  )?.zoom;

  const takePhoto = async () => {
    if (!videoRef.current) return;

    setIsFlashing(true);
    setTimeout(() => setIsFlashing(false), 150);

    const video = videoRef.current;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    const targetRatio = ASPECT_RATIOS[aspectRatio]; // width / height

    let sw: number;
    let sh: number;
    if (vw / vh > targetRatio) {
      sh = vh;
      sw = vh * targetRatio;
    } else {
      sw = vw;
      sh = vw / targetRatio;
    }
    let sx = (vw - sw) / 2;
    let sy = (vh - sh) / 2;

    if (isSoftwareZoom && zoom > 1) {
      const zw = sw / zoom;
      const zh = sh / zoom;
      sx += (sw - zw) / 2;
      sy += (sh - zh) / 2;
      sw = zw;
      sh = zh;
    }

    const canvas = canvasRef.current || document.createElement("canvas");
    canvas.width = Math.round(sw);
    canvas.height = Math.round(sh);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (facingMode === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      async (compressedBlob) => {
        if (!compressedBlob) return;
        const fileName = `photo-${Date.now()}.webp`;
        await uploadToR2(compressedBlob, fileName, "image/webp");
      },
      "image/webp",
      0.8,
    );
  };

  const getSupportedMimeType = () => {
    const types = [
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
  };

  const startRecording = useCallback(() => {
    if (!stream) return;

    videoChunksRef.current = [];
    const mimeType = getSupportedMimeType();

    try {
      const mediaRecorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          videoChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setIsRecording(false);
        setRecordingSeconds(0);
        if (recordTimerRef.current) {
          clearInterval(recordTimerRef.current);
          recordTimerRef.current = null;
        }

        const finalMime = mimeType || "video/mp4";
        const ext = finalMime.includes("mp4") ? "mp4" : "webm";
        const videoBlob = new Blob(videoChunksRef.current, { type: finalMime });
        const fileName = `video-${Date.now()}.${ext}`;

        await uploadToR2(videoBlob, fileName, finalMime);
      };

      mediaRecorder.start(100);
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);

      let seconds = 0;
      recordTimerRef.current = setInterval(() => {
        seconds += 1;
        setRecordingSeconds(seconds);
        if (seconds >= 60) {
          stopRecording();
        }
      }, 1000);
    } catch (err) {
      console.error("Failed to start recording:", err);
    }
  }, [stream]);

  const stopRecording = useCallback(() => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    pointerStartYRef.current = e.clientY;
    initialZoomOnPointerRef.current = zoom;
    pressStartTimeRef.current = Date.now();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    holdTimerRef.current = setTimeout(() => {
      startRecording();
    }, 200);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isRecording) return;
    const dragDistance = pointerStartYRef.current - e.clientY;
    const zoomFactor = dragDistance / 150;
    const targetZoom = initialZoomOnPointerRef.current + zoomFactor;
    queueZoomUpdate(targetZoom);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }

    const pressDuration = Date.now() - pressStartTimeRef.current;

    if (isRecording) {
      stopRecording();
    } else if (pressDuration < 200) {
      takePhoto();
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const dist = Math.hypot(
        touch1.clientX - touch2.clientX,
        touch1.clientY - touch2.clientY,
      );

      if (initialPinchDistRef.current === null) {
        initialPinchDistRef.current = dist;
      } else {
        const factor = dist / initialPinchDistRef.current;
        queueZoomUpdate(zoom * factor);
        initialPinchDistRef.current = dist;
      }
    }
  };

  const handleTouchEnd = () => {
    initialPinchDistRef.current = null;
  };

  const toggleCamera = () => {
    setFacingMode((prev) => (prev === "user" ? "environment" : "user"));
  };

  const closePreview = () => setPreviewIndex(null);

  const scrollToPreviewItem = useCallback((index: number) => {
    const el = previewScrollRef.current?.children[index] as
      | HTMLElement
      | undefined;
    el?.scrollIntoView({ behavior: "smooth", inline: "center" });
  }, []);

  useEffect(() => {
    if (previewIndex === null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePreview();
      else if (e.key === "ArrowLeft")
        scrollToPreviewItem(Math.max(0, activeIndex - 1));
      else if (e.key === "ArrowRight")
        scrollToPreviewItem(Math.min(mediaList.length - 1, activeIndex + 1));
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewIndex, activeIndex, mediaList.length, scrollToPreviewItem]);

  // Jump instantly (no animation) to the tapped item once the preview mounts.
  useEffect(() => {
    if (previewIndex === null) return;
    setActiveIndex(previewIndex);
    const el = previewScrollRef.current?.children[previewIndex] as
      | HTMLElement
      | undefined;
    el?.scrollIntoView({ behavior: "instant" as ScrollBehavior, inline: "center" });
  }, [previewIndex]);

  const handlePreviewScroll = () => {
    const container = previewScrollRef.current;
    if (!container) return;
    const index = Math.round(container.scrollLeft / container.clientWidth);
    setActiveIndex((prev) => (prev === index ? prev : index));
  };

  // Auto-play only the item currently centered in the scroller.
  useEffect(() => {
    if (previewIndex === null) return;
    previewVideoRefs.current.forEach((video, index) => {
      if (!video) return;
      if (index === activeIndex) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    });
  }, [activeIndex, previewIndex]);

  const handleVideoTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      toggleCamera();
    }
    lastTapRef.current = now;
  };

  const getAspectRatioClass = () => {
    switch (aspectRatio) {
      case "16:9":
        return "w-full aspect-[9/16]";
      case "4:3":
        return "w-full aspect-[3/4]";
      case "1:1":
        return "w-full aspect-square";
      default:
        return "w-full aspect-[9/16]";
    }
  };

  const mirrorTransform = facingMode === "user" ? "scaleX(-1)" : "scaleX(1)";
  const zoomTransform = `scale(${isSoftwareZoom ? zoom : 1})`;

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-black text-white select-none touch-none overflow-hidden">
      <canvas ref={canvasRef} className="hidden" />

      {error ? (
        <div className="text-center text-red-500 max-w-sm font-medium z-20">
          {error}
        </div>
      ) : (
        <>
          {/* Preview box — only this resizes with the aspect ratio */}
          <div className="relative w-full h-full flex items-center justify-center">
            <div
              className={`relative overflow-hidden bg-neutral-900 transition-all duration-300 ${getAspectRatioClass()}`}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onPointerDown={handleVideoTap}
            >
              {isFlashing && (
                <div className="absolute inset-0 bg-white z-30 transition-opacity duration-150" />
              )}

              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover transition-transform duration-75 pointer-events-none"
                style={{
                  transform: `${mirrorTransform} ${zoomTransform}`,
                }}
              />
            </div>
          </div>

          {/* Overlays — anchored to the full screen, so they never shift with the ratio */}

          {/* Settings (top-right) */}
          <div className="absolute top-6 right-6 z-20 flex flex-col items-end gap-2 pointer-events-auto">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-md border border-white/20 active:scale-90 transition"
            >
              <Settings className="w-5 h-5 text-white" />
            </button>

            {showSettings && (
              <div className="flex flex-col gap-2 bg-black/60 backdrop-blur-md p-2 rounded-xl border border-white/20">
                {(["16:9", "4:3", "1:1"] as AspectRatio[]).map((ratio) => (
                  <button
                    key={ratio}
                    onClick={() => {
                      setAspectRatio(ratio);
                      setShowSettings(false);
                    }}
                    className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                      aspectRatio === ratio
                        ? "bg-white text-black"
                        : "text-white hover:bg-white/20"
                    }`}
                  >
                    {ratio}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* REC indicator (top-center) */}
          {isRecording && (
            <div className="absolute top-6 left-0 right-0 flex justify-center z-20 pointer-events-none">
              <div className="bg-black/60 backdrop-blur-md px-4 py-1.5 rounded-full border border-red-500/30">
                <p className="text-xs font-bold text-red-500 animate-pulse tracking-wider">
                  REC 00:
                  {recordingSeconds < 10
                    ? `0${recordingSeconds}`
                    : recordingSeconds}{" "}
                  / 01:00
                </p>
              </div>
            </div>
          )}

          {/* Bottom controls (zoom + action row) */}
          <div className="absolute bottom-0 left-0 right-0 p-6 pb-12 flex flex-col items-center gap-6 z-10 bg-gradient-to-t from-black/80 via-black/40 to-transparent pointer-events-none">
            <div className="flex gap-2 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 pointer-events-auto">
              {ZOOM_PRESETS.map((preset) => (
                <button
                  key={preset}
                  onClick={() => applyHardwareZoom(preset)}
                  className={`w-8 h-8 rounded-full text-xs font-bold transition-all ${
                    Math.abs(zoom - preset) < 0.1
                      ? "bg-white text-black scale-105"
                      : "bg-black/20 text-white hover:bg-white/20"
                  }`}
                >
                  {preset}x
                </button>
              ))}
            </div>

            <div className="w-full max-w-md mx-auto flex justify-between items-center px-4">
              <button
                onClick={toggleCamera}
                className="w-12 h-12 flex items-center justify-center rounded-full border border-white/20 bg-black/40 backdrop-blur-md pointer-events-auto active:scale-90 transition shadow-md"
                title="Flip Camera"
              >
                <RefreshCw className="w-5 h-5 text-white" />
              </button>

              <button
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                className={`w-20 h-20 rounded-full flex items-center justify-center border-[5px] transition-all shadow-2xl pointer-events-auto cursor-pointer ${
                  isRecording
                    ? "border-red-500 scale-110"
                    : "border-white active:scale-90"
                }`}
              >
                <div
                  className={`transition-all ${
                    isRecording
                      ? "w-8 h-8 bg-red-500 rounded-md"
                      : "w-14 h-14 bg-white rounded-full"
                  }`}
                />
              </button>

              <button
                onClick={() => setIsGalleryOpen(true)}
                className="flex items-center gap-3 pointer-events-auto group"
              >
                <div className="text-right hidden sm:block">
                  <p className="text-white text-base font-black leading-none">
                    {mediaList.length}
                  </p>
                  <p className="text-white/60 text-[9px] font-bold tracking-wider uppercase">
                    Items
                  </p>
                </div>
                <div className="w-12 h-12 rounded-xl border border-white/20 overflow-hidden bg-neutral-800 flex items-center justify-center shadow-md">
                  {mediaList.length > 0 ? (
                    mediaList[0].type === "video" ? (
                      <Video className="w-6 h-6 text-white" />
                    ) : (
                      <img
                        src={mediaList[0].url}
                        alt="Latest Media"
                        className="w-full h-full object-cover"
                      />
                    )
                  ) : (
                    <ImageIcon className="w-6 h-6 text-neutral-400" />
                  )}
                </div>
              </button>
            </div>
          </div>

          <Drawer.Root open={isGalleryOpen} onOpenChange={setIsGalleryOpen}>
            <Drawer.Portal>
              <Drawer.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40" />
              <Drawer.Content className="fixed inset-x-0 bottom-0 top-16 bg-neutral-950 rounded-t-[32px] p-6 shadow-2xl z-50 flex flex-col border-t border-neutral-800">
                <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-neutral-700 mb-6" />

                <div className="mb-4 flex items-center justify-between max-w-5xl mx-auto w-full">
                  <div>
                    <h2 className="text-xl font-bold text-white">
                      Cloud Gallery
                    </h2>
                    <p className="text-xs text-neutral-400">
                      {mediaList.length} items synced
                    </p>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto w-full max-w-5xl mx-auto">
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 pb-8">
                    {mediaList.map((item, index) => (
                      <div
                        key={item.key || index}
                        role="button"
                        tabIndex={0}
                        onClick={() => setPreviewIndex(index)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ")
                            setPreviewIndex(index);
                        }}
                        className="group aspect-square bg-neutral-900 rounded-xl overflow-hidden border border-neutral-800 shadow-sm relative text-left cursor-pointer"
                      >
                        {item.type === "video" ? (
                          <>
                            <video
                              src={item.url}
                              className="w-full h-full object-cover pointer-events-none"
                              muted
                              playsInline
                              preload="metadata"
                            />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                              <div className="w-9 h-9 rounded-full bg-black/60 backdrop-blur-md flex items-center justify-center border border-white/20">
                                <Video className="w-4 h-4 text-white" />
                              </div>
                            </div>
                          </>
                        ) : (
                          <img
                            src={item.url}
                            alt={`Captured media ${index + 1}`}
                            className="w-full h-full object-cover"
                          />
                        )}

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const ext = item.type === "video" ? "mp4" : "webp";
                            triggerDownload(
                              item.url,
                              `media-${index + 1}.${ext}`,
                            );
                          }}
                          className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-black/70 hover:bg-black text-white flex items-center justify-center backdrop-blur-md transition border border-white/20 active:scale-90"
                          title="Download to device"
                        >
                          <Download className="w-4 h-4" />
                        </button>

                        {item.isOwner && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteMedia(item);
                            }}
                            className="absolute bottom-2 left-2 w-8 h-8 rounded-full bg-black/70 hover:bg-red-600 text-white flex items-center justify-center backdrop-blur-md transition border border-white/20 active:scale-90"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </Drawer.Content>
            </Drawer.Portal>
          </Drawer.Root>

          {previewIndex !== null && mediaList.length > 0 && (
            <div className="fixed inset-0 z-[60] bg-black flex items-center justify-center">
              <button
                onClick={closePreview}
                className="absolute top-6 right-6 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-black/50 backdrop-blur-md border border-white/20 active:scale-90 transition"
                title="Close"
              >
                <X className="w-5 h-5 text-white" />
              </button>

              {mediaList[activeIndex]?.isOwner && (
                <button
                  onClick={() => deleteMedia(mediaList[activeIndex])}
                  className="absolute top-6 left-6 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-black/50 hover:bg-red-600 backdrop-blur-md border border-white/20 active:scale-90 transition"
                  title="Delete"
                >
                  <Trash2 className="w-5 h-5 text-white" />
                </button>
              )}

              <div className="absolute bottom-6 left-0 right-0 flex justify-center z-10 pointer-events-none">
                <div className="bg-black/50 backdrop-blur-md px-3 py-1 rounded-full border border-white/10">
                  <p className="text-xs font-bold text-white/80">
                    {activeIndex + 1} / {mediaList.length}
                  </p>
                </div>
              </div>

              <div
                ref={previewScrollRef}
                onScroll={handlePreviewScroll}
                className="w-full h-full flex overflow-x-auto snap-x snap-mandatory [&::-webkit-scrollbar]:hidden"
                style={{ scrollbarWidth: "none" }}
              >
                {mediaList.map((item, index) => (
                  <div
                    key={item.key || index}
                    className="w-full h-full flex-none snap-center flex items-center justify-center p-4 sm:p-10"
                  >
                    {item.type === "video" ? (
                      <video
                        ref={(el) => {
                          previewVideoRefs.current[index] = el;
                          if (el) el.muted = true;
                        }}
                        src={item.url}
                        className="max-w-full max-h-full"
                        controls
                        loop
                        playsInline
                        preload="metadata"
                      />
                    ) : (
                      <img
                        src={item.url}
                        alt={`Preview ${index + 1}`}
                        className="max-w-full max-h-full object-contain"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
