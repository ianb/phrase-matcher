/*
This implements the compiler that translates pattern strings to a matcher.

Syntax:

* The phrase must be matched completely, beginning to end
* Words match that word
* A "stopword" (not-important word) can appear anywhere, and is ignored
  * Stopwords are defined in english.toml
* Aliases (words that might be spelled differently or misheard) can be matched
  * Aliases are defined in english.toml
* There can be alternatives, like `(one | two | three four)`
  * Each alternative is separated by `|`. In this example "three four" must appear together
  * Using an empty alternative makes the word optional, like `(page |)` matches "page" or nothing
* "Slots" are named and use the syntax `[slotName]`. These act like a wildcard
  * Wildcards still must match at least one word
  * Slots can be typed like `[slotName:entityType]`, and are not wildcards
* "Parameters" are like tags on a phrase, and do not match anything. The syntax is `[param=value]`
  * This is used to distinguish one phrase from another

*/

import {
  Slot,
  Alternatives,
  Word,
  Wildcard,
  Sequence,
  FullPhrase,
  makeWordList,
} from "./textMatching.js";

/* The entities passed to compile() must go through this function. Typically you call:

    convertEntities({lang: ["English", "Spanish", ...]})

This can be passed into `compile()`
*/
export function convertEntities(entityMapping) {
  const result = {};
  for (const name in entityMapping) {
    result[name] = new Alternatives(
      entityMapping[name].map((e) => makeWordMatcher(e))
    );
  }
  return result;
}

function makeWordMatcher(string) {
  const list = makeWordList(string);
  if (list.length === 1) {
    return list[0];
  }
  return new Sequence(list);
}

export function splitPhraseLines(string) {
  if (typeof string !== "string") {
    throw new Error(`Bad input: ${string}`);
  }
  const result = [];
  let balances = "";
  let lastNewline = -1;
  if (!string.endsWith("\n")) {
    string += "\n";
  }
  for (let i = 0; i < string.length; i++) {
    const c = string.charAt(i);
    if (c === "}" || c == "]" || c == ")") {
      if (!balances) {
        const exc = new Error(`Unbalanced "${c}" at position ${i}`);
        exc.position = i;
        throw exc;
      }
      const last = balances.charAt(balances.length - 1);
      if (
        (c === "}" && last !== "{") ||
        (c === ")" && last !== "(") ||
        (c === "]" && last !== "[")
      ) {
        const exc = new Error(`Got "${c}" when expecting to close "${last}"`);
        exc.position = i;
        throw exc;
      }
      balances = balances.substr(0, balances.length - 1);
    } else if (/[\[\{\(]/.test(c)) {
      balances += c;
    } else if (c === "\n" && !balances) {
      const line = string.substr(lastNewline + 1, i - lastNewline).trim();
      if (line && !line.startsWith("#")) {
        result.push(line);
      }
      lastNewline = i;
    }
  }
  if (balances) {
    const exc = new Error(`Open "${balances}" in string`);
    exc.position = string.length - 1;
    throw exc;
  }
  return result;
}

export function compile(string, options) {
  options = options || {};
  const entities = options.entities || {};
  const intentName = options.intentName;
  const seq = [];
  const parameters = {};
  let toParse = string;
  // This is a kind of hacky way to make something like "page(s)" change to "page{s}" which is easier to parse:
  toParse = toParse.replace(/(?<=[^\s])\(([^\s)]+)\)/g, (match, group1) => {
    return `{${group1}}`;
  });
  while (toParse) {
    if (_isParameter(toParse)) {
      const paramResult = _getParameters(toParse);
      Object.assign(parameters, paramResult.parameters);
      toParse = paramResult.phrase;
    } else if (toParse.startsWith("[")) {
      const { slot, phrase, empty } = _getSlot(toParse);
      toParse = phrase;
      if (slot.includes(":")) {
        const parts = slot.split(":");
        const slotName = parts[0].trim();
        const entityName = parts[1].trim();
        if (!entities[entityName]) {
          throw new Error(`No entity type by the name ${entityName}`);
        }
        seq.push(new Slot(entities[entityName], slotName, empty));
      } else {
        seq.push(new Slot(new Wildcard(empty), slot));
      }
    } else if (toParse.startsWith("(")) {
      const { alts, phrase, empty } = _getAlternatives(toParse);
      toParse = phrase;
      const altWords = alts.map((words) => makeWordMatcher(words));
      seq.push(new Alternatives(altWords, empty));
    } else {
      const { words, phrase } = _getWords(toParse);
      for (let word of words.split(/\s+/g)) {
        let empty = false;
        if (word.endsWith("?")) {
          empty = true;
          word = word.substr(0, word.length - 1);
        }
        if (word === "*") {
          seq.push(new Wildcard(true));
        } else if (_isAltWord(word)) {
          seq.push(
            new Alternatives(_altWords(word).map((w) => new Word(w, empty)))
          );
        } else {
          seq.push(new Word(word, empty));
        }
      }
      toParse = phrase;
    }
  }
  const phrase = new FullPhrase(seq, { intentName, parameters });
  phrase.originalSource = string;
  return phrase;
}

function _getAlternatives(phrase) {
  if (!phrase.startsWith("(")) {
    throw new Error("Expected (");
  }
  phrase = phrase.substr(1);
  if (!phrase.includes(")")) {
    throw new Error("Missing )");
  }
  let alts = phrase.substr(0, phrase.indexOf(")"));
  alts = alts.split("|");
  alts = alts.map((w) => w.trim());
  let empty = false;
  if (alts.includes("")) {
    empty = true;
    alts = alts.filter((w) => w);
  }
  let altWords = [];
  for (const word of alts) {
    if (_isAltWord(word)) {
      altWords = altWords.concat(_altWords(word));
    } else {
      altWords.push(word);
    }
  }
  phrase = phrase.substr(phrase.indexOf(")") + 1).trim();
  if (phrase.startsWith("?")) {
    empty = true;
    phrase = phrase.substr(1).trim();
  }
  return { phrase, alts: altWords, empty };
}

function _getSlot(phrase) {
  if (!phrase.startsWith("[")) {
    throw new Error("Expected [");
  }
  phrase = phrase.substr(1);
  if (!phrase.includes("]")) {
    throw new Error("Missing ]");
  }
  const slot = phrase.substr(0, phrase.indexOf("]")).trim();
  phrase = phrase.substr(phrase.indexOf("]") + 1).trim();
  let empty = false;
  if (phrase.startsWith("?")) {
    empty = true;
    phrase = phrase.substr(1);
  }
  return { slot, phrase, empty };
}

function _getWords(phrase) {
  const nextParen = phrase.indexOf("(");
  const nextBracket = phrase.indexOf("[");
  const nextBrace = phrase.search(/(?<=\s)\{/);
  if (nextParen === -1 && nextBracket === -1 && nextBrace === -1) {
    // There are no special characters
    return { words: phrase, phrase: "" };
  }
  const nexts = [nextParen, nextBracket, nextBrace].filter((x) => x !== -1);
  const next = Math.min(...nexts);
  const words = phrase.substr(0, next).trim();
  return { words, phrase: phrase.substr(next) };
}

function _isAltWord(string) {
  return /\{[^}]+\}/.test(string);
}

function _altWords(string) {
  const bit = /\{([^}]+)\}/.exec(string)[1];
  const baseWord = string.replace(/\{[^}]+\}/, "");
  const altWord = string.replace(/\{[^}]\}/, bit);
  return [baseWord, altWord];
}

