import type { EditorView } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import type { MenuEntry } from './EditorContextMenu';
import { getWordAtPos, doCopy, doCut, doPaste, doInsert, doWrap, doToggleLineStepMarker, hasLineStepMarker } from './contextMenuActions';
import { indentLine, dedentLine } from './formatCommands';
import {
  isSpellCheckerReady,
  spellCheck,
  spellSuggest,
  addCustomWord,
  ignoreSpellingFor,
} from '../../engine/spellcheck/spellChecker';
import type { Translator } from '../../i18n';

interface BuildContextMenuEntriesParams {
  t: Translator;
  mod: string;
  view: EditorView | null;
  hasSelection: boolean;
  clickPos: number | null;
  spellCheckEnabled: boolean;
  onOpenTablePrompt: () => void;
  onInsertMedia: () => void;
}

export function buildContextMenuEntries({
  t,
  mod,
  view,
  hasSelection,
  clickPos,
  spellCheckEnabled,
  onOpenTablePrompt,
  onInsertMedia,
}: BuildContextMenuEntriesParams): MenuEntry[] {
  const spellEntries: MenuEntry[] = [];
  if (spellCheckEnabled && clickPos != null && view && isSpellCheckerReady()) {
    const wordInfo = getWordAtPos(view, clickPos);
    if (wordInfo && !spellCheck(wordInfo.word)) {
      const suggestions = spellSuggest(wordInfo.word);
      spellEntries.push({ type: 'header', label: `"${wordInfo.word}"` });
      if (suggestions.length > 0) {
        suggestions.forEach(s => spellEntries.push({
          type: 'item',
          label: s,
          action: () => {
            view.dispatch({
              changes: { from: wordInfo.from, to: wordInfo.to, insert: s },
              selection: EditorSelection.cursor(wordInfo.from + s.length),
            });
            view.focus();
          },
        }));
      } else {
        spellEntries.push({ type: 'item', label: t('editor.menuNoSuggestions'), disabled: true, action: () => {} });
      }
      spellEntries.push({
        type: 'item',
        label: t('editor.menuAddToDictionary'),
        action: () => addCustomWord(wordInfo.word),
      });
      spellEntries.push({
        type: 'item',
        label: t('editor.menuIgnore'),
        action: () => ignoreSpellingFor(wordInfo.word),
      });
      spellEntries.push({ type: 'divider' });
    }
  }

  return [
    ...spellEntries,
    { type: 'item', label: t('editor.menuCopy'),  shortcut: `${mod}+C`, action: () => view && doCopy(view),  disabled: !hasSelection },
    { type: 'item', label: t('editor.menuCut'),   shortcut: `${mod}+X`, action: () => view && doCut(view),   disabled: !hasSelection },
    { type: 'item', label: t('editor.menuPaste'), shortcut: `${mod}+V`, action: () => view && doPaste(view) },
    { type: 'divider' },
    {
      type: 'submenu', label: t('editor.menuFormat'), entries: [
        { type: 'item', label: t('editor.menuBold'),          shortcut: `${mod}+B`,       action: () => view && doWrap(view, '**',  '**',   'bold text') },
        { type: 'item', label: t('editor.menuItalic'),        shortcut: `${mod}+I`,       action: () => view && doWrap(view, '*',   '*',    'italic text') },
        { type: 'item', label: t('editor.menuUnderline'),     shortcut: `${mod}+U`,       action: () => view && doWrap(view, '<u>', '</u>', 'underlined text') },
        { type: 'item', label: t('editor.menuStrikethrough'), shortcut: `${mod}+Shift+X`, action: () => view && doWrap(view, '~~',  '~~',   'strikethrough text') },
        { type: 'item', label: t('editor.menuInlineCode'),    shortcut: `${mod}+\``,      action: () => view && doWrap(view, '`',   '`',    'code') },
        { type: 'item', label: t('editor.menuIndent'),        shortcut: `${mod}+]`,       action: () => { if (view) indentLine(view); } },
        { type: 'item', label: t('editor.menuDedent'),        shortcut: `${mod}+[`,       action: () => { if (view) dedentLine(view); } },
      ],
    },
    {
      type: 'item',
      label: view && clickPos != null && hasLineStepMarker(view, clickPos) ? t('editor.menuRemoveStepMarker') : t('editor.menuAddStepMarker'),
      shortcut: `${mod}+Shift+R`,
      action: () => { if (view && clickPos != null) doToggleLineStepMarker(view, clickPos); },
    },
    { type: 'divider' },
    {
      type: 'submenu', label: t('editor.menuInsert'), entries: [
        { type: 'item', label: t('editor.menuCodeBlock'),      action: () => view && doInsert(view, '```\n\n```', 3) },
        { type: 'item', label: t('editor.menuBlockquote'),     action: () => view && doInsert(view, '> ', 2) },
        { type: 'item', label: t('editor.menuTable'), action: onOpenTablePrompt },
        { type: 'item', label: t('editor.menuHorizontalRule'), action: () => view && doInsert(view, '\n<hr>\n', 5) },
        { type: 'item', label: t('editor.menuImageOrVideo'), action: onInsertMedia },
        { type: 'item', label: t('editor.menuLink'),            action: () => view && doInsert(view, '[link text](url)', 1) },
        { type: 'item', label: t('editor.menuMathBlock'), action: () => view && doInsert(view, '$$\nE = mc^2\n$$', 3) },
        { type: 'item', label: t('editor.menuSpeakerNotes'),   action: () => view && doInsert(view, '\n\n???\n\n', 7) },
        { type: 'item', label: t('editor.menuReference'),       action: () => view && doInsert(view, '!ref[]', 5) },
        {
          type: 'item',
          label: t('editor.menuTableOfContents'),
          action: () => view && doInsert(view, '## Agenda\n\n!toc\n', 3),
        },
      ],
    },
    { type: 'divider' },
    {
      type: 'submenu', label: t('editor.menuCharts'), entries: [
        {
          type: 'item', label: t('editor.menuPieChart'),
          action: () => view && doInsert(
            view,
            '\n```mermaid\npie title Distribution\n    "Category A" : 40\n    "Category B" : 35\n    "Category C" : 25\n```\n',
            22,  // lands on "Distribution"
          ),
        },
        {
          type: 'item', label: t('editor.menuBarChart'),
          action: () => view && doInsert(
            view,
            '\n```mermaid\nxychart-beta\n    title "Sales by Quarter"\n    x-axis [Q1, Q2, Q3, Q4]\n    y-axis 0 --> 100\n    bar [40, 65, 55, 80]\n```\n',
            36,  // lands on "Sales by Quarter"
          ),
        },
        {
          type: 'item', label: t('editor.menuLineChart'),
          action: () => view && doInsert(
            view,
            '\n```mermaid\nxychart-beta\n    title "Trend Over Time"\n    x-axis [Jan, Feb, Mar, Apr, May]\n    y-axis 0 --> 100\n    line [30, 45, 60, 55, 75]\n```\n',
            36,  // lands on "Trend Over Time"
          ),
        },
      ],
    },
    {
      type: 'submenu', label: t('editor.menuDiagrams'), entries: [
        {
          type: 'item', label: t('editor.menuProgressBars'),
          action: () => view && doInsert(
            view,
            '\n!progress[Task Complete](75)\n!progress[In Progress](40)\n!progress[Planned](10)\n',
            11,  // lands on "Task Complete"
          ),
        },
        {
          type: 'item', label: t('editor.menuFlowchart'),
          action: () => view && doInsert(
            view,
            '\n```mermaid\nflowchart TD\n    A([Start]) --> B[Process Step]\n    B --> C{Decision?}\n    C -- Yes --> D([End])\n    C -- No --> B\n```\n',
            46,  // lands on "Process Step"
          ),
        },
        {
          type: 'item', label: t('editor.menuTimeline'),
          action: () => view && doInsert(
            view,
            '\n```mermaid\ntimeline\n    title Company Milestones\n    2022 : Founded\n         : Seed Funding\n    2023 : Product Launch\n         : 1K Users\n    2024 : Series A\n         : 10K Users\n```\n',
            31,  // lands on "Company Milestones"
          ),
        },
        {
          type: 'item', label: t('editor.menuSequenceDiagram'),
          action: () => view && doInsert(
            view,
            '\n```mermaid\nsequenceDiagram\n    participant U as User\n    participant A as App\n    participant D as Database\n    U->>A: Login Request\n    A->>D: Verify Credentials\n    D-->>A: User Found\n    A-->>U: Access Granted\n```\n',
            49,  // lands on "User"
          ),
        },
      ],
    },
  ];
}
