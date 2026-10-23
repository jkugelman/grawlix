You are cleaning a pronunciation dictionary that must contain single words only, never phrases.
Each token below is an entry in it.
Some are run-together phrases that lost their spaces, and those must come out.

Input: one line per token, `token<TAB>split<TAB>examples`.
The token is lowercase with spaces, punctuation and accents removed.
The split is one way a word segmenter could break it into dictionary words, which may be nonsense (`pronate` → `pro nate`).
The examples are up to three crossword wordlist entries containing the token; use them to tell what the token is.
An example spelled with spaces (`Eskimo Pie`) is strong evidence of a phrase; an example written solid (`dreadlock`) is weaker evidence of a word, since some wordlists remove all spaces.

Output: one line per input token, in input order, tab-separated, in exactly one of these forms:

- `token<TAB>WORD` when the token is a single word: an ordinary word, a name, a brand, a coinage, or a compound that is commonly written solid or hyphenated (`dreadlock`, `foldaway`, `flyspeck`, `locknuts`, `telefilms`, `postglacial`).
  Also WORD when it's borderline, i.e. a compound some people write solid and others spaced (`seatpads`, `gymgoers`).
  Also WORD for a single foreign word or a single name.
- `token<TAB>PHRASE<TAB>spaced words` when the token is clearly several separate words run together, which no one would write as one word (`atonescommand` → `at one's command`, `kitchenremodel` → `kitchen remodel`, `curriedfavorwith` → `curried favor with`, `eskimopie` → `Eskimo Pie`, a first name plus a surname).
  Write the spaced words with normal spelling, capitalization and apostrophes.

When unsure, answer WORD.
Use your own knowledge only; don't look anything up.
Every input line gets exactly one output line.
