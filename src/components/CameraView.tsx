"use client";

import { useEffect, useRef, useState } from "react";
import { Settings, RefreshCw, X, Image as ImageIcon } from "lucide-react";
import { Drawer } from "vaul";

const initialMockPhotos = ["hi"];

export default function CameraView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [photos, setPhotos] = useState<string[]>(initialMockPhotos);
  const [isFlashing, setIsFlashing] = useState(false);

  // Initialize and update camera stream
  useEffect(() => {
    let currentStream: MediaStream | null = null;

    async function startCamera() {
      try {
        if (stream) {
          stream.getTracks().forEach((track) => track.stop());
        }

        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: facingMode,
          },
          audio: false,
        });

        currentStream = mediaStream;
        setStream(mediaStream);

        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      } catch (err) {
        console.error("Error accessing camera:", err);
        setError("Could not access camera. Please grant permissions.");
      }
    }

    startCamera();

    return () => {
      if (currentStream) {
        currentStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [facingMode]);

  // Capture Photo logic (unlimited)
  const takePhoto = () => {
    if (!videoRef.current) return;

    // Trigger flash animation
    setIsFlashing(true);
    setTimeout(() => setIsFlashing(false), 150);

    const video = videoRef.current;
    const canvas = canvasRef.current || document.createElement("canvas");
    canvas.width = video.videoWidth || 720;
    canvas.height = video.videoHeight || 1280;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      // Mirror image horizontally if using front camera
      if (facingMode === "user") {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const photoDataUrl = canvas.toDataURL("image/jpeg", 0.85);
      setPhotos((prev) => [photoDataUrl, ...prev]);
    }
  };

  const toggleCamera = () => {
    setFacingMode((prev) => (prev === "user" ? "environment" : "user"));
  };

  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen bg-black text-white select-none">
      <canvas ref={canvasRef} className="hidden" />

      {error ? (
        <div className="text-center text-red-500 max-w-sm font-medium z-20">
          {error}
        </div>
      ) : (
        <div className="relative w-full max-w-md aspect-[9/16] bg-neutral-900 rounded-3xl overflow-hidden shadow-2xl border border-neutral-800 z-0">
          {/* Flash Effect Overlay */}
          {isFlashing && (
            <div className="absolute inset-0 bg-white z-30 transition-opacity duration-150" />
          )}

          {/* Video Stream */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover ${
              facingMode === "user" ? "-scale-x-100" : ""
            }`}
          />

          {/* Top Bar Header */}
          <div className="absolute top-0 left-0 right-0 h-16 p-6 flex justify-between items-center z-10 pointer-events-none bg-gradient-to-b from-black/60 to-transparent">
            <button className="pointer-events-auto p-1 rounded-full hover:bg-white/10 transition">
              <X className="w-6 h-6 text-white" />
            </button>
            <div className="text-center">
              <p className="text-sm font-bold text-white tracking-wide">
                Chloe & Tyler
              </p>
              <p className="text-[10px] font-medium text-white/80 uppercase tracking-wider">
                Ends at 11:59 PM
              </p>
            </div>
            <button className="pointer-events-auto p-1 rounded-full hover:bg-white/10 transition">
              <Settings className="w-6 h-6 text-white" />
            </button>
          </div>

          {/* Side Control Palette */}
          <div className="absolute top-24 right-4 flex flex-col gap-3 z-10">
            <button
              onClick={toggleCamera}
              className="w-10 h-10 flex items-center justify-center rounded-full border border-neutral-700/60 bg-neutral-950/60 backdrop-blur-md pointer-events-auto active:scale-90 transition"
              title="Flip Camera"
            >
              <RefreshCw className="w-4 h-4 text-white/90" />
            </button>
          </div>

          {/* Bottom Action Area */}
          <div className="absolute bottom-0 left-0 right-0 p-6 pb-8 flex justify-between items-center z-10 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
            {/* Live Shot Count Display */}
            <div className="text-left w-24">
              <p className="text-white text-lg font-black leading-none">
                {photos.length}
              </p>
              <p className="text-white/70 text-[10px] font-bold tracking-wider uppercase">
                Photos Taken
              </p>
            </div>

            {/* Main Shutter Button */}
            <button
              onClick={takePhoto}
              className="w-20 h-20 rounded-full flex items-center justify-center border-[5px] border-white active:scale-90 transition-transform shadow-2xl pointer-events-auto cursor-pointer"
            >
              <div className="w-14 h-14 bg-white rounded-full" />
            </button>

            {/* Gallery Drawer Trigger */}
            <button
              onClick={() => setIsGalleryOpen(true)}
              className="w-24 flex justify-end pointer-events-auto"
            >
              <div className="w-12 h-12 rounded-xl border border-white/20 overflow-hidden bg-neutral-800 flex items-center justify-center shadow-md">
                {photos.length > 0 ? (
                  <img
                    src={photos[0]}
                    alt="Latest Snap"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <ImageIcon className="w-6 h-6 text-neutral-400" />
                )}
              </div>
            </button>

            {/* Vaul Drawer Content */}
            <Drawer.Root open={isGalleryOpen} onOpenChange={setIsGalleryOpen}>
              <Drawer.Portal>
                <Drawer.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40" />
                <Drawer.Content className="fixed inset-x-0 bottom-0 top-16 bg-neutral-950 rounded-t-[32px] p-6 shadow-2xl z-50 flex flex-col border-t border-neutral-800">
                  <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-neutral-700 mb-6" />

                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-bold text-white">
                        Event Gallery
                      </h2>
                      <p className="text-xs text-neutral-400">
                        {photos.length} photos collected
                      </p>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto">
                    <div className="grid grid-cols-3 gap-2.5 pb-8">
                      {photos.map((photo, index) => (
                        <div
                          key={index}
                          className="aspect-square bg-neutral-900 rounded-xl overflow-hidden border border-neutral-800 shadow-sm"
                        >
                          <img
                            src={photo}
                            alt={`Captured photo ${index + 1}`}
                            className="w-full h-full object-cover"
                          />
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
