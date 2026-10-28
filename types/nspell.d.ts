// Tipos mínimos de nspell (corrector Hunspell en JavaScript, sin tipos propios).
declare module "nspell" {
  interface NSpell {
    correct(word: string): boolean;
    suggest(word: string): string[];
    add(word: string, model?: string): NSpell;
    remove(word: string): NSpell;
  }
  function nspell(aff: string | Uint8Array, dic?: string | Uint8Array): NSpell;
  export default nspell;
}
