# phrase-matcher

JavaScript library to pattern-match English phrases

## Installation

I'm not sure how well this installs! But for use in a browser, do:

```sh
git clone https://github.com/ianb/phrase-matcher.git
cd phrase-master
npm install
npm run rollup
cp dist/phraseMatcher.js ...my-project/public/
```

I haven't done much npm distribution, and would welcome patches to improve this part.

## Usage

The bundled file exposes a `phraseMatcher` object with the following properties:

### `compile(rule, {entities, intentName})`

Compiles a single rule into a `FullPhrase()` object. You can look at `compile(...).toString()` to confirm how the phrase was compiled.

Typically you will take several phrases and put them together.

### `convertEntities({entityType: ["word1", "word2"])})`

Entities are when you have a slot like `[n:number]` (which matches `1`, `2`, etc under the slot `n`).

The actual entities the compiler expects is a specific matching objects, and this creates that object.

### `splitPhraseLines(bigString)`

This takes a list of phrases and returns one string per line (but respecting things like `{...}` that goes over more than one line). It also removes empty lines and comment lines (starting with `#`).

### `new PhraseSet(phraseMatchers)`

Given many phrases, this object can match against all those phrases and pick out the best match.

`.match(utteranceString)`: this matches the utteranceString against the phrases, and returns null or the best match. The match object is shown below.

`enumeratePhrases(fillerFunc)`: this enumerates all possible phrases, using `fillerFunc(slotName) -> String` to replace wildcard slots.

### Match objects

This is returned by `.match(...)`. It has these attributes:

`.utterance`: original matched string

`.slots`: an object containing the matched slots

`.intentName`: the intentName (as passed in to `compile()`)
