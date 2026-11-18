import { openUrl } from '@tauri-apps/plugin-opener';
import { bestEffort } from '../../../platform/bestEffort';
import { APP_VERSION } from '../../../version';
import { useT } from '../../../i18n';
import type { SectionProps } from '../types';

const THIRD_PARTY_LICENSES: { name: string; license: string; copyright: string }[] = [
  { name: 'CodeMirror',              license: 'MIT',                        copyright: '© Marijn Haverbeke and contributors'      },
  { name: 'highlight.js',            license: 'BSD 3-Clause',               copyright: '© 2006 Ivan Sagalaev'                     },
  { name: 'html-to-image',           license: 'MIT',                        copyright: '© 2017 W.Y.'                              },
  { name: 'html2canvas',             license: 'MIT',                        copyright: '© 2012 Niklas von Hertzen'               },
  { name: 'IBM Plex Mono',           license: 'SIL Open Font License 1.1', copyright: '© 2017 IBM Corp.'                          },
  { name: 'js-yaml',                 license: 'MIT',                        copyright: '© 2011 Vitaly Puzrin and contributors'    },
  { name: 'jsPDF',                   license: 'MIT',                        copyright: '© 2010 James Hall and contributors'       },
  { name: 'JSZip',                   license: 'MIT / GPL-3.0',              copyright: '© 2009 Stuart Knightley and contributors' },
  { name: 'KaTeX',                   license: 'MIT',                        copyright: '© 2013 Khan Academy and contributors'     },
  { name: 'Kova Icons (Nerd Fonts)', license: 'MIT',                        copyright: '© 2014 Ryan L McIntyre and contributors'  },
  { name: 'Mermaid',                 license: 'MIT',                        copyright: '© 2014 Knut Sveidqvist and contributors'  },
  { name: 'Montserrat',              license: 'SIL Open Font License 1.1', copyright: '© 2011 The Montserrat Project Authors'    },
  { name: 'Pele',                    license: 'MIT',                        copyright: '© 2026 kepano'                           },
  { name: 'PptxGenJS',               license: 'MIT',                        copyright: '© 2015 Brent Ely'                        },
  { name: 'React',                   license: 'MIT',                        copyright: '© Meta Platforms, Inc.'                  },
  { name: 'react-qr-code',           license: 'MIT',                        copyright: '© 2017 Ross Khanas'                      },
  { name: 'react-resizable-panels',  license: 'MIT',                        copyright: '© 2022 Brian Vaughn'                     },
  { name: 'remark / unified',        license: 'MIT',                        copyright: '© unified collective'                    },
  { name: 'Tauri',                   license: 'MIT / Apache 2.0',           copyright: '© 2017 Tauri Apps Contributors'          },
  { name: 'typo-js',                 license: 'BSD 3-Clause',               copyright: '© Christopher Finke'                     },
  { name: 'Vite',                    license: 'MIT',                        copyright: '© 2019 VoidZero Inc. and Vite contributors' },
];

