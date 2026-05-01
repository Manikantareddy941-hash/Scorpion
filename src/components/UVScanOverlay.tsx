import { useEffect, useRef } from "react";
import scanVideo from "../assets/scan-animation.mp4";

interface UVScanOverlayProps {
  isScanning: boolean;
  progress?: number;
}

export default function UVScanOverlay({ isScanning, progress = 0 }: UVScanOverlayProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isScanning) { 
        video.currentTime = 0; 
        video.play().catch(() => {}); 
    }
    else { 
        video.pause(); 
        video.currentTime = 0; 
    }
  }, [isScanning]);

  if (!isScanning) return null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, backgroundColor: "rgba(0,0,0,0.85)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <video ref={videoRef} src={scanVideo} loop muted playsInline style={{ width: "100vw", height: "100vh", objectFit: "cover", position: "absolute", inset: 0 }} />
      <div style={{ position: "relative", zIndex: 1, width: "480px", padding: "32px", background: "rgba(0,0,0,0.6)", borderRadius: "16px", backdropFilter: "blur(8px)", color: "white", textAlign: "center" }}>
        <div style={{ fontSize: "14px", letterSpacing: "2px", color: "#00e5ff", marginBottom: "12px" }}>SCANNING REPOSITORY</div>
        <div style={{ fontSize: "48px", fontWeight: "bold", color: "#00e5ff", marginBottom: "8px" }}>{progress}%</div>
        <div style={{ background: "rgba(255,255,255,0.15)", borderRadius: "8px", height: "8px", width: "100%", marginBottom: "12px" }}>
          <div style={{ background: "#00e5ff", height: "8px", borderRadius: "8px", width: `${progress}%`, transition: "width 0.5s ease" }} />
        </div>
        <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)" }}>Analyzing vulnerabilities, secrets & code quality...</div>
      </div>
    </div>
  );
}