import React from 'react';
import { useTranslation } from 'react-i18next';

const languages = [
  { code: 'en', label: 'English' },
  { code: 'te', label: 'తెలుగు' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'zh', label: '简体中文' },
  { code: 'ja', label: '日本語' },
  { code: 'pt', label: 'Português' },
  { code: 'ru', label: 'Русский' },
  { code: 'ko', label: '한국어' },
  { code: 'ar', label: 'العربية' },
];

export default function LanguageSwitcher() {
  const { i18n } = useTranslation();

  React.useEffect(() => {
    const dir = i18n.language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.setAttribute('dir', dir);
  }, [i18n.language]);

  const handleChange = (e) => {
    const newLang = e.target.value;
    i18n.changeLanguage(newLang);
  };

  return (
    <select
      value={i18n.language}
      onChange={handleChange}
      aria-label={i18n.t('common.select_language')}
      style={{
        background: 'rgba(255,255,255,0.08)',
        color: 'inherit',
        border: '1px solid rgba(255,255,255,0.2)',
        borderRadius: '6px',
        padding: '4px 10px',
        fontSize: '0.875rem',
        cursor: 'pointer',
      }}
    >
      {languages.map(({ code, label }) => (
        <option key={code} value={code} style={{ background: '#1a1a2e', color: '#fff' }}>
          {label}
        </option>
      ))}
    </select>
  );
}