function _isParameter(phrase) {
  return /^\[\w+=/.test(phrase) || phrase.startsWith("{");
}

function _getParameters(phrase) {
  const originalPhrase = phrase;
  if (!phrase.startsWith("[") && !phrase.startsWith("{")) {
    throw new Error("Expected [");
  }
  let balances = phrase.charAt(0);
  phrase = phrase.substr(1);
  let paramSetter;
  for (let i = 0; i < phrase.length; i++) {
    const c = phrase.charAt(i);
    if (c === "{" || c === "(" || c === "[") {
      balances += c;
    }
    if (c === "}" || c === ")" || c === "]") {
      const last = balances.charAt(balances.length - 1);
      if (
        (c === "}" && last !== "{") ||
        (c === ")" && last !== "(") ||
        (c === "]" && last !== "[")
      ) {
        throw new Error(`Unbalanced ${c}, expected to close ${last}`);
      }
      balances = balances.substr(0, balances.length - 1);
      if (!balances) {
        paramSetter = phrase.substr(0, i);
        phrase = phrase.substr(i + 1);
        break;
      }
    }
  }
  if (balances) {
    throw new Error(
      `Unclosed in expression "${originalPhrase}": "${balances}"`
    );
  }
  paramSetter = paramSetter.trim();
  const parameters = {};
  const matches = Array.from(paramSetter.matchAll(/\s*([a-zA-Z0-9_-]+)\s*=/g));
  if (!matches || !matches.length) {
    throw new Error(`No variables in {${paramSetter}}`);
  }
  if (paramSetter.substr(0, matches[0].index).trim()) {
    throw new Error(
      `Unexpected text before variable assignment (${JSON.stringify(
        paramSetter.substr(0, matches[0].index).trim()
      )}) in {${paramSetter}}`
    );
  }
  // Sentinal to make the loop below work better:
  matches.push({ index: paramSetter.length });
  let lastVariable;
  for (let i = 0; i < matches.length; i++) {
    if (lastVariable) {
      const value = dedentTrailingLines(
        paramSetter.substring(
          matches[i - 1].index + matches[i - 1][0].length,
          matches[i].index
        )
      );
      if (lastVariable in parameters) {
        if (Array.isArray(parameters[lastVariable])) {
          parameters[lastVariable].push(value);
        } else {
          parameters[lastVariable] = [parameters[lastVariable], value];
        }
      } else {
        parameters[lastVariable] = value;
      }
    }
    lastVariable = matches[i][1];
  }
  return { parameters, phrase };
}

function dedentTrailingLines(string) {
  const lines = string.trim().split(/\n/g);
  let minIndent;
  for (let i = 1; i < lines.length; i++) {
    const match = /^\s+/.exec(lines[i]);
    const length = match ? match[0].length : 0;
    if (minIndent === undefined || length < minIndent) {
      minIndent = length;
    }
  }
  if (minIndent) {
    for (let i = 1; i < lines.length; i++) {
      lines[i] = lines[i].substr(minIndent);
    }
    return lines.join("\n");
  } else {
    return string.trim();
  }
}
