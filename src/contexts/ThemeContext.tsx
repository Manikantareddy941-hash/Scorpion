import React, { createContext, useContext, useState, useEffect } from 'react';

export type Theme = 'light' | 'dark' | 'eye-protection' | 'snow-light' | 'snow-dark' | 'underwater' | 'matrix';

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
        case 'light':
        case 'eye-protection':
        case 'snow-light':
            return 'multiply';
        default:
            return 'screen';
    }
};

export const getLogoFilter = (theme: Theme): string => {
    switch (theme) {
        case 'light':
        case 'snow-light':
            return 'brightness(0)'; // Dark gray/black
        case 'dark':
        case 'snow-dark':
        case 'underwater':
        case 'matrix':
            return 'brightness(0) invert(1)'; // White
        case 'eye-protection':
            return 'brightness(0) sepia(1) saturate(5) hue-rotate(-20deg) brightness(0.6)'; // Warm brown/amber
        default:
            return '';
    }
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [theme, setThemeState] = useState<Theme>(() => {
      const saved = localStorage.getItem('theme') as Theme;
      if (['light', 'dark', 'eye-protection', 'snow-light', 'snow-dark', 'underwater', 'matrix'].includes(saved)) {
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

    const setTheme = (newTheme: Theme) => {
        const root = document.documentElement;
        
        // Remove all theme classes
        root.classList.remove('dark', 'eye-protection', 'snow-light', 'snow-dark', 'underwater', 'matrix');
        
        // Add new theme class (except for light which is default)
        if (newTheme !== 'light') {
            root.classList.add(newTheme);
        }
        
        localStorage.setItem('theme', newTheme);
        setThemeState(newTheme);
    };

    // Initial load
    useEffect(() => {
        setTheme(theme);
    }, []);

    // Listen for OS theme changes
    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = (e: MediaQueryListEvent) => {
            // Only auto-switch if user hasn't manually set a theme (no saved theme)
            const saved = localStorage.getItem('theme');
            if (!saved) {
                setTheme(e.matches ? 'dark' : 'light');
            }
        };
        mediaQuery.addEventListener('change', handler);
        return () => mediaQuery.removeEventListener('change', handler);
    }, []);

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
            { (theme === 'snow-light' || theme === 'snow-dark') && <Snowfall /> }
            { (theme === 'dark' || theme === 'snow-light' || theme === 'snow-dark') && <BackgroundParticles /> }
            { theme === 'underwater' && <UnderwaterBubbles /> }
            { theme === 'matrix' && <MatrixGlobe /> }
        </ThemeContext.Provider>
    );
};

const UnderwaterBubbles = () => {
  return (
    <div className="bg-particles">
      {[...Array(20)].map((_, i) => (
        <div 
          key={i} 
          className="underwater-bubble"
          style={{
            left: `${Math.random() * 100}%`,
            width: `${Math.random() * 15 + 5}px`,
            height: `${Math.random() * 15 + 5}px`,
            animationDuration: `${Math.random() * 4 + 4}s`,
            animationDelay: `${Math.random() * 8}s`,
          }}
        />
      ))}
    </div>
  );
};

const BackgroundParticles = () => {
  return (
    <div className="bg-particles">
      {[...Array(10)].map((_, i) => (
        <div 
          key={i} 
          className="particle"
          style={{
            left: `${Math.random() * 100}%`,
            width: `${Math.random() * 2 + 2}px`,
            height: `${Math.random() * 2 + 2}px`,
            animationDuration: `${Math.random() * 10 + 10}s`,
            animationDelay: `${Math.random() * 15}s`,
            opacity: Math.random() * 0.15 + 0.15
          }}
        />
      ))}
    </div>
  );
};

const Snowfall = () => {
  return (
    <div className="snow-container">
      {[...Array(50)].map((_, i) => (
        <div 
          key={i} 
          className="snowflake"
          style={{
            left: `${Math.random() * 100}%`,
            width: `${Math.random() * 6 + 2}px`,
            height: `${Math.random() * 6 + 2}px`,
            animationDuration: `${Math.random() * 3 + 2}s`,
            animationDelay: `${Math.random() * 5}s`,
            opacity: Math.random()
          }}
        />
      ))}
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

export const useTheme = () => {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
};
