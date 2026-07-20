"use client";

import { useEffect, useRef, useState } from "react";
import { Settings, ScanFace, X } from "lucide-react";
import { Drawer } from "vaul";

const mockPhotos = [
  "https://images.unsplash.com/photo-1511795409834-ef04bbd61622?q=80&w=300&h=300&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1519167758481-83f550bb49b3?q=80&w=300&h=300&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1520854221256-17451cc331bf?q=80&w=300&h=300&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?q=80&w=300&h=300&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?q=80&w=300&h=300&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?q=80&w=300&h=300&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?q=80&w=300&h=300&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?q=80&w=300&h=300&auto=format&fit=crop",
];

export default function CameraView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shotsRemaining, setShotsRemaining] = useState(25);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);

  useEffect(() => {
    async function startCamera() {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
            facingMode: "user",
          },
          audio: true,
        });

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
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen bg-black text-white">
      {error ? (
        <div className="text-center text-red-500 max-w-sm font-medium z-20">
          {error}
        </div>
      ) : (
        <>
          <div className="relative w-full max-w-md aspect-[9/16] bg-neutral-900 rounded-3xl overflow-hidden shadow-2xl border border-neutral-800 z-0">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover -scale-x-100"
            />

            <div className="absolute top-0 left-0 right-0 h-16 p-6 flex justify-between items-center z-10 pointer-events-none">
              <button className="pointer-events-auto">
                <X className="w-6 h-6 text-white" />
              </button>
              <div className="text-center">
                <p className="text-sm font-bold text-white">Chloe & Tyler</p>
                <p className="text-xs font-normal text-white/80">
                  Ends at 11:59 PM
                </p>
              </div>
              <button className="pointer-events-auto">
                <Settings className="w-6 h-6 text-white" />
              </button>
            </div>

            <div className="absolute top-28 right-4 flex flex-col gap-4 z-10 p-2">
              {[1, 2, 3].map((id) => (
                <button
                  key={id}
                  className="w-8 h-8 flex items-center justify-center rounded-md border border-neutral-700 bg-neutral-950/60 backdrop-blur-sm pointer-events-auto"
                >
                  <ScanFace className="w-5 h-5 text-white/90" />
                </button>
              ))}
            </div>

            <div className="absolute bottom-0 left-0 right-0 p-8 flex justify-center items-end gap-16 z-10">
              <div className="text-left w-24">
                <p className="text-neutral-500 text-xs font-bold leading-none">
                  24
                </p>
                <p className="text-white text-base font-bold leading-none">
                  {shotsRemaining}{" "}
                  <span className="text-xs uppercase font-semibold text-neutral-400">
                    Shots
                  </span>
                </p>
                <p className="text-white/80 text-xs font-medium">REMAINING</p>
                <p className="text-neutral-500 text-xs font-bold leading-none">
                  26
                </p>
              </div>

              <button className="w-20 h-20 bg-neutral-900 rounded-full flex items-center justify-center border-[6px] border-white active:scale-95 transition-all shadow-xl pointer-events-auto">
                <div className="w-14 h-14 bg-white rounded-full" />
              </button>

              <button
                onClick={() => setIsGalleryOpen(true)}
                className="w-20 h-16 pointer-events-auto flex items-center justify-center"
              >
                <img
                  src="https://cdn-icons-png.flaticon.com/512/3342/3342137.png"
                  alt="Open Gallery"
                  className="w-12 h-12 object-contain opacity-90 brightness-0 invert"
                />
              </button>

              <Drawer.Root open={isGalleryOpen} onOpenChange={setIsGalleryOpen}>
                <Drawer.Portal>
                  <Drawer.Overlay className="fixed inset-0 bg-black/60 z-40" />
                  <Drawer.Content className="fixed inset-x-0 bottom-0 top-16 bg-neutral-950 rounded-t-3xl p-6 shadow-2xl z-50 flex flex-col border border-neutral-800">
                    <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-neutral-700 mb-6" />

                    <div className="mb-4">
                      <h2 className="text-2xl font-bold text-white">
                        Event Gallery
                      </h2>
                    </div>

                    <div className="flex-1 overflow-y-auto">
                      <div className="grid grid-cols-3 gap-3">
                        {mockPhotos.map((photo, index) => (
                          <div
                            key={index}
                            className="aspect-square bg-neutral-800 rounded-xl overflow-hidden border border-neutral-700"
                          >
                            <img
                              src={photo}
                              alt={`Photo ${index + 1}`}
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
        </>
      )}
    </div>
  );
}
