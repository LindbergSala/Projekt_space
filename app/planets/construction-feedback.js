import { CONSTRUCTION_MESSAGES } from "../../lib/infrastructure-construction-policy.js";

const SUCCESS_MESSAGES = Object.freeze({
  started: "Construction order accepted. The new level takes effect at its finish time.",
  replayed: "This construction order was already accepted. No additional Materials were spent.",
});

export default function ConstructionFeedback({ status }) {
  if (typeof status !== "string") {
    return null;
  }

  const succeeded = Object.hasOwn(SUCCESS_MESSAGES, status);
  const message = succeeded
    ? SUCCESS_MESSAGES[status]
    : Object.hasOwn(CONSTRUCTION_MESSAGES, status)
      ? CONSTRUCTION_MESSAGES[status]
      : null;

  if (message === null) {
    return null;
  }

  return (
    <p
      className={`construction-feedback${succeeded ? " construction-feedback-success" : ""}`}
      role={succeeded ? "status" : "alert"}
    >
      {message}
    </p>
  );
}
