import { useState } from 'react';
import { useT } from '../../../i18n';
import {
  LANGUAGE_OPTIONS,
  getCustomWords,
  removeCustomWord,
  getCustomWordCount,
} from '../../../engine/spellcheck/spellChecker';
import type { SectionProps } from '../types';
import { Toggle, Row, Select } from '../controls';

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
          <div className="settings-subfield">
            <div className="settings-field__sublabel">{t('settings.dictionaryLanguage')}</div>
            <Select value={settings.spellCheckLanguage} onChange={(e) => set('spellCheckLanguage', e.target.value)}>
              {LANGUAGE_OPTIONS.map(({ code, label }) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </Select>
          </div>

          <div className="settings-subfield">
            <div className={`settings-words__header${customWordList.length > 0 && showCustomWords ? ' settings-words__header--open' : ''}`}>
              <div className="settings-words__count">
                {t('settings.learnedWords', { count: getCustomWordCount() })}
              </div>
              {customWordList.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowCustomWords(!showCustomWords)}
                  className="settings-small-btn"
                >
                  {showCustomWords ? t('common.hide') : t('settings.learnedWordsManage')}
                </button>
              )}
              {customWordList.length === 0 && (
                <span className="settings-status">{t('settings.learnedWordsNone')}</span>
              )}
            </div>

            {showCustomWords && customWordList.length > 0 && (
              <div className="settings-words__list">
                {customWordList.map((word) => (
                  <div key={word} className="settings-words__item">
                    <span className="settings-words__word">{word}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveCustomWord(word)}
                      className="settings-words__remove"
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
