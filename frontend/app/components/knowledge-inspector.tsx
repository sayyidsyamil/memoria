"use client";

import { useState, useEffect } from "react";
import { X, Check, Trash2 } from "lucide-react";

export interface NoteData {
  id: string;
  title: string;
  summary: string;
  keyPoints: string[];
  tags: string[];
  rawContent: string;
}

interface KnowledgeInspectorProps {
  note: NoteData | null;
  isOpen: boolean;
  onClose: () => void;
  onApprove: (note: NoteData) => void;
  onDiscard: () => void;
}

export function KnowledgeInspector({
  note,
  isOpen,
  onClose,
  onApprove,
  onDiscard,
}: KnowledgeInspectorProps) {
  const [editedNote, setEditedNote] = useState<NoteData | null>(null);
  const [tab, setTab] = useState<"preview" | "edit">("preview");

  useEffect(() => {
    if (note) {
      setEditedNote({ ...note });
      setTab("preview");
    }
  }, [note]);

  if (!editedNote || !isOpen) return null;

  return (
    <div className="flex h-full flex-col border-l border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="font-mono text-sm text-muted-foreground">Review</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 hover:bg-secondary"
        >
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      <div className="flex border-b border-border">
        <button
          type="button"
          onClick={() => setTab("preview")}
          className={`flex-1 px-4 py-2 text-sm transition-colors ${
            tab === "preview"
              ? "border-b-2 border-accent text-foreground"
              : "text-muted-foreground"
          }`}
        >
          Preview
        </button>
        <button
          type="button"
          onClick={() => setTab("edit")}
          className={`flex-1 px-4 py-2 text-sm transition-colors ${
            tab === "edit"
              ? "border-b-2 border-accent text-foreground"
              : "text-muted-foreground"
          }`}
        >
          Edit
        </button>
      </div>

      <div className="custom-scrollbar flex-1 overflow-y-auto p-4">
        {tab === "preview" ? (
          <div className="space-y-4">
            <h2 className="text-lg font-medium">{editedNote.title}</h2>

            <div className="flex flex-wrap gap-1.5">
              {editedNote.tags.map((tag, i) => (
                <span
                  key={i}
                  className="rounded bg-secondary px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>

            <p className="text-sm text-muted-foreground">{editedNote.summary}</p>

            <ul className="space-y-1.5">
              {editedNote.keyPoints.map((point, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className="text-accent">-</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>

            <div className="border-t border-border pt-4">
              <pre className="whitespace-pre-wrap font-mono text-sm text-muted-foreground">
                {editedNote.rawContent}
              </pre>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <input
              type="text"
              value={editedNote.title}
              onChange={(e) =>
                setEditedNote((prev) =>
                  prev ? { ...prev, title: e.target.value } : null
                )
              }
              className="w-full rounded border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            />

            <textarea
              value={editedNote.summary}
              onChange={(e) =>
                setEditedNote((prev) =>
                  prev ? { ...prev, summary: e.target.value } : null
                )
              }
              rows={2}
              className="w-full resize-none rounded border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            />

            <div className="space-y-2">
              {editedNote.keyPoints.map((point, i) => (
                <input
                  key={i}
                  type="text"
                  value={point}
                  onChange={(e) => {
                    const newPoints = [...editedNote.keyPoints];
                    newPoints[i] = e.target.value;
                    setEditedNote((prev) =>
                      prev ? { ...prev, keyPoints: newPoints } : null
                    );
                  }}
                  className="w-full rounded border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                />
              ))}
            </div>

            <textarea
              value={editedNote.rawContent}
              onChange={(e) =>
                setEditedNote((prev) =>
                  prev ? { ...prev, rawContent: e.target.value } : null
                )
              }
              rows={12}
              className="w-full resize-none rounded border border-border bg-card px-3 py-2 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        )}
      </div>

      <div className="flex gap-2 border-t border-border p-4">
        <button
          type="button"
          onClick={onDiscard}
          className="flex flex-1 items-center justify-center gap-2 rounded bg-secondary px-4 py-2.5 text-sm transition-colors hover:bg-secondary/80"
        >
          <Trash2 className="h-4 w-4" />
          Discard
        </button>
        <button
          type="button"
          onClick={() => editedNote && onApprove(editedNote)}
          className="flex flex-1 items-center justify-center gap-2 rounded bg-accent px-4 py-2.5 text-sm text-accent-foreground transition-colors hover:bg-accent/90"
        >
          <Check className="h-4 w-4" />
          Save
        </button>
      </div>
    </div>
  );
}
