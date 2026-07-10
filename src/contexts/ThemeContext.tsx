import React, { createContext, useContext, useState, useEffect } from 'react';

export type Theme = 'aegis' | 'terra';

interface ThemeContextType {
    theme: Theme;
    setTheme: (theme: Theme) => void;
    echoMovementEnabled: boolean;
    setEchoMovementEnabled: (enabled: boolean) => void;
    echoFreeRoam: boolean;
    setEchoFreeRoam: (enabled: boolean) => void;
    getLogoFilter: () => string;
    getLogoBlendMode: () => 'screen' | 'multiply';
}

export const getLogoBlendMode = (_theme: Theme): 'screen' | 'multiply' => 'screen';

export const getLogoFilter = (theme: Theme): string => {
    switch (theme) {
        case 'terra':
            return 'brightness(0) saturate(100%) invert(34%) sepia(13%) saturate(1200%) hue-rotate(70deg) brightness(95%)'; // Forest green
        case 'aegis':
            return 'brightness(0) saturate(100%) invert(8%) sepia(54%) saturate(2476%) hue-rotate(213deg) brightness(94%) contrast(96%)'; // Deep navy
        default:
            return '';
    }
};

const ThemeContext = createContext<ThemeContextType>({
    theme: 'aegis',
    setTheme: () => {},
    echoMovementEnabled: true,
    setEchoMovementEnabled: () => {},
    echoFreeRoam: true,
    setEchoFreeRoam: () => {},
    getLogoFilter: () => getLogoFilter('aegis'),
    getLogoBlendMode: () => 'screen'
});

const VALID_THEMES: Theme[] = ['aegis', 'terra'];

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [theme, setThemeState] = useState<Theme>(() => {
      const saved = localStorage.getItem('theme') as Theme;
      if (VALID_THEMES.includes(saved)) {
        return saved;
      }
      return 'aegis';
    });

    const [echoMovementEnabled, setEchoMovementEnabledState] = useState<boolean>(() => {
        const saved = localStorage.getItem('echoMovementEnabled');
        return saved === null ? true : saved === 'true';
    });

    const setEchoMovementEnabled = (enabled: boolean) => {
        localStorage.setItem('echoMovementEnabled', String(enabled));
        setEchoMovementEnabledState(enabled);
    };

    const [echoFreeRoam, setEchoFreeRoamState] = useState<boolean>(() => {
        const saved = localStorage.getItem('echoFreeRoam');
        // Off by default: a mascot wandering across live security data reads
        // as noise in an enterprise console. Users can re-enable in Settings.
        return saved === null ? false : saved === 'true';
    });

    const setEchoFreeRoam = (enabled: boolean) => {
        localStorage.setItem('echoFreeRoam', String(enabled));
        setEchoFreeRoamState(enabled);
    };

    const setTheme = (theme: Theme) => {
        setThemeState(theme);
        localStorage.setItem('theme', theme);

        // Remove all theme classes from html
        document.documentElement.classList.remove(...VALID_THEMES);

        // Add current theme class
        document.documentElement.classList.add(theme);

        // Set data-theme attribute for CSS selectors
        document.documentElement.setAttribute('data-theme', theme);
    };

    // Initialize theme on mount
    useEffect(() => {
        setTheme(theme);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <ThemeContext.Provider value={{
            theme,
            setTheme,
            echoMovementEnabled,
            setEchoMovementEnabled,
            echoFreeRoam,
            setEchoFreeRoam,
            getLogoFilter: () => getLogoFilter(theme),
            getLogoBlendMode: () => getLogoBlendMode(theme)
        }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => {
    const context = useContext(ThemeContext);
    // If context is still the default (which might happen during early HMR cycles),
    // we return it instead of throwing, to prevent the app from crashing.
    return context;
};
