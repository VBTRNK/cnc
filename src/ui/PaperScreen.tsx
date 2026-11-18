import { useEffect, useRef } from "react";
import type { Paper } from "../sim/index.ts";
import { Chip } from "./bits.tsx";
import { t } from "./text.ts";
import { paperView } from "./words.ts";

interface PaperProps {
  paper: Paper;
  /** The result of the action that ended the day, if it just happened. */
  last: readonly string[];
  onStart: () => void;
  readOnly: boolean;
}

/** The evening paper: the day's story, tomorrow's known facts, and the next day. */
export function PaperScreen({ paper, last, onStart, readOnly }: PaperProps) {
  const view = paperView(paper);
  const headRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headRef.current?.focus();
  }, [paper.day]);

  return (
    <>
      {last.length > 0 && (
        <p className="result paper-last" role="status">
          <mark>{last.join(" ")}</mark>
        </p>
      )}
      <article className="paper">
        <header className="masthead">
          <p className="masthead-name">{t("paper.masthead")}</p>
          <p className="masthead-edition">{t("paper.edition", { day: paper.day })}</p>
        </header>
        <h1 ref={headRef} tabIndex={-1} className="headline">
          {view.head}
        </h1>
        <p className="story">{view.story}</p>
        {view.briefs.length > 0 && (
          <ul className="paper-briefs">
            {view.briefs.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
        <p className="chips-line paper-chips">
          {view.chips.map((c) => (
            <Chip key={c}>{c}</Chip>
          ))}
        </p>
        <button type="button" className="commit" disabled={readOnly} onClick={onStart}>
          {t("paper.start", { day: paper.day + 1 })}
        </button>
      </article>
    </>
  );
}
