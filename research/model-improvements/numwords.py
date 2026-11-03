"""Amounts written in words ("twelve point five Euros", "twenty-five", "a hundred and fifty thousand").

The app's `temporal_service.repaired` keeps an amount only if its quote states a number in digits; transcripts that
spell numbers out (the AMI manual transcripts do; people say them) lose correctly read amounts. `quoted_amounts` returns
the numbers a quote states in digits (the app's own `quoted_numbers`) or in words.
"""
import re

UNITS = {w: i for i, w in enumerate("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen "
                                    "fifteen sixteen seventeen eighteen nineteen".split())}
TENS = {w: 10 * i for i, w in enumerate("_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()) if w != "_"}
SCALES = {"thousand": 1_000, "million": 1_000_000, "billion": 1_000_000_000}
WORD = re.compile(r"[a-z]+", re.I)


def _cardinal(words):
    """'one hundred and fifty thousand' -> 150000; None if the words are not one well-formed number."""
    total, current, seen = 0, 0, False
    for w in words:
        if w in UNITS:
            if current % 100 >= 10 and current % 10 == 0 and UNITS[w] < 10:
                current += UNITS[w]  # twenty five
            elif current % 100:
                return None  # "five six": two numbers
            else:
                current += UNITS[w]
        elif w in TENS:
            if current % 100:
                return None
            current += TENS[w]
        elif w == "hundred":
            if current >= 100 or current == 0 and seen:
                return None
            current = max(current, 1) * 100
        elif w in SCALES:
            if total and total < SCALES[w]:
                return None
            total += max(current, 1) * SCALES[w]
            current = 0
        elif w == "a" and not seen:
            current = 1
            continue
        elif w == "and" and seen:
            continue
        else:
            return None
        seen = True
    return total + current if seen else None


def word_numbers(text):
    """Numbers spelled out in the text, as int or float. A run that is not one well-formed number gives its parts."""
    tokens = [t.casefold() for t in WORD.findall((text or "").replace("-", " "))]
    numeric = set(UNITS) | set(TENS) | set(SCALES) | {"hundred", "point", "and", "a"}
    starts = set(UNITS) | set(TENS)
    found, i = [], 0
    while i < len(tokens):
        begins = tokens[i] in starts or tokens[i] == "a" and i + 1 < len(tokens) and tokens[i + 1] in ("hundred", *SCALES)
        if not begins:
            i += 1
            continue
        j = i + 1
        while j < len(tokens) and tokens[j] in numeric:
            j += 1
        run = tokens[i:j]
        while run and run[-1] in ("and", "a", "point"):
            run.pop()
        if "point" in run:
            at = run.index("point")
            whole, rest = _cardinal(run[:at]), run[at + 1:]
            digits = [w for w in rest if w in UNITS and UNITS[w] < 10]
            scale = rest[len(digits):]
            if whole is not None and digits and (not scale or len(scale) == 1 and scale[0] in SCALES):
                value = float(f"{whole}." + "".join(str(UNITS[d]) for d in digits)) * (SCALES[scale[0]] if scale else 1)
                found.append(value)
            else:
                found += [n for n in (_cardinal([w]) for w in run if w in starts) if n is not None]
        else:
            value = _cardinal(run)
            found += [value] if value is not None else [n for n in (_cardinal([w]) for w in run if w in starts) if n is not None]
        i = j
    return [int(n) if float(n).is_integer() else n for n in found]


def quoted_amounts(quote):
    from temporal_service import quoted_numbers
    return set(quoted_numbers(quote)) | set(word_numbers(quote or ""))


def repaired(candidate, registry):
    """temporal_service.repaired, except that an amount whose quote states no number in digits is kept when the quote
    states that same amount in words. Words only confirm a value; they never replace one."""
    from dataclasses import replace
    from temporal_service import quoted_numbers, repaired as app_repaired
    fixed = app_repaired(candidate, registry)
    if fixed is not None:
        return fixed
    spec = registry.objects.get(candidate.object_id) if candidate.object_id else None
    names = [a.name for a in spec.attributes] if spec else []
    if spec and candidate.attribute not in names and len(names) == 1:
        candidate = replace(candidate, attribute=names[0])
    try:
        value = float(re.sub(r"[^\d.\-]", "", str(candidate.value)))
    except ValueError:
        return None
    if not quoted_numbers(candidate.quote) and any(abs(n - value) < 1e-9 for n in word_numbers(candidate.quote)):
        return candidate
    return None
