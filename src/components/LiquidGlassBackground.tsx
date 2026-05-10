import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { liquidGlassBackgrounds } from '../assets/liquidGlassBackgrounds';

// Simple djb2 hash function
const hashCode = (str: string) => {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
};

const LiquidGlassBackground: React.FC = () => {
  const { pathname } = useLocation();
  
  // Use useMemo to avoid re-calculating on every render, but keep it deterministic per route
  const currentImage = useMemo(() => {
    const index = hashCode(pathname) % liquidGlassBackgrounds.length;
    return liquidGlassBackgrounds[index];
  }, [pathname]);

  const [displayImage, setDisplayImage] = useState(currentImage);
  const [prevImage, setPrevImage] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(1);

  useEffect(() => {
    if (currentImage !== displayImage) {
      setPrevImage(displayImage);
      setDisplayImage(currentImage);
      setOpacity(0);
      
      // Trigger fade in
      const fadeTimer = setTimeout(() => {
        setOpacity(1);
      }, 50);

      // Cleanup previous image after transition
      const cleanupTimer = setTimeout(() => {
        setPrevImage(null);
      }, 1550);
      
      return () => {
        clearTimeout(fadeTimer);
        clearTimeout(cleanupTimer);
      };
    }
  }, [currentImage, displayImage]);

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, overflow: 'hidden', background: '#000', pointerEvents: 'none' }}>
      {prevImage && (
        <img 
          src={prevImage} 
          style={{ 
            position: 'absolute', 
            inset: 0, 
            width: '100%', 
            height: '100%', 
            objectFit: 'cover',
            opacity: 1,
            imageRendering: 'high-quality'
          }} 
          alt="" 
        />
      )}
      <img 
        src={displayImage} 
        style={{ 
          position: 'absolute', 
          inset: 0, 
          width: '100%', 
          height: '100%', 
          objectFit: 'cover',
          opacity: opacity,
          transition: 'opacity 1.5s ease-in-out',
          imageRendering: 'high-quality'
        }} 
        alt="" 
      />
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.40)', zIndex: 3 }} />
    </div>,
    document.body
  );
};

export default LiquidGlassBackground;
