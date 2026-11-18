import { useState } from 'react';
import { useT } from '../../../i18n';
import {
  LANGUAGE_OPTIONS,
  getCustomWords,
  removeCustomWord,
  getCustomWordCount,
} from '../../../engine/spellcheck/spellChecker';
import type { SectionProps } from '../types';
import { Toggle, Row } from '../controls';

export function LanguageSection({ settings, set, inView }: SectionProps) {
  const t = useT();

  const [customWordList, setCustomWordList] = useState<string[]>(() => getCustomWords());
  const [showCustomWords, setShowCustomWords] = useState(false);

  function handleRemoveCustomWord(word: string) {
    removeCustomWord(word);
    setCustomWordList(getCustomWords());
  }
  return (
    <>
      {inView('language', `${t('settings.checkSpelling')} ${t('settings.checkSpellingDescription')}`) && (
        <Row
          label={t('settings.checkSpelling')}
          description={t('settings.checkSpellingDescription')}
          control={<Toggle checked={settings.spellCheckEnabled} onChange={(v) => set('spellCheckEnabled', v)} />}
        />
      )}

      {inView('language', `${t('settings.dictionaryLanguage')} ${t('settings.learnedWords', { count: getCustomWordCount() })}`) && settings.spellCheckEnabled && (
        <>
          <div style={{ paddingBottom: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--text-label)', marginBottom: 8 }}>{t('settings.dictionaryLanguage')}</div>
            <div style={{ position: 'relative' }}>
              <select
                value={settings.spellCheckLanguage}
                onChange={(e) => set('spellCheckLanguage', e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 28px 6px 10px',
                  fontSize: 12,
                  borderRadius: 4,
                  border: '1px solid var(--border-alt)',
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  outline: 'none',
                }}
              >
                {LANGUAGE_OPTIONS.map(({ code, label }) => (
                  <option key={code} value={code}>{label}</option>
                ))}
              </select>
              <svg
                viewBox="0 0 10 6"
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  width: 10, height: 6, pointerEvents: 'none', color: 'var(--text-dim)',
                }}
              >
                <path d="M0 0l5 6 5-6z" fill="currentColor" />
              </svg>
            </div>
          </div>

          <div style={{ paddingBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: customWordList.length > 0 && showCustomWords ? 8 : 0 }}>
              <div style={{ fontSize: 11, color: 'var(--text-label)' }}>
                {t('settings.learnedWords', { count: getCustomWordCount() })}
              </div>
              {customWordList.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowCustomWords(!showCustomWords)}
                  style={{
                    padding: '3px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                    border: '1px solid var(--border-alt)', background: 'var(--bg-input)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {showCustomWords ? t('common.hide') : t('settings.learnedWordsManage')}
                </button>
              )}
              {customWordList.length === 0 && (
                <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{t('settings.learnedWordsNone')}</span>
              )}
            </div>

            {showCustomWords && customWordList.length > 0 && (
              <div style={{
                marginTop: 8,
                maxHeight: 160,
                overflowY: 'auto',
                border: '1px solid var(--border)',
                borderRadius: 4,
                background: 'var(--bg-app)',
              }}>
                {customWordList.map((word) => (
                  <div key={word} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '5px 10px', borderBottom: '1px solid var(--border)',
                  }}>
                    <span style={{ fontSize: 12, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{word}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveCustomWord(word)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px',
                        color: 'var(--text-dim)', fontSize: 14, lineHeight: 1,
                      }}
                      title={t('settings.removeFromDictionary')}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
