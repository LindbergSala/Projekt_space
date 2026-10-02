import { RECRUITMENT_MESSAGES } from "../../lib/planet-recruitment-policy.js";

const SUCCESS_MESSAGES = Object.freeze({
  started: "Recruitment order accepted. Materials paid; collect the whole batch after its finish time.",
  collected: "Recruits collected. The whole batch is now part of this planet's ground forces.",
  "start-replayed": "This recruitment order was already accepted. No additional Materials were spent.",
  "collect-replayed": "This order was already collected. No additional units were delivered.",
});

export default function RecruitmentFeedback({ status }) {
  if (typeof status !== "string") {
    return null;
  }

  const succeeded = Object.hasOwn(SUCCESS_MESSAGES, status);
  const message = succeeded
    ? SUCCESS_MESSAGES[status]
    : Object.hasOwn(RECRUITMENT_MESSAGES, status)
      ? RECRUITMENT_MESSAGES[status]
      : null;

  if (message === null) {
    return null;
  }

  return (
    <p
      className={`recruitment-feedback${succeeded ? " recruitment-feedback-success" : ""}`}
      role={succeeded ? "status" : "alert"}
    >
      {message}
    </p>
  );
}
