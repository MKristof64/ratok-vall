"use client";

import { useState } from "react";

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

export function ShareControls({
  url,
  compact = false,
}: {
  url: string;
  compact?: boolean;
}) {
  const [status, setStatus] = useState<string | null>(null);

  const copy = async () => {
    try {
      await copyText(url);
      setStatus("Másolva");
      window.setTimeout(() => setStatus(null), 2200);
    } catch {
      setStatus("Nem sikerült másolni");
    }
  };

  const share = async () => {
    if (!navigator.share) {
      await copy();
      return;
    }

    try {
      await navigator.share({
        title: "Rátok vall",
        text: "Írj egy névtelen mondatot a társaságunkról!",
        url,
      });
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === "AbortError") return;
      setStatus("A megosztás nem sikerült");
    }
  };

  return (
    <div className={compact ? "share-controls share-compact" : "share-controls"}>
      <button className={compact ? "button button-quiet" : "button button-primary"} onClick={share} type="button">
        {compact ? "Meghívás" : "Meghívó megosztása"}
      </button>
      {!compact ? (
        <button className="button button-secondary" onClick={copy} type="button">
          Hivatkozás másolása
        </button>
      ) : null}
      <span className="copy-status" role="status" aria-live="polite">
        {status}
      </span>
    </div>
  );
}
