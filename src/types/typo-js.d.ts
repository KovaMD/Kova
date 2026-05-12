declare module 'typo-js' {
  export default class Typo {
    constructor(
      dictionary?: string,
      affData?: string | false,
      dicData?: string | false,
      settings?: { platform?: string; dictionaryPath?: string },
    );
    check(word: string): boolean;
    suggest(word: string): string[];
  }
}
