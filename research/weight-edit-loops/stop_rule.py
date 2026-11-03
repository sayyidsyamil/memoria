"""Opt-in streaming stop on an exactly repeated, completed event object.

No MLX imports. Feed only the newly emitted text on every stream response. If true,
close the generation iterator and return ``closed_text()``. Preserve ``text`` and
the reason/offsets for auditing. Restrict this detector to the extraction endpoint.
"""
import json
import re


class EventRepeatStop:
    def __init__(self):
        self.text = ""
        self.stack = []
        self.in_string = self.escaped = False
        self.start = None
        self.seen = set()
        self.events = []
        self.cut_start = self.observed_end = None
        self.reason = None
        self._eligible = None

    def feed(self, chunk):
        if self.reason:
            return True
        offset = len(self.text)
        self.text += chunk
        for at, char in enumerate(chunk, offset):
            if self.in_string:
                if self.escaped:
                    self.escaped = False
                elif char == "\\":
                    self.escaped = True
                elif char == '"':
                    self.in_string = False
                continue
            if char == '"':
                self.in_string = True
            elif char in "{[":
                if char == "{" and self.stack == ["{", "["]:
                    self.start = at
                    if self._eligible is None:
                        self._eligible = bool(re.fullmatch(r'\s*\{\s*"events"\s*:\s*\[\s*', self.text[:at]))
                self.stack.append(char)
            elif char in "}]":
                wanted = "{" if char == "}" else "["
                if not self.stack or self.stack[-1] != wanted:
                    self._eligible = False
                    continue
                if char == "}" and self.stack == ["{", "[", "{"] and self.start is not None:
                    if self._eligible and self._event(self.start, at + 1):
                        return True
                self.stack.pop()
        return False

    def _event(self, start, end):
        try:
            event = json.loads(self.text[start:end])
        except (ValueError, RecursionError):
            self._eligible = False
            return False
        if not isinstance(event, dict) or "quote" not in event:
            self._eligible = False
            return False
        key = json.dumps(event, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        if key in self.seen:
            self.cut_start, self.observed_end = start, end
            self.reason = "exact_completed_event_repeat"
            return True
        self.seen.add(key)
        self.events.append(event)
        return False

    def closed_text(self):
        if not self.reason:
            return self.text
        # Only formatting is supplied: no values, quotes, or event fields are inferred.
        prefix = self.text[:self.cut_start].rstrip().removesuffix(",").rstrip()
        result = prefix + "]}"
        assert json.loads(result)["events"] == self.events
        return result


def analyse(text):
    detector = EventRepeatStop()
    detector.feed(text)
    return detector
