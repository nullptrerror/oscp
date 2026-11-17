export const rules_last_verified = "2026-11-17";
export const RULES_LAST_VERIFIED = rules_last_verified;

export const POLICY_CLASSIFICATIONS = Object.freeze([
  "exam-core",
  "restricted",
  "prohibited",
  "study-only",
  "verify-current-policy",
]);

export const OFFSEC_POLICY_SOURCES = Object.freeze([
  {
    id: "exam-guide",
    title: "OSCP+ Exam Guide",
    url: "https://help.offsec.com/hc/en-us/articles/360040165632-OSCP-Exam-Guide",
    sourceUpdated: "2026-10-21",
    controls: ["documentation", "proof", "screenshots", "restrictions", "metasploit"],
  },
  {
    id: "exam-faq",
    title: "OSCP+ Exam FAQ",
    url: "https://help.offsec.com/hc/en-us/articles/4412170923924-OSCP-Exam-FAQ",
    sourceUpdated: "2026-10-21",
    controls: ["allowed-actions", "ai", "pivoting", "metasploit"],
  },
  {
    id: "ai-policy",
    title: "AI Usage Policy in OffSec Exams",
    url: "https://help.offsec.com/hc/en-us/articles/35549468971156-AI-Usage-Policy-in-OffSec-Exams",
    sourceUpdated: "2026-07-01",
    controls: ["ai"],
  },
  {
    id: "body-of-knowledge",
    title: "OSCP+ Body of knowledge",
    url: "https://help.offsec.com/hc/en-us/articles/38543335188756-OSCP-Body-of-knowledge",
    sourceUpdated: "2026-04-23",
    controls: ["core-scope"],
  },
  {
    id: "reporting-requirements",
    title: "OSCP+ Reporting Requirements",
    url: "https://help.offsec.com/hc/en-us/articles/360046787731-OSCP-Reporting-Requirements",
    sourceUpdated: "2026-08-06",
    controls: ["reporting"],
  },
]);

export const EXAM_SAFETY_RULES = Object.freeze([
  {
    id: "operator-control",
    classification: "exam-core",
    title: "Keep attack decisions operator-controlled",
    summary: "Run one reviewed command against one selected target at a time. A successful process exit is not proof that a hypothesis is true.",
    sourceIds: ["exam-guide"],
  },
  {
    id: "automatic-exploitation",
    classification: "prohibited",
    title: "No automatic exploitation",
    summary: "Do not use automatic exploitation actions or features, including scan-to-exploit behavior.",
    sourceIds: ["exam-guide"],
  },
  {
    id: "mass-scanning",
    classification: "prohibited",
    title: "No mass vulnerability scanning",
    summary: "Mass vulnerability-scanner actions are prohibited. Tool names do not create exceptions for equivalent functionality.",
    sourceIds: ["exam-guide"],
  },
  {
    id: "spoofing-poisoning",
    classification: "prohibited",
    title: "No spoofing or poisoning",
    summary: "Do not perform IP, ARP, DNS, NBNS, or similar spoofing. Responder poisoning and spoofing behavior remains prohibited even though other non-prohibited tool actions may be allowed.",
    sourceIds: ["exam-guide", "exam-faq"],
  },
  {
    id: "runtime-ai",
    classification: "prohibited",
    title: "No interactive AI during the exam or reporting phase",
    summary: "Do not send exam targets, output, evidence, credentials, findings, screenshots, or reports to an AI chatbot or LLM. Daybreak is pre-exam development tooling only; Fieldnotes has no runtime AI dependency.",
    sourceIds: ["exam-guide", "exam-faq", "ai-policy"],
  },
  {
    id: "metasploit-one-target",
    classification: "restricted",
    title: "Metasploit and Meterpreter commit to one target",
    summary: "Modules and Meterpreter may be used against only one selected target. A check or failed attempt still commits that target; do not test another target afterward.",
    sourceIds: ["exam-guide", "exam-faq"],
  },
  {
    id: "metasploit-pivot",
    classification: "prohibited",
    title: "Do not pivot with Metasploit",
    summary: "Metasploit cannot be used for pivoting because that would involve more than one target.",
    sourceIds: ["exam-guide", "exam-faq"],
  },
  {
    id: "ambiguous-features",
    classification: "verify-current-policy",
    title: "Confirm ambiguous functionality before the exam",
    summary: "Classify the action a feature performs, not merely its product name. Re-check the current official guide and ask OffSec about ambiguity before exam day.",
    sourceIds: ["exam-guide", "exam-faq"],
  },
]);

export const PROOF_REQUIREMENTS = Object.freeze([
  "Obtain the proof in an interactive shell on the target.",
  "Read local.txt or proof.txt with cat or type from its original location.",
  "Capture one screenshot that shows the proof value and the target IP context together.",
  "Manually submit the proof value in the control panel before the exam ends.",
  "Document every attack step, exact command, and relevant console output so a technically competent reader can reproduce it.",
  "Submit a PDF report with screenshots and descriptions of attacks and results.",
]);

export const POLICY_NOTICE = Object.freeze({
  title: "Fieldnotes is not OffSec approved",
  body: "Official current OffSec policy controls. This dated summary is conservative guidance, not an authorization or a guarantee of compliance.",
});
