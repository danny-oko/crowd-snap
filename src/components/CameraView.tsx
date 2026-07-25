"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { RefreshCw, Image as ImageIcon, Video, Download } from "lucide-react";
import { Drawer } from "vaul";
import { uploadToR2Action } from "@/app/actions/upload";

const ZOOM_PRESETS = [0.5, 1, 1.5, 2, 5];

type MediaItem = {
  url: string;
  type: "image" | "video";
  key?: string;
  blob?: Blob;
};

export default function CameraView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<NodeJS.Timeout | null>(null);
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pressStartTimeRef = useRef<number>(0);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");

  const [mediaList, setMediaList] = useState<MediaItem[]>([]);

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

  const fetchBucketItems = useCallback(async () => {
    try {
      const res = await fetch("/api/media");
      if (res.ok) {
        const data = await res.json();
        if (data.items) {
          setMediaList(data.items);
        }
      }
    } catch (err) {
      console.error("Failed to sync bucket media:", err);
    }
  }, []);

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
            setZoomCap({
              min: capabilities.zoom.min || 1,
              max: capabilities.zoom.max || 5,
              step: capabilities.zoom.step || 0.1,
            });
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

  const triggerDownload = (url: string, filename: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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

      const res = await uploadToR2Action(formData);
      if (!res.success) {
        throw new Error(res.error);
      }
      fetchBucketItems();
      return res.publicUrl;
    } catch (err) {
      console.error("R2 Upload error:", err);
      return null;
    }
  };

  const takePhoto = async () => {
    if (!videoRef.current) return;

    setIsFlashing(true);
    setTimeout(() => setIsFlashing(false), 150);

    const video = videoRef.current;
    const canvas = canvasRef.current || document.createElement("canvas");
    canvas.width = video.videoWidth || 1080;
    canvas.height = video.videoHeight || 1920;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

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
        const finalMime = mimeType || "video/mp4";
        const ext = finalMime.includes("mp4") ? "mp4" : "webm";
        const videoBlob = new Blob(videoChunksRef.current, { type: finalMime });
        const fileName = `video-${Date.now()}.${ext}`;

        await uploadToR2(videoBlob, fileName, finalMime);

        setIsRecording(false);
        setRecordingSeconds(0);
        if (recordTimerRef.current) clearInterval(recordTimerRef.current);
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
    applyHardwareZoom(targetZoom);
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
        applyHardwareZoom(zoom * factor);
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

  const isSoftwareZoom = !(
    stream?.getVideoTracks()[0]?.getCapabilities?.() as any
  )?.zoom;

  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen bg-black text-white select-none touch-none">
      <canvas ref={canvasRef} className="hidden" />

      {error ? (
        <div className="text-center text-red-500 max-w-sm font-medium z-20">
          {error}
        </div>
      ) : (
        <div
          className="relative w-full max-w-md aspect-[9/16] bg-neutral-900 rounded-3xl overflow-hidden shadow-2xl border border-neutral-800 z-0"
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {isFlashing && (
            <div className="absolute inset-0 bg-white z-30 transition-opacity duration-150" />
          )}

          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover transition-transform duration-75"
            style={{
              transform: `scale(${isSoftwareZoom ? zoom : 1})`,
            }}
          />

          {isRecording && (
            <div className="absolute top-6 left-0 right-0 flex justify-center z-20">
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

          <div className="absolute bottom-0 left-0 right-0 p-6 pb-8 flex flex-col items-center gap-4 z-10 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
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

            <div className="w-full flex justify-between items-center">
              <button
                onClick={() => setIsGalleryOpen(true)}
                className="flex items-center gap-3 pointer-events-auto group"
              >
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
                <div className="text-left">
                  <p className="text-white text-base font-black leading-none">
                    {mediaList.length}
                  </p>
                  <p className="text-white/60 text-[9px] font-bold tracking-wider uppercase">
                    Items
                  </p>
                </div>
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
                onClick={toggleCamera}
                className="w-12 h-12 flex items-center justify-center rounded-full border border-white/20 bg-black/40 backdrop-blur-md pointer-events-auto active:scale-90 transition shadow-md"
                title="Flip Camera"
              >
                <RefreshCw className="w-5 h-5 text-white" />
              </button>
            </div>

            <Drawer.Root open={isGalleryOpen} onOpenChange={setIsGalleryOpen}>
              <Drawer.Portal>
                <Drawer.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40" />
                <Drawer.Content className="fixed inset-x-0 bottom-0 top-16 bg-neutral-950 rounded-t-[32px] p-6 shadow-2xl z-50 flex flex-col border-t border-neutral-800">
                  <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-neutral-700 mb-6" />

                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-bold text-white">
                        Cloud Gallery
                      </h2>
                      <p className="text-xs text-neutral-400">
                        {mediaList.length} items synced
                      </p>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto">
                    <div className="grid grid-cols-2 gap-3 pb-8">
                      {mediaList.map((item, index) => (
                        <div
                          key={item.key || index}
                          className="group aspect-square bg-neutral-900 rounded-xl overflow-hidden border border-neutral-800 shadow-sm relative"
                        >
                          {item.type === "video" ? (
                            <video
                              src={item.url}
                              className="w-full h-full object-cover"
                              controls
                              playsInline
                              preload="metadata"
                            />
                          ) : (
                            <img
                              src={item.url}
                              alt={`Captured media ${index + 1}`}
                              className="w-full h-full object-cover"
                            />
                          )}

                          <button
                            onClick={() => {
                              const ext =
                                item.type === "video" ? "mp4" : "webp";
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
                        </div>
                      ))}
                    </div>
                  </div>
                </Drawer.Content>
              </Drawer.Portal>
            </Drawer.Root>
          </div>
        </div>
      )}
    </div>
  );
}
