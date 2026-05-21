import React, { createContext, useContext, useState, useEffect } from 'react';

type UiMode = 'tactical' | 'standard';

interface TerminologyContextType {
    uiMode: UiMode;
    setUiMode: (mode: UiMode) => void;
    t_term: (tacticalWord: string, standardWord: string) => string;
}

const TerminologyContext = createContext<TerminologyContextType | undefined>(undefined);

export const TerminologyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [uiMode, setUiModeState] = useState<UiMode>(() => {
        return (localStorage.getItem('scorpion_ui_mode') as UiMode) || 'tactical';
    });

    const setUiMode = (mode: UiMode) => {
        setUiModeState(mode);
        localStorage.setItem('scorpion_ui_mode', mode);
    };

    const t_term = (tacticalWord: string, standardWord: string) => {
        return uiMode === 'tactical' ? tacticalWord : standardWord;
    };

    return (
        <TerminologyContext.Provider value={{ uiMode, setUiMode, t_term }}>
            {children}
        </TerminologyContext.Provider>
    );
};

export const useTerminology = () => {
    const context = useContext(TerminologyContext);
    if (!context) {
        throw new Error('useTerminology must be used within a TerminologyProvider');
    }
    return context;
};
