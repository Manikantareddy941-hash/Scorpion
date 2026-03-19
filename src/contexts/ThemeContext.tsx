import React, { createContext, useContext, useState, useEffect } from 'react';

export type Theme = 'light' | 'dark' | 'eye-protection' | 'snow-light' | 'snow-dark' | 'underwater';

interface ThemeContextType {
    theme: Theme;
    setTheme: (theme: Theme) => void;
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
        return (['light', 'dark', 'eye-protection', 'snow-light', 'snow-dark', 'underwater'].includes(saved)) ? saved : 'dark';
    });

    const setTheme = (newTheme: Theme) => {
        const root = document.documentElement;
        
        // Remove all theme classes
        root.classList.remove('dark', 'eye-protection', 'snow-light', 'snow-dark', 'underwater');
        
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

    return (
        <ThemeContext.Provider value={{ 
            theme, 
            setTheme, 
            getLogoFilter: () => getLogoFilter(theme),
            getLogoBlendMode: () => getLogoBlendMode(theme)
        }}>
            {children}
            { (theme === 'snow-light' || theme === 'snow-dark') && <Snowfall /> }
            { (theme === 'dark' || theme === 'snow-dark' || theme === 'snow-light') && <BackgroundParticles /> }
            { theme === 'underwater' && <UnderwaterBubbles /> }
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

export const useTheme = () => {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
};
