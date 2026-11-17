import {
  EXAM_SAFETY_RULES,
  OFFSEC_POLICY_SOURCES,
  POLICY_NOTICE,
  PROOF_REQUIREMENTS,
  RULES_LAST_VERIFIED,
} from "../data/examPolicy";

const LABELS = {
  "exam-core": "Exam core",
  restricted: "Restricted",
  prohibited: "Prohibited",
  "study-only": "Study only",
  "verify-current-policy": "Verify policy",
};

export default function ExamSafetyPage() {
  return (
    <main className="page-shell policy-page">
      <section className="section-hero backup-hero">
        <div>
          <p className="eyebrow">Exam safety</p>
          <h1>Operator decisions stay manual.</h1>
          <p>Offline policy guardrails for reviewing actions before they run. Official current OffSec policy always controls.</p>
        </div>
        <div className="policy-verified" aria-label={`Rules last verified ${RULES_LAST_VERIFIED}`}>
          <span>Rules last verified</span>
          <strong>{RULES_LAST_VERIFIED}</strong>
        </div>
      </section>

      <div className="notice warning" role="note">
        <strong>{POLICY_NOTICE.title}.</strong> {POLICY_NOTICE.body}
      </div>

      <section className="policy-grid" aria-label="Action classifications">
        {EXAM_SAFETY_RULES.map((rule) => (
          <article className={`backup-card policy-card policy-${rule.classification}`} key={rule.id}>
            <p className="eyebrow">{LABELS[rule.classification]}</p>
            <h2>{rule.title}</h2>
            <p>{rule.summary}</p>
            <p className="policy-source-refs">Sources: {rule.sourceIds.map((sourceId) => OFFSEC_POLICY_SOURCES.find((source) => source.id === sourceId)?.title).join("; ")}</p>
          </article>
        ))}
      </section>

      <section className="backup-grid policy-detail-grid">
        <article className="backup-card">
          <p className="eyebrow">Proof and report</p>
          <h2>Evidence must stand on its own.</h2>
          <ol className="policy-list">
            {PROOF_REQUIREMENTS.map((requirement) => <li key={requirement}>{requirement}</li>)}
          </ol>
        </article>

        <article className="backup-card">
          <p className="eyebrow">Official sources</p>
          <h2>Re-check before exam day.</h2>
          <ul className="policy-source-list">
            {OFFSEC_POLICY_SOURCES.map((source) => (
              <li key={source.id}>
                <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
                <span>Source updated {source.sourceUpdated}</span>
              </li>
            ))}
          </ul>
          <p className="timestamp">Links require network access; the recorded summary remains available offline.</p>
        </article>
      </section>
    </main>
  );
}