export function AboutSection({ inView, searching, aboutView, setAboutView }: Pick<SectionProps, 'inView'> & {
  searching: boolean;
  aboutView: 'main' | 'licenses';
  setAboutView: (view: 'main' | 'licenses') => void;
}) {
  const t = useT();

  type AboutItem =
    | { kind: 'link'; label: string; description: string; url: string }
    | { kind: 'submenu'; label: string; description: string };

  const ABOUT_ITEMS: AboutItem[] = [
    { kind: 'link', label: t('settings.aboutLinkGithub'),    description: t('settings.aboutLinkGithubDescription'),    url: 'https://github.com/KovaMD/Kova' },
    { kind: 'link', label: t('settings.aboutLinkIssues'),    description: t('settings.aboutLinkIssuesDescription'),    url: 'https://github.com/KovaMD/Kova/issues' },
    { kind: 'link', label: t('settings.aboutLinkWiki'),      description: t('settings.aboutLinkWikiDescription'),      url: 'https://wiki.kova.md/' },
    { kind: 'link', label: t('settings.aboutLinkVscode'),    description: t('settings.aboutLinkVscodeDescription'),    url: 'https://marketplace.visualstudio.com/items?itemName=Kovamd.kova' },
    { kind: 'link', label: t('settings.aboutLinkSupport'),   description: t('settings.aboutLinkSupportDescription'),   url: 'https://opencollective.com/kovamd' },
    { kind: 'link', label: t('settings.aboutLinkCommunity'), description: t('settings.aboutLinkCommunityDescription'), url: 'https://matrix.to/#/#kova-md:matrix.org' },
    { kind: 'submenu', label: t('settings.showLicenses'),    description: t('settings.aboutLicensesDescription') },
  ];
  return (
    <>
      {inView('about', `Kova ${t('settings.aboutLicense')} ${ABOUT_ITEMS.map(l => `${l.label} ${l.description}`).join(' ')}`) && (
        !searching && aboutView === 'licenses' ? (
          <>
            <button
              type="button"
              onClick={() => setAboutView('main')}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, marginBottom: 14,
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                color: 'var(--text-secondary)', fontSize: 12, fontFamily: 'inherit',
              }}
            >
              <svg width="7" height="10" viewBox="0 0 7 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 1 1.5 5 6 9" />
              </svg>
              {t('common.back')}
            </button>

            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>
              {t('settings.showLicenses')}
            </div>

            <div style={{
              border: '1px solid var(--border)',
              borderRadius: 4,
              overflow: 'hidden',
            }}>
              {THIRD_PARTY_LICENSES.map((entry, i) => (
                <div
                  key={entry.name}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    alignItems: 'baseline',
                    gap: '6px 12px',
                    padding: '7px 10px',
                    background: i % 2 === 0 ? 'var(--bg-app)' : 'transparent',
                    borderBottom: i < THIRD_PARTY_LICENSES.length - 1 ? '1px solid var(--border)' : 'none',
                  }}
                >
                  <div>
                    <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>{entry.name}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 8 }}>{entry.copyright}</span>
                  </div>
                  <span style={{
                    fontSize: 10,
                    color: 'var(--text-secondary)',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-alt)',
                    borderRadius: 3,
                    padding: '1px 6px',
                    whiteSpace: 'nowrap',
                  }}>
                    {entry.license}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Kova</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3 }}>
                  {t('settings.aboutLicense')}
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                v{APP_VERSION}
              </div>
            </div>

            <div style={{
              marginTop: 16,
              border: '1px solid var(--border)',
              borderRadius: 4,
              overflow: 'hidden',
            }}>
              {ABOUT_ITEMS.map((item, i) => (
                <button
                  key={item.kind === 'link' ? item.url : 'licenses'}
                  type="button"
                  onClick={() => item.kind === 'link' ? bestEffort(openUrl(item.url), 'openUrl') : setAboutView('licenses')}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                    width: '100%', textAlign: 'left', fontFamily: 'inherit',
                    padding: '10px 12px',
                    background: i % 2 === 0 ? 'var(--bg-app)' : 'transparent',
                    border: 'none',
                    borderBottom: i < ABOUT_ITEMS.length - 1 ? '1px solid var(--border)' : 'none',
                    cursor: 'pointer',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{item.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{item.description}</div>
                  </div>
                  {item.kind === 'link' ? (
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.2"
                      strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-dim)', flexShrink: 0 }}
                    >
                      <path d="M4 2h5v5" />
                      <path d="M8.8 2.2 2 9" />
                    </svg>
                  ) : (
                    <svg width="6" height="10" viewBox="0 0 6 10" fill="none" stroke="currentColor" strokeWidth="1.3"
                      strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-dim)', flexShrink: 0 }}
                    >
                      <path d="M1 1 5 5 1 9" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </>
        )
      )}
    </>
  );
}
