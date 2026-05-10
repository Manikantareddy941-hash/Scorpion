import React, { createContext, useContext, useState, useEffect } from 'react';
import bg3 from '../assets/liquid-glass-backgrounds/3.jpg';
import bg4 from '../assets/liquid-glass-backgrounds/4.jpg';
import bg5 from '../assets/liquid-glass-backgrounds/5.jpg';
import bg6 from '../assets/liquid-glass-backgrounds/6.jpg';
import bg7 from '../assets/liquid-glass-backgrounds/7.jpg';
import bg8 from '../assets/liquid-glass-backgrounds/8.jpg';
import bg9 from '../assets/liquid-glass-backgrounds/9.jpg';
import bg10 from '../assets/liquid-glass-backgrounds/10.jpg';
import bg11 from '../assets/liquid-glass-backgrounds/11.jpg';
import bg12 from '../assets/liquid-glass-backgrounds/12.jpg';
import bg13 from '../assets/liquid-glass-backgrounds/13.jpg';

const liquidGlassBgs = [bg3, bg4, bg5, bg6, bg7, bg8, bg9, bg10, bg11, bg12, bg13];

export type Theme = 'light' | 'dark' | 'eye-protection' | 'underwater' | 'matrix' | 'liquid-glass';

interface ThemeContextType {
    theme: Theme;
    setTheme: (theme: Theme) => void;
    echoMovementEnabled: boolean;
    setEchoMovementEnabled: (enabled: boolean) => void;
    getLogoFilter: () => string;
    getLogoBlendMode: () => 'screen' | 'multiply';
}

export const getLogoBlendMode = (theme: Theme): 'screen' | 'multiply' => {
    switch (theme) {
        case 'eye-protection':
            return 'multiply';
        default:
            return 'screen';
    }
};

export const getLogoFilter = (theme: Theme): string => {
    switch (theme) {
        case 'light':
        case 'dark':
        case 'underwater':
        case 'matrix':
        case 'liquid-glass':
            return 'brightness(0) invert(1)'; // White for dark backgrounds
        case 'eye-protection':
            return 'brightness(0) sepia(1) saturate(5) hue-rotate(-20deg) brightness(0.6)'; // Warm brown/amber
        default:
            return '';
    }
};

const ThemeContext = createContext<ThemeContextType>({
    theme: 'dark',
    setTheme: () => {},
    echoMovementEnabled: true,
    setEchoMovementEnabled: () => {},
    getLogoFilter: () => 'brightness(0) invert(1)',
    getLogoBlendMode: () => 'screen'
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [theme, setThemeState] = useState<Theme>(() => {
      const saved = localStorage.getItem('theme') as Theme;
      if (['light', 'dark', 'eye-protection', 'underwater', 'matrix', 'liquid-glass'].includes(saved)) {
        return saved;
      }
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      return systemDark ? 'dark' : 'light';
    });

    const [echoMovementEnabled, setEchoMovementEnabledState] = useState<boolean>(() => {
        const saved = localStorage.getItem('echoMovementEnabled');
        return saved === null ? true : saved === 'true';
    });

    const setEchoMovementEnabled = (enabled: boolean) => {
        localStorage.setItem('echoMovementEnabled', String(enabled));
        setEchoMovementEnabledState(enabled);
    };

    const setTheme = (theme: Theme) => {
        setThemeState(theme);
        localStorage.setItem('theme', theme);
        
        // Remove all theme classes from html
        const themes: Theme[] = ['light', 'dark', 'eye-protection', 'underwater', 'matrix', 'liquid-glass'];
        document.documentElement.classList.remove(...themes);
        
        // Add current theme class
        document.documentElement.classList.add(theme);
        
        // Set data-theme attribute for CSS selectors
        document.documentElement.setAttribute('data-theme', theme);
    };

    // Initialize theme on mount
    useEffect(() => {
        setTheme(theme);
    }, []);

    // Clean up body styles if theme changes
    useEffect(() => {
        if (theme !== 'liquid-glass') {
            document.body.style.backgroundImage = '';
            document.body.style.backgroundSize = '';
            document.body.style.backgroundPosition = '';
            document.body.style.backgroundAttachment = '';
            document.body.style.backgroundRepeat = '';
        }
    }, [theme]);

    return (
        <ThemeContext.Provider value={{ 
            theme, 
            setTheme, 
            echoMovementEnabled,
            setEchoMovementEnabled,
            getLogoFilter: () => getLogoFilter(theme),
            getLogoBlendMode: () => getLogoBlendMode(theme)
        }}>
            {children}
            { theme === 'dark' && <BackgroundParticles /> }
            { theme === 'underwater' && <UnderwaterBubbles /> }
            { theme === 'matrix' && <MatrixGlobe /> }
            { theme === 'liquid-glass' && <LiquidGlassSlideshow /> }
        </ThemeContext.Provider>
    );
};

const UnderwaterBubbles = () => {
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
      {[...Array(20)].map((_, i) => (
        <div 
          key={i} 
          style={{
            position: 'absolute',
            background: 'rgba(255, 255, 255, 0.2)',
            borderRadius: '50%',
            left: `${Math.random() * 100}%`,
            width: `${Math.random() * 15 + 5}px`,
            height: `${Math.random() * 15 + 5}px`,
            bottom: '-20px',
            animation: `underwater-bubble-up ${Math.random() * 4 + 4}s linear infinite`,
            animationDelay: `${Math.random() * 8}s`,
          }}
        />
      ))}
      <style>{`
        @keyframes underwater-bubble-up {
          0% { transform: translateY(0) scale(1); opacity: 0; }
          10% { opacity: 0.3; }
          90% { opacity: 0.3; }
          100% { transform: translateY(-100vh) scale(1.5); opacity: 0; }
        }
      `}</style>
    </div>
  );
};

