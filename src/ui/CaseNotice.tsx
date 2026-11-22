import type { Notice } from "./caseWords.ts";

export function CaseNotice({ notice, id, heading: Heading = "h2" }: { notice: Notice; id?: string; heading?: "h2" | "h3" }) {
  return (
    <div className="case-notice" id={id}>
      <Heading>{notice.title}</Heading>
      {notice.meta && <p className={notice.warning ? "case-meta warn" : "case-meta"}>{notice.meta}</p>}
      <p>{notice.body}</p>
    </div>
  );
}
