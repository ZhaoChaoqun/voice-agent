/** Import bounded local text guides and keep product evidence visible. */
import { useId, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  ExternalLink,
  FileText,
  Plus,
  Upload,
  X,
} from "lucide-react";

import type { KnowledgeSource, Language } from "@shared/protocol";
import { text } from "@/i18n";
import { useDialog } from "@/hooks/useDialog";
import { errorMessage, request } from "@/lib/api";

const MAX_DOCUMENT_CHARACTERS = 50_000; // Bound client-side text imports before the server's own limit.

interface KnowledgeProps {
  language: Language;
  sources: KnowledgeSource[];
  onAdd: (source: KnowledgeSource) => void;
  onClose: () => void;
}

export function Knowledge(props: KnowledgeProps): React.JSX.Element {
  const copy = text(props.language);
  const dialog = useDialog(props.onClose);
  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <section
        ref={dialog}
        tabIndex={-1}
        className="knowledge-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="knowledge-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <span className="section-icon">
            <BookOpen size={22} />
          </span>
          <div>
            <h2 id="knowledge-title">{copy.knowledge}</h2>
            <p>{copy.knowledgeCaption}</p>
          </div>
          <button
            className="icon-button"
            aria-label={copy.close}
            onClick={props.onClose}
          >
            <X size={20} />
          </button>
        </div>
        <p className="knowledge-notice">{copy.knowledgeNotice}</p>
        <div className="source-list">
          {props.sources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              language={props.language}
            />
          ))}
        </div>
        <KnowledgeImport language={props.language} onAdd={props.onAdd} />
      </section>
    </div>
  );
}

export function SourceCard({
  source,
  language,
}: {
  source: KnowledgeSource;
  language: Language;
}): React.JSX.Element {
  const copy = text(language);
  const kindLabel = {
    manufacturer: copy.manufacturer,
    demo: copy.demo,
    uploaded: copy.uploaded,
  };
  const safeUrl = source.url?.startsWith("https://") ? source.url : undefined;
  return (
    <article className="source-card">
      <FileText size={17} />
      <div>
        <strong>{source.title}</strong>
        <span>
          {source.model} · {kindLabel[source.kind]}
        </span>
      </div>
      {safeUrl && (
        <a
          href={safeUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`${copy.source}: ${source.title}`}
        >
          <ExternalLink size={16} />
        </a>
      )}
    </article>
  );
}

function KnowledgeImport(props: {
  language: Language;
  onAdd: (source: KnowledgeSource) => void;
}): React.JSX.Element {
  const copy = text(props.language);
  const [title, setTitle] = useState("");
  const [model, setModel] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const file = useRef<HTMLInputElement>(null);

  const loadFile = async (input: File | undefined): Promise<void> => {
    if (!input) return;
    if (
      !/\.(txt|md)$/i.test(input.name) ||
      input.size > MAX_DOCUMENT_CHARACTERS
    ) {
      setError(
        props.language === "zh"
          ? "请选择不超过 50 KB 的 .txt 或 .md 文件。"
          : "Choose a .txt or .md file under 50 KB.",
      );
      return;
    }
    try {
      setContent(await input.text());
      setTitle(input.name.replace(/\.(txt|md)$/i, ""));
      setError("");
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      props.onAdd(
        await request<KnowledgeSource>("/api/knowledge", {
          title,
          model,
          content,
        }),
      );
      setSaved(true);
      setContent("");
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="knowledge-import" onSubmit={(event) => void submit(event)}>
      <h3>
        <Plus size={16} />
        {copy.uploadTitle}
      </h3>
      <div className="import-fields">
        <label htmlFor={`${id}-title`}>
          {copy.docTitle}
          <input
            id={`${id}-title`}
            required
            maxLength={150}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setSaved(false);
            }}
          />
        </label>
        <label htmlFor={`${id}-model`}>
          {copy.docModel}
          <input
            id={`${id}-model`}
            required
            maxLength={100}
            value={model}
            onChange={(event) => {
              setModel(event.target.value);
              setSaved(false);
            }}
          />
        </label>
      </div>
      <label className="sr-only" htmlFor={`${id}-content`}>
        {copy.docContent}
      </label>
      <textarea
        id={`${id}-content`}
        required
        rows={4}
        maxLength={MAX_DOCUMENT_CHARACTERS}
        placeholder={copy.docContent}
        value={content}
        onChange={(event) => {
          setContent(event.target.value);
          setSaved(false);
        }}
      />
      <div className="import-actions">
        <input
          ref={file}
          type="file"
          accept=".txt,.md,text/plain,text/markdown"
          hidden
          onChange={(event) => void loadFile(event.target.files?.[0])}
        />
        <button
          type="button"
          className="subtle-button"
          onClick={() => file.current?.click()}
        >
          <Upload size={15} />
          .txt / .md
        </button>
        <button type="submit" className="primary-button" disabled={busy}>
          {copy.upload}
          <Plus size={14} />
        </button>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="inline-success" role="status">
          <Check size={14} />
          {copy.uploadDone}
        </p>
      )}
    </form>
  );
}
