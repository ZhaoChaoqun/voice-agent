"""Export the phonetic name matcher's tables for the browser port (name-search.mjs).

The matcher is the Python phonetic-name-search package (`namesearch`). Its decisions were all
measured there, so the port copies them rather than re-deriving them: this script writes the
G2P rules and exceptions, the accent-aware phoneme costs, the filler and particle lists, the
blocking classes, the nickname groups, the common-word list and the scoring constants to
data/name-search-data.json. web/name-search.mjs implements only the algorithms, and
tests/test_name_search.mjs checks it against this Python reference result by result.

The reference is not part of this repository; point NAMESEARCH_REFERENCE at a checkout of it:

    NAMESEARCH_REFERENCE=/path/to/phonetic-name-search python3 tools/build_name_search_data.py
"""

import json
import os
import sys
from pathlib import Path

OUTPUT = Path(__file__).resolve().parent.parent / "data" / "name-search-data.json"
if not os.environ.get("NAMESEARCH_REFERENCE"):
    sys.exit("Set NAMESEARCH_REFERENCE to the phonetic-name-search directory (see the docstring).")
sys.path.insert(0, os.environ["NAMESEARCH_REFERENCE"])

from importlib import import_module  # noqa: E402

from namesearch import g2p, keys, nicknames, normalize, phonemes  # noqa: E402
from namesearch.english import COMMON_WORDS  # noqa: E402

# By module name: the package re-exports a `search` function over the submodule.
search = import_module("namesearch.search")


def pairs(table):
    return sorted([*sorted(key), value] for key, value in table.items())


def main():
    data = {
        "source": "phonetic-name-search/namesearch, exported by build_name_search_data.py",
        "g2p": {
            "exceptions": g2p.EXCEPTIONS,
            "rules": [[pattern, list(alternatives)] for pattern, alternatives in g2p._RAW_RULES],
            "max_states": g2p._MAX_STATES,
            "max_variants": g2p._MAX_VARIANTS,
        },
        "normalize": {
            "strong_filler": sorted(normalize.STRONG_FILLER),
            "weak_filler": sorted(normalize.WEAK_FILLER),
            "particles": sorted(normalize.PARTICLES),
            "spelled_markers": sorted(normalize._SPELLED_MARKERS),
        },
        "phonemes": {
            "consonants": {key: list(value) for key, value in phonemes.CONSONANTS.items()},
            "vowels": {key: list(value) for key, value in phonemes.VOWELS.items()},
            "place_order": list(phonemes._PLACE_ORDER),
            "manner_distance": pairs(phonemes._MANNER_DISTANCE),
            "confusion_pairs": pairs(phonemes._CONFUSION_PAIRS),
            "cheap_to_drop": phonemes._CHEAP_TO_DROP,
            "reduced_vowel_cost": phonemes._REDUCED_VOWEL_COST,
            "final_deletion_discount": phonemes._FINAL_DELETION_DISCOUNT,
            "max_vowel_sub_cost": phonemes._MAX_VOWEL_SUB_COST,
            "min_consonant_sub_cost": phonemes._MIN_CONSONANT_SUB_COST,
        },
        "keys": {"classes": keys._CLASS},
        "nicknames": list(nicknames._GROUPS),
        "common_words": sorted(COMMON_WORDS),
        "search": {
            name: getattr(search, name)
            for name in ("ROLE_WEIGHT", "MIN_PAIR_SIMILARITY", "SCORE_FLOOR", "MATCH_FLOOR", "AMBIGUITY_MARGIN",
                         "NO_SURNAME_PENALTY", "UNMATCHED_TOKEN_PENALTY", "ALIAS_PENALTY", "MIN_JOINED_SIMILARITY",
                         "COMMON_WORD_EVIDENCE", "MAX_SCORING_VARIANTS", "MAX_JOIN_SPAN", "MAX_JOIN_WORD_LENGTH", "RRF_K")
        },
    }
    path = OUTPUT
    path.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")
    print(f"wrote {path.name}: {len(data['g2p']['rules'])} rules, {len(data['g2p']['exceptions'])} exceptions, "
          f"{len(data['common_words'])} common words, {len(data['nicknames'])} nickname groups")


if __name__ == "__main__":
    main()