const BackgroundParticles = () => {
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
      {[...Array(10)].map((_, i) => (
        <div 
          key={i} 
          style={{
            position: 'absolute',
            background: 'var(--accent-primary)',
            borderRadius: '50%',
            left: `${Math.random() * 100}%`,
            width: `${Math.random() * 2 + 2}px`,
            height: `${Math.random() * 2 + 2}px`,
            top: `${Math.random() * 100}%`,
            animation: `float-particle ${Math.random() * 10 + 10}s linear infinite`,
            animationDelay: `${Math.random() * 15}s`,
            opacity: Math.random() * 0.15 + 0.15
          }}
        />
      ))}
      <style>{`
        @keyframes float-particle {
          0% { transform: translate(0, 0); }
          50% { transform: translate(${Math.random() * 20 - 10}px, ${Math.random() * 20 - 10}px); }
          100% { transform: translate(0, 0); }
        }
      `}</style>
    </div>
  );
};

const MatrixGlobe = () => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width = 700;
    const H = canvas.height = 700;
    const cx = W / 2;
    const cy = H / 2;
    const radius = 280;

    // Polar-biased distribution — more dots near poles, sparse at equator
    const particles = Array.from({ length: 3000 }, () => {
      // Bias theta toward 0 and PI (poles) using power curve
      const u = Math.random();
      // This creates polar clustering — squeezes dots toward top/bottom
      const theta = Math.acos(1 - 2 * Math.pow(Math.random(), 0.35)) * (Math.random() < 0.5 ? 1 : -1) + Math.PI / 2;
      const phi = Math.random() * 2 * Math.PI;
      const baseSize = 0.3 + Math.random() * 2.0;
      const phase = Math.random() * Math.PI * 2;

      return { theta, phi, baseSize, phase };
    });

    let angle = 0;
    let animId: number;

    const draw = () => {
      ctx.clearRect(0, 0, W, H);

      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      const projected = particles.map((p) => {
        const x = radius * Math.sin(p.theta) * Math.cos(p.phi);
        const y = radius * Math.cos(p.theta);
        const z = radius * Math.sin(p.theta) * Math.sin(p.phi);

        // Rotate around Y
        const x1 = x * cosA + z * sinA;
        const z1 = -x * sinA + z * cosA;

        return { sx: cx + x1, sy: cy + y, z: z1, baseSize: p.baseSize };
      });

      projected.sort((a, b) => a.z - b.z);

      projected.forEach(({ sx, sy, z, baseSize }) => {
        const depth = (z + radius) / (2 * radius);
        const size = baseSize * (0.2 + depth * 0.85);
        const alpha = 0.08 + depth * 0.92;

        // Green palette — dark green at back, bright green at front
        const g = Math.floor(140 + depth * 115);
        const r = Math.floor(depth * 15);
        const b = Math.floor(depth * 25);

        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(0.2, size), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.fill();
      });

      angle += 0.0018; // slow rotation
      animId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <>
      <div style={{
        position: 'fixed', inset: 0,
        background: '#000000',
        zIndex: 0, pointerEvents: 'none',
      }} />

      <div style={{
        position: 'fixed',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '75vmin', height: '75vmin',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(0,255,65,0.05) 0%, transparent 65%)',
        pointerEvents: 'none', zIndex: 1,
      }} />

      <canvas
        ref={canvasRef}
        style={{
          position: 'fixed',
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '72vmin', height: '72vmin',
          pointerEvents: 'none',
          zIndex: 1,
          opacity: 0.95,
        }}
      />
    </>
  );
};

const LiquidGlassSlideshow = () => {
  const [currentBgIndex, setCurrentBgIndex] = useState(0);

  // Preload all images
  useEffect(() => {
    console.log('LiquidGlass Backgrounds:', liquidGlassBgs);
    liquidGlassBgs.forEach(src => {
      const img = new Image();
      img.src = src;
    });
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentBgIndex(prev => (prev + 1) % liquidGlassBgs.length);
    }, 120000); // 2 minutes
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <img
        src={liquidGlassBgs[currentBgIndex]}
        style={{
          position: 'fixed',
          inset: 0,
          width: '100vw',
          height: '100vh',
          objectFit: 'cover',
          objectPosition: 'center',
          zIndex: -2,
          transition: 'opacity 2s ease-in-out',
          imageRendering: 'high-quality',
        } as React.CSSProperties}
        alt=""
      />
      <div style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.15)',
        zIndex: -1,
        pointerEvents: 'none'
      }} />
    </>
  );
};

export const useTheme = () => {
    const context = useContext(ThemeContext);
    // If context is still the default (which might happen during early HMR cycles),
    // we return it instead of throwing, to prevent the app from crashing.
    return context;
};
